package metrics

import (
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
)

// Script run on remote server to collect metrics
const metricsScript = `
#!/bin/sh
# CPU (1-second sample)
CPU=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1 2>/dev/null || \
      top -bn1 | grep -i "cpu" | head -1 | awk '{print $2}' | sed 's/%//' 2>/dev/null || echo "0")

# Memory
MEM_LINE=$(free -m | grep Mem)
MEM_USED=$(echo $MEM_LINE | awk '{print $3}')
MEM_TOTAL=$(echo $MEM_LINE | awk '{print $2}')
MEM_PCT=$(awk "BEGIN {printf \"%.1f\", ($MEM_USED/$MEM_TOTAL)*100}")

# Disk (root partition)
DISK_LINE=$(df -BG / | tail -1)
DISK_USED=$(echo $DISK_LINE | awk '{print $3}' | tr -d 'G')
DISK_TOTAL=$(echo $DISK_LINE | awk '{print $2}' | tr -d 'G')
DISK_PCT=$(echo $DISK_LINE | awk '{print $5}' | tr -d '%')

# Load average
LOAD=$(cat /proc/loadavg | awk '{print $1}')

# Uptime in seconds
UPTIME=$(cat /proc/uptime | awk '{print int($1)}')

echo "{\"cpu\":$CPU,\"mem_used\":$MEM_USED,\"mem_total\":$MEM_TOTAL,\"mem_pct\":$MEM_PCT,\"disk_used\":$DISK_USED,\"disk_total\":$DISK_TOTAL,\"disk_pct\":$DISK_PCT,\"load\":$LOAD,\"uptime\":$UPTIME}"
`

type rawMetrics struct {
	CPU       float64 `json:"cpu"`
	MemUsed   float64 `json:"mem_used"`
	MemTotal  float64 `json:"mem_total"`
	MemPct    float64 `json:"mem_pct"`
	DiskUsed  float64 `json:"disk_used"`
	DiskTotal float64 `json:"disk_total"`
	DiskPct   float64 `json:"disk_pct"`
	Load      float64 `json:"load"`
	Uptime    int64   `json:"uptime"`
}

func StartCollector(server models.Server) {
	interval := time.Duration(config.C.MetricsInterval) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		collect(server)
	}
}

func collect(server models.Server) {
	client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		log.Printf("Metrics SSH error server %d: %v", server.ID, err)
		updateStatus(server.ID, "offline")
		return
	}

	output, err := client.RunCommand(metricsScript)
	if err != nil {
		// try JSON parse anyway (non-zero exit but output present)
		if !strings.Contains(output, "{") {
			log.Printf("Metrics collection failed server %d: %v", server.ID, err)
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

	m := models.Metric{
		ServerID:    server.ID,
		Timestamp:   time.Now(),
		CPUPercent:  raw.CPU,
		MemPercent:  raw.MemPct,
		MemUsedMB:   raw.MemUsed,
		MemTotalMB:  raw.MemTotal,
		DiskPercent: raw.DiskPct,
		DiskUsedGB:  raw.DiskUsed,
		DiskTotalGB: raw.DiskTotal,
		LoadAvg1:    raw.Load,
		Uptime:      raw.Uptime,
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
