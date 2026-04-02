package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/logger"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// per-server goroutine management
var (
	collectors   = map[uint]context.CancelFunc{}
	collectorsMu sync.Mutex

	// Track previous network readings for rate calculation
	lastNetStats   = map[uint]netStat{}
	lastNetStatsMu sync.Mutex
)

type netStat struct {
	rx        float64
	tx        float64
	timestamp time.Time
}

// Script run on remote server to collect metrics
const linuxMetricsScript = `
#!/bin/sh
# CPU (1-second sample)
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || \
      top -bn1 | grep -i "cpu" | head -1 | awk '{print $2}' | sed 's/%//' 2>/dev/null || echo "0")

# Memory
MEM_LINE=$(free -m | grep Mem)
MEM_USED=$(echo $MEM_LINE | awk '{print $3}')
MEM_TOTAL=$(echo $MEM_LINE | awk '{print $2}')
MEM_PCT=$(awk -v u=$MEM_USED -v t=$MEM_TOTAL "BEGIN {if(t>0) printf \"%.1f\", (u/t)*100; else print \"0\"}")

# Disk (root partition)
DISK_LINE=$(df -BG / | tail -1)
DISK_USED=$(echo $DISK_LINE | awk '{print $3}' | tr -d 'G')
DISK_TOTAL=$(echo $DISK_LINE | awk '{print $2}' | tr -d 'G')
DISK_PCT=$(echo $DISK_LINE | awk '{print $5}' | tr -d '%')

# Load average
LOAD=$(cat /proc/loadavg | awk '{print $1}' 2>/dev/null || echo "0")

# Uptime (seconds)
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo "0")

# Network RX/TX (Total cumulative bytes)
if [ -f /proc/net/dev ]; then
  NET_STATS=$(awk 'NR>2 {rx+=$2; tx+=$10} END {printf "%.0f,%.0f", rx, tx}' /proc/net/dev)
  NET_RX=$(echo $NET_STATS | cut -d',' -f1)
  NET_TX=$(echo $NET_STATS | cut -d',' -f2)
else
  NET_RX="0"
  NET_TX="0"
fi
[ -z "$NET_RX" ] && NET_RX="0"
[ -z "$NET_TX" ] && NET_TX="0"

echo "{\"cpu\":$CPU,\"mem_used\":$MEM_USED,\"mem_total\":$MEM_TOTAL,\"mem_pct\":$MEM_PCT,\"disk_used\":$DISK_USED,\"disk_total\":$DISK_TOTAL,\"disk_pct\":$DISK_PCT,\"net_rx\":$NET_RX,\"net_tx\":$NET_TX,\"load\":$LOAD,\"uptime\":$UPTIME}"
`

const darwinMetricsScript = `
CPU=$(top -l 1 -s 0 | grep "CPU usage" | awk '{u=$3; s=$5; gsub(/%/,"",u); gsub(/%/,"",s); printf "%.1f", u+s}' 2>/dev/null || echo "0")
if [ -z "$CPU" ]; then CPU="0"; fi

MEM_TOTAL=$(sysctl -n hw.memsize | awk '{print int($1/1024/1024)}')
MEM_USED=$(vm_stat | awk '/Pages active/ {a=$3} /Pages wired/ {w=$4} END {gsub(/\./,"",a); gsub(/\./,"",w); printf "%d", int((a+w)*4096/1024/1024)}')
if [ -z "$MEM_USED" ]; then MEM_USED="0"; fi
MEM_PCT=$(awk -v u=$MEM_USED -v t=$MEM_TOTAL 'BEGIN {if(t>0) printf "%.1f", (u/t)*100; else print "0"}')

DISK_BLOCKS=$(df -k / | tail -1)
DISK_USED=$(echo $DISK_BLOCKS | awk '{print int($3/1024/1024)}')
DISK_TOTAL=$(echo $DISK_BLOCKS | awk '{print int($2/1024/1024)}')
DISK_PCT=$(echo $DISK_BLOCKS | awk '{print $5}' | sed 's/%//')

LOAD=$(sysctl -n vm.loadavg | awk '{print $2}')
BOOT_TIME=$(sysctl -n kern.boottime | awk '{print $4}' | sed 's/,//g')
NOW=$(date +%s)
UPTIME=$((NOW - BOOT_TIME))

# Network RX/TX (Total cumulative bytes)
NET_STATS=$(netstat -ibn | awk '/^en/ {rx+=$7; tx+=$10} END {printf "%.0f,%.0f", rx, tx}' 2>/dev/null)
NET_RX=$(echo $NET_STATS | cut -d',' -f1)
NET_TX=$(echo $NET_STATS | cut -d',' -f2)
[ -z "$NET_RX" ] && NET_RX="0"
[ -z "$NET_TX" ] && NET_TX="0"

echo "{\"cpu\":$CPU,\"mem_used\":$MEM_USED,\"mem_total\":$MEM_TOTAL,\"mem_pct\":$MEM_PCT,\"disk_used\":$DISK_USED,\"disk_total\":$DISK_TOTAL,\"disk_pct\":$DISK_PCT,\"net_rx\":$NET_RX,\"net_tx\":$NET_TX,\"load\":$LOAD,\"uptime\":$UPTIME}"
`

type rawMetrics struct {
	CPU       float64 `json:"cpu"`
	MemUsed   float64 `json:"mem_used"`
	MemTotal  float64 `json:"mem_total"`
	MemPct    float64 `json:"mem_pct"`
	DiskUsed  float64 `json:"disk_used"`
	DiskTotal float64 `json:"disk_total"`
	DiskPct   float64 `json:"disk_pct"`
	NetRx     float64 `json:"net_rx"` // Cumulative bytes
	NetTx     float64 `json:"net_tx"` // Cumulative bytes
	Load      float64 `json:"load"`
	Uptime    int64   `json:"uptime"`
}

// StartCollector starts (or restarts) a metrics collector for the given server.
// Calling it while a collector is already running cancels the old one first.
func StartCollector(server models.Server) {
	collectorsMu.Lock()
	if cancel, ok := collectors[server.ID]; ok {
		cancel() // stop the old goroutine
	}
	ctx, cancel := context.WithCancel(context.Background())
	collectors[server.ID] = cancel
	collectorsMu.Unlock()

	log.Printf("📊 Metrics collector started for server %d (%s)", server.ID, server.Host)

	interval := time.Duration(config.C.MetricsInterval) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("📊 Metrics collector stopped for server %d", server.ID)
			return
		case <-ticker.C:
			collect(server)
		}
	}
}

// StopCollector cancels the running metrics collector for a server (if any).
func StopCollector(serverID uint) {
	collectorsMu.Lock()
	defer collectorsMu.Unlock()
	if cancel, ok := collectors[serverID]; ok {
		cancel()
		delete(collectors, serverID)
	}
}

func collect(server models.Server) {
	// Refresh server data to get latest OS/Status
	if err := db.DB.First(&server, server.ID).Error; err != nil {
		log.Printf("Metrics error: server %d not found in DB", server.ID)
		return
	}

	// Handle Direct API Clusters (No SSH Proxy)
	if server.Host == "" && server.IsK8s {
		collectK8s(server)
		return
	}

	client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		log.Printf("Metrics SSH error server %d: %v", server.ID, err)
		sshclient.Remove(server.ID) // Clear stale connection from pool
		updateStatus(server.ID, "offline")
		return
	}

	// Detect OS if unknown or misidentified
	if server.OS == "unknown" || server.OS == "" || server.OS == "linux" {
		out, _, err := client.RunCommand("uname -s")
		if err == nil {
			out = strings.TrimSpace(strings.ToLower(out))
			osType := "linux"
			if strings.Contains(out, "darwin") {
				osType = "darwin"
			}
			
			if server.OS != osType {
				server.OS = osType
				db.DB.Model(&server).Update("os", osType)
				log.Printf("🔄 Auto-detected/Corrected OS for server %d: %s", server.ID, osType)
			}
		}
	}

	script := linuxMetricsScript
	if server.OS == "darwin" {
		script = darwinMetricsScript
	}

	output, stderr, err := client.RunCommand(script)
	if err != nil {
		// try JSON parse anyway (non-zero exit but output present)
		if !strings.Contains(output, "{") {
			errMsg := fmt.Sprintf("Metrics collection failed: %v, stderr: %s", err, stderr)
			log.Printf("Metrics SSH error server %d: %s", server.ID, errMsg)
			sshclient.Remove(server.ID) // Clear stale connection from pool
			logger.RecordLog(server.ID, "diagnostic", "error", errMsg)
			updateStatus(server.ID, "offline")
			return
		}
	}

	// Extract JSON (last line containing {)
	jsonLine := ""
	for _, line := range strings.Split(output, "\n") {
		if strings.Contains(line, "{") {
			jsonLine = line
		}
	}
	if jsonLine == "" {
		log.Printf("No JSON from metrics script server %d: %s", server.ID, output)
		return
	}

	var raw rawMetrics
	if err := json.Unmarshal([]byte(jsonLine), &raw); err != nil {
		log.Printf("Metrics parse error server %d: %v | raw: %s", server.ID, err, jsonLine)
		return
	}

	// Calculate network rates (MB/s)
	var netRxMBps, netTxMBps float64
	now := time.Now()
	lastNetStatsMu.Lock()
	if prev, ok := lastNetStats[server.ID]; ok {
		dur := now.Sub(prev.timestamp).Seconds()
		if dur > 0 {
			netRxMBps = (raw.NetRx - prev.rx) / dur / (1024 * 1024)
			netTxMBps = (raw.NetTx - prev.tx) / dur / (1024 * 1024)
			if netRxMBps < 0 { netRxMBps = 0 }
			if netTxMBps < 0 { netTxMBps = 0 }
			log.Printf("📊 Net Metrics Server %d: RX_Total=%.0f TX_Total=%.0f | RX_Rate=%.4f TX_Rate=%.4f MB/s", server.ID, raw.NetRx, raw.NetTx, netRxMBps, netTxMBps)
		}
	} else {
		log.Printf("📊 First sample for Server %d: RX_Total=%.0f TX_Total=%.0f", server.ID, raw.NetRx, raw.NetTx)
	}
	lastNetStats[server.ID] = netStat{rx: raw.NetRx, tx: raw.NetTx, timestamp: now}
	lastNetStatsMu.Unlock()

	m := models.Metric{
		ServerID:    server.ID,
		Timestamp:   now,
		CPUPercent:  raw.CPU,
		MemPercent:  raw.MemPct,
		MemUsedMB:   raw.MemUsed,
		MemTotalMB:  raw.MemTotal,
		DiskPercent: raw.DiskPct,
		DiskUsedGB:  raw.DiskUsed,
		DiskTotalGB: raw.DiskTotal,
		NetRxMBps:   netRxMBps,
		NetTxMBps:   netTxMBps,
		LoadAvg1:    raw.Load,
		Uptime:      raw.Uptime,
	}

	db.DB.Create(&m)
	updateStatus(server.ID, "online")

	// Broadcast via WebSocket
	room := fmt.Sprintf("server:%d:metrics", server.ID)
	ws.GlobalHub.Broadcast(room, "metric", m)
}

func collectK8s(server models.Server) {
	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		log.Printf("📊 K8s Metrics Auth Error server %d: %v", server.ID, err)
		updateStatus(server.ID, "offline")
		return
	}

	ctx := context.TODO()
	nodes, err := clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		log.Printf("📊 K8s Metrics Fetch Error server %d: %v", server.ID, err)
		updateStatus(server.ID, "offline")
		return
	}

	var cpuTotal, cpuAllocatable int64 // millicores
	var memTotal, memAllocatable int64 // bytes
	var diskTotal, diskAllocatable int64 // bytes (ephemeral storage)
	var nodeCount, readyNodes int

	for _, n := range nodes.Items {
		nodeCount++
		cpuTotal += n.Status.Capacity.Cpu().MilliValue()
		cpuAllocatable += n.Status.Allocatable.Cpu().MilliValue()
		memTotal += n.Status.Capacity.Memory().Value()
		memAllocatable += n.Status.Allocatable.Memory().Value()
		diskTotal += n.Status.Capacity.StorageEphemeral().Value()
		diskAllocatable += n.Status.Allocatable.StorageEphemeral().Value()

		for _, c := range n.Status.Conditions {
			if c.Type == "Ready" && c.Status == "True" {
				readyNodes++
				break
			}
		}
	}

	// Detect OS if unknown or "unknown"
	if (server.OS == "" || server.OS == "unknown") && len(nodes.Items) > 0 {
		osType := strings.ToLower(nodes.Items[0].Status.NodeInfo.OperatingSystem)
		if osType != "" {
			db.DB.Model(&models.Server{}).Where("id = ?", server.ID).Update("os", osType)
		}
	}

	// Calculate "Usage" percentages for the dashboard.
	cpuPct := 0.0
	if cpuTotal > 0 {
		cpuPct = 100.0 - (float64(cpuAllocatable) / float64(cpuTotal) * 100.0)
	}
	memPct := 0.0
	if memTotal > 0 {
		memPct = 100.0 - (float64(memAllocatable) / float64(memTotal) * 100.0)
	}
	diskPct := 0.0
	if diskTotal > 0 {
		diskPct = 100.0 - (float64(diskAllocatable) / float64(diskTotal) * 100.0)
	}

	m := models.Metric{
		ServerID:    server.ID,
		Timestamp:   time.Now(),
		CPUPercent:  cpuPct,
		MemPercent:  memPct,
		MemUsedMB:   float64(memTotal-memAllocatable) / (1024 * 1024),
		MemTotalMB:  float64(memTotal) / (1024 * 1024),
		DiskPercent: diskPct,
		DiskUsedGB:  float64(diskTotal-diskAllocatable) / (1024 * 1024 * 1024),
		DiskTotalGB: float64(diskTotal) / (1024 * 1024 * 1024),
		LoadAvg1:    float64(readyNodes),
		Uptime:      int64(readyNodes),
	}

	db.DB.Create(&m)
	updateStatus(server.ID, "online")

	// Broadcast via WebSocket
	room := fmt.Sprintf("server:%d:metrics", server.ID)
	ws.GlobalHub.Broadcast(room, "metric", m)
}

func updateStatus(serverID uint, status string) {
	db.DB.Model(&models.Server{}).Where("id = ?", serverID).Update("status", status)
}

// Dummy to use strconv (avoid import error if unused)
var _ = strconv.Itoa
