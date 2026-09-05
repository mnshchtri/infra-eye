package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
)

// cmdTimeout bounds each SSH command run by the networking handler so a hung
// remote command (e.g. a missing tool triggering an interactive prompt) fails
// fast instead of hanging the request forever.
const cmdTimeout = 25 * time.Second

type ListeningPort struct {
	Protocol string `json:"protocol"`
	State    string `json:"state"`
	RecvQ    string `json:"recv_q"`
	SendQ    string `json:"send_q"`
	Local    string `json:"local"`
	Remote   string `json:"remote"`
	Process  string `json:"process"`
	PID      string `json:"pid"`
	Program  string `json:"program"`
}

type SystemService struct {
	Name        string `json:"name"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
}

type NetworkInterface struct {
	Name      string `json:"name"`
	Flags     string `json:"flags"`
	MTU       string `json:"mtu"`
	State     string `json:"state"`
	IPv4      string `json:"ipv4"`
	IPv6      string `json:"ipv6"`
	RxBytes   string `json:"rx_bytes"`
	TxBytes   string `json:"tx_bytes"`
	RxPackets string `json:"rx_packets"`
	TxPackets string `json:"tx_packets"`
}

type NetworkingInfo struct {
	Hostname   string             `json:"hostname"`
	Ports      []ListeningPort    `json:"ports"`
	Services   []SystemService    `json:"services"`
	Interfaces []NetworkInterface `json:"interfaces"`
	Uptime     string             `json:"uptime"`
}

// ── Linux scripts ──

const ssScript = `
# Try ss first (modern), fall back to netstat
if command -v ss >/dev/null 2>&1; then
  ss -tulnp 2>/dev/null | tail -n +2 | awk '{
    proto=$1; state=$2;
    # Parse local address - split on last colon to get port
    local=$5;
    remote=$6;

    # Extract program name from the process column (everything after "users:" up to the closing paren)
    proc="";
    pid="";
    prog="";
    for(i=7;i<=NF;i++) {
      line=$i;
      if(line ~ /users:\(/) {
        # Extract program name: (\"name\",pid=NNN,...
        gsub(/.*\("/, "", line);
        gsub(/".*/, "", line);
        prog=line;
      }
      if(line ~ /pid=/) {
        gsub(/.*pid=/, "", line);
        gsub(/,.*/, "", line);
        pid=line;
      }
    }
    if(proto=="tcp" || proto=="tcp6") {
      if(state=="LISTEN") state="LISTEN";
      else if(state=="ESTAB") state="ESTABLISHED";
      else if(state=="TIME-WAIT") state="TIME-WAIT";
      else if(state=="CLOSE-WAIT") state="CLOSE-WAIT";
      else if(state=="SYN-SENT") state="SYN-SENT";
      else if(state=="SYN-RECV") state="SYN-RECV";
    } else {
      state="—";
    }
    printf "{\"protocol\":\"%s\",\"state\":\"%s\",\"local\":\"%s\",\"remote\":\"%s\",\"program\":\"%s\",\"pid\":\"%s\"}\n", proto, state, local, remote, prog, pid;
  }'
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulnp 2>/dev/null | tail -n +2 | awk '{
    proto=$1; state=$NF;
    local=$(NF-1); remote=$(NF-2);
    # For netstat, process info is in the last field like "nginx: worker"
    prog=""; pid="";
    for(i=7;i<=NF-1;i++) {
      if($i ~ /^[0-9]+\//) {
        split($i, a, "/");
        pid=a[1]; prog=a[2];
      }
    }
    if(proto=="tcp" || proto=="tcp6") {
      if(state ~ /LISTEN/) state="LISTEN";
      else if(state ~ /ESTABLISHED/) state="ESTABLISHED";
      else if(state ~ /TIME_WAIT/) state="TIME-WAIT";
      else if(state ~ /CLOSE_WAIT/) state="CLOSE-WAIT";
    } else {
      state="—";
    }
    if(local != "") {
      printf "{\"protocol\":\"%s\",\"state\":\"%s\",\"local\":\"%s\",\"remote\":\"%s\",\"program\":\"%s\",\"pid\":\"%s\"}\n", proto, state, local, remote, prog, pid;
    }
  }'
fi
`

const svcScript = `
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --all --no-pager --no-legend 2>/dev/null | awk '{
    name=$1; load=$2; active=$3; sub=$4;
    # Description is everything from field 5 onwards
    desc="";
    for(i=5;i<=NF;i++) desc=desc (i>5?" ":"") $i;
    # Only output interesting services (running, failed, or exited)
    if(active=="active" || active=="failed" || sub=="exited" || sub=="dead") {
      printf "{\"name\":\"%s\",\"load\":\"%s\",\"active\":\"%s\",\"sub\":\"%s\",\"description\":\"%s\"}\n", name, load, active, sub, desc;
    }
  }'
else
  echo "[]"
fi
`

const ifaceScript = `
if command -v ip >/dev/null 2>&1; then
  for name in $(ip -o link show 2>/dev/null | awk '{print $2}' | tr -d ':' | cut -d'@' -f1); do
    [ "$name" = "lo" ] && continue
    link_line=$(ip -o link show "$name" 2>/dev/null)
    flags=$(echo "$link_line" | grep -oE '<[^>]*>' | head -1)
    mtu=$(echo "$link_line" | grep -oE 'mtu [0-9]+' | head -1 | awk '{print $2}')
    # The state is the token right after the literal "state" keyword, not
    # the last field (which is usually the interface's broadcast MAC).
    state="DOWN"
    echo "$link_line" | grep -oE 'state [A-Za-z]+' | head -1 | grep -q UP && state="UP"
    [ -z "$flags" ] && flags="—"
    [ -z "$mtu" ] && mtu="—"
    ipv4=$(ip -4 -o addr show "$name" 2>/dev/null | awk '{print $4}' | head -1)
    ipv6=$(ip -6 -o addr show "$name" 2>/dev/null | awk '{print $4}' | head -1)
    [ -z "$ipv4" ] && ipv4="—"
    [ -z "$ipv6" ] && ipv6="—"
    rx_bytes=$(cat /sys/class/net/"$name"/statistics/rx_bytes 2>/dev/null || echo "0")
    tx_bytes=$(cat /sys/class/net/"$name"/statistics/tx_bytes 2>/dev/null || echo "0")
    rx_packets=$(cat /sys/class/net/"$name"/statistics/rx_packets 2>/dev/null || echo "0")
    tx_packets=$(cat /sys/class/net/"$name"/statistics/tx_packets 2>/dev/null || echo "0")
    printf '{"name":"%s","flags":"%s","mtu":"%s","state":"%s","ipv4":"%s","ipv6":"%s","rx_bytes":"%s","tx_bytes":"%s","rx_packets":"%s","tx_packets":"%s"}\n' "$name" "$flags" "$mtu" "$state" "$ipv4" "$ipv6" "$rx_bytes" "$tx_bytes" "$rx_packets" "$tx_packets"
  done
elif command -v ifconfig >/dev/null 2>&1; then
  ifconfig | awk '
  /^[a-zA-Z0-9]/ { if(ifname!="") print "{\"name\":\""ifname"\",\"ipv4\":\""ipv4"\",\"ipv6\":\""ipv6"\",\"state\":\""state"\"}"; ifname=$1; gsub(/:/,"",ifname); ipv4="—"; ipv6="—"; state="—"; if($0 ~ /flags:.*RUNNING/) state="UP"; }
  /inet / && ifname!="" { gsub(/.*inet /,""); gsub(/ netmask.*/,""); ipv4=$1; }
  /inet6 / && ifname!="" { gsub(/.*inet6 /,""); gsub(/ .*/,""); if(ipv6=="—") ipv6=$1; }
  ' | grep -v lo
fi
`

// ── macOS (darwin) scripts ──
// Linux tools (systemctl, ss, ip, /sys/class/net) don't exist on macOS, so
// darwin servers need their own equivalents using lsof/launchctl/ifconfig.

const darwinPortsScript = `
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | tail -n +2 | awk '{
    cmd=$1; pid=$2; addr=$(NF-1);
    printf "{\"protocol\":\"tcp\",\"state\":\"LISTEN\",\"local\":\"%s\",\"remote\":\"\",\"program\":\"%s\",\"pid\":\"%s\"}\n", addr, cmd, pid;
  }'
  lsof -nP -iUDP 2>/dev/null | tail -n +2 | awk '{
    cmd=$1; pid=$2; addr=$NF;
    printf "{\"protocol\":\"udp\",\"state\":\"—\",\"local\":\"%s\",\"remote\":\"\",\"program\":\"%s\",\"pid\":\"%s\"}\n", addr, cmd, pid;
  }'
elif command -v netstat >/dev/null 2>&1; then
  netstat -an -p tcp 2>/dev/null | awk '$1 ~ /^tcp/ && $NF=="LISTEN" {
    printf "{\"protocol\":\"tcp\",\"state\":\"LISTEN\",\"local\":\"%s\",\"remote\":\"\",\"program\":\"\",\"pid\":\"\"}\n", $4;
  }'
fi
`

const darwinServicesScript = `
if command -v launchctl >/dev/null 2>&1; then
  launchctl list 2>/dev/null | tail -n +2 | awk '{
    pid=$1; status=$2; label=$3;
    active = (pid != "-") ? "active" : "inactive";
    sub = (pid != "-") ? "running" : "stopped";
    if (status != "0" && status != "-") { active="failed"; }
    if (active=="active" || active=="failed") {
      printf "{\"name\":\"%s\",\"load\":\"loaded\",\"active\":\"%s\",\"sub\":\"%s\",\"description\":\"launchd job (pid %s)\"}\n", label, active, sub, pid;
    }
  }'
else
  echo "[]"
fi
`

const darwinInterfacesScript = `
if command -v ifconfig >/dev/null 2>&1; then
  # Fetch stats for every interface in a single call — invoking
  # "netstat -I <name> -b" once per interface is slow (each call
  # re-queries the network stack) and can push machines with many
  # interfaces (VMs, bridges, VPN tunnels) past the request timeout.
  netstat_out=$(netstat -ibn 2>/dev/null)
  for name in $(ifconfig -l 2>/dev/null); do
    case "$name" in lo*) continue ;; esac
    block=$(ifconfig "$name" 2>/dev/null)
    state="DOWN"
    echo "$block" | grep -q '<.*UP.*>' && state="UP"
    mtu=$(echo "$block" | grep -o 'mtu [0-9]*' | head -1 | awk '{print $2}')
    [ -z "$mtu" ] && mtu="—"
    ipv4=$(echo "$block" | awk '/inet / {print $2; exit}')
    [ -z "$ipv4" ] && ipv4="—"
    ipv6=$(echo "$block" | awk '/inet6 / {print $2; exit}')
    [ -z "$ipv6" ] && ipv6="—"
    stats=$(echo "$netstat_out" | awk -v n="$name" '$1==n {print; exit}')
    rx_packets=$(echo "$stats" | awk '{print $5}')
    rx_bytes=$(echo "$stats" | awk '{print $7}')
    tx_packets=$(echo "$stats" | awk '{print $8}')
    tx_bytes=$(echo "$stats" | awk '{print $10}')
    [ -z "$rx_packets" ] && rx_packets="0"
    [ -z "$rx_bytes" ] && rx_bytes="0"
    [ -z "$tx_packets" ] && tx_packets="0"
    [ -z "$tx_bytes" ] && tx_bytes="0"
    printf '{"name":"%s","flags":"","mtu":"%s","state":"%s","ipv4":"%s","ipv6":"%s","rx_bytes":"%s","tx_bytes":"%s","rx_packets":"%s","tx_packets":"%s"}\n' "$name" "$mtu" "$state" "$ipv4" "$ipv6" "$rx_bytes" "$tx_bytes" "$rx_packets" "$tx_packets"
  done
fi
`

// ── Windows scripts ──
// Executed via PowerShell (matches the convention used in logs.go/servers.go
// for windows targets). String literals use single quotes throughout since
// the whole script is itself wrapped in a double-quoted -Command argument.

const windowsHostnameCmd = `powershell -NoProfile -NonInteractive -Command "$env:COMPUTERNAME"`

const windowsUptimeCmd = `powershell -NoProfile -NonInteractive -Command "$b=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime; $u=(Get-Date)-$b; 'up ' + $u.Days + 'd ' + $u.Hours + 'h ' + $u.Minutes + 'm'"`

const windowsPortsScript = `powershell -NoProfile -NonInteractive -Command "
$procs = Get-Process | Select-Object Id, ProcessName
$tcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
foreach ($c in $tcp) {
  $proc = $procs | Where-Object { $_.Id -eq $c.OwningProcess } | Select-Object -First 1
  $prog = ''
  if ($proc) { $prog = $proc.ProcessName }
  $obj = [PSCustomObject]@{
    protocol = 'tcp'
    state = 'LISTEN'
    local = $c.LocalAddress.ToString() + ':' + $c.LocalPort
    remote = ''
    program = $prog
    pid = $c.OwningProcess.ToString()
  }
  $obj | ConvertTo-Json -Compress
}
$udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue
foreach ($c in $udp) {
  $proc = $procs | Where-Object { $_.Id -eq $c.OwningProcess } | Select-Object -First 1
  $prog = ''
  if ($proc) { $prog = $proc.ProcessName }
  $obj = [PSCustomObject]@{
    protocol = 'udp'
    state = '—'
    local = $c.LocalAddress.ToString() + ':' + $c.LocalPort
    remote = ''
    program = $prog
    pid = $c.OwningProcess.ToString()
  }
  $obj | ConvertTo-Json -Compress
}
"`

const windowsServicesScript = `powershell -NoProfile -NonInteractive -Command "
Get-CimInstance Win32_Service | ForEach-Object {
  $active = 'inactive'
  $sub = 'stopped'
  if ($_.State -eq 'Running') { $active = 'active'; $sub = 'running' }
  elseif ($_.StartMode -eq 'Auto') { $active = 'failed'; $sub = 'dead' }
  if ($active -eq 'active' -or $active -eq 'failed') {
    $obj = [PSCustomObject]@{
      name = $_.Name
      load = 'loaded'
      active = $active
      sub = $sub
      description = $_.DisplayName
    }
    $obj | ConvertTo-Json -Compress
  }
}
"`

const windowsInterfacesScript = `powershell -NoProfile -NonInteractive -Command "
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue
foreach ($a in $adapters) {
  $state = 'DOWN'
  if ($a.Status -eq 'Up') { $state = 'UP' }
  $ipv4 = ''
  $ipv6 = ''
  $addrs = Get-NetIPAddress -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue
  foreach ($ad in $addrs) {
    if ($ad.AddressFamily -eq 'IPv4' -and $ipv4 -eq '') { $ipv4 = $ad.IPAddress + '/' + $ad.PrefixLength }
    if ($ad.AddressFamily -eq 'IPv6' -and $ipv6 -eq '') { $ipv6 = $ad.IPAddress + '/' + $ad.PrefixLength }
  }
  if ($ipv4 -eq '') { $ipv4 = '—' }
  if ($ipv6 -eq '') { $ipv6 = '—' }
  $rxBytes = '0'; $txBytes = '0'; $rxPackets = '0'; $txPackets = '0'
  $stats = Get-NetAdapterStatistics -Name $a.Name -ErrorAction SilentlyContinue
  if ($stats) {
    $rxBytes = $stats.ReceivedBytes.ToString()
    $txBytes = $stats.SentBytes.ToString()
    $rxPackets = $stats.ReceivedUnicastPackets.ToString()
    $txPackets = $stats.SentUnicastPackets.ToString()
  }
  $obj = [PSCustomObject]@{
    name = $a.Name
    flags = $a.MediaConnectionState.ToString()
    mtu = $a.MtuSize.ToString()
    state = $state
    ipv4 = $ipv4
    ipv6 = $ipv6
    rx_bytes = $rxBytes
    tx_bytes = $txBytes
    rx_packets = $rxPackets
    tx_packets = $txPackets
  }
  $obj | ConvertTo-Json -Compress
}
"`

func GetServerNetworking(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// K8s-only clusters don't have SSH access
	if server.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "networking info requires an SSH-connected server"})
		return
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("SSH connection failed: %v", err)})
		return
	}

	info := NetworkingInfo{}

	hostnameCmd := "hostname -f 2>/dev/null || hostname"
	uptimeCmd := "uptime -p 2>/dev/null || uptime"
	portsScript := ssScript
	svcScriptToRun := svcScript
	ifaceScriptToRun := ifaceScript

	switch server.OS {
	case "darwin":
		portsScript = darwinPortsScript
		svcScriptToRun = darwinServicesScript
		ifaceScriptToRun = darwinInterfacesScript
	case "windows":
		hostnameCmd = windowsHostnameCmd
		uptimeCmd = windowsUptimeCmd
		portsScript = windowsPortsScript
		svcScriptToRun = windowsServicesScript
		ifaceScriptToRun = windowsInterfacesScript
	}
	// ss/netstat/ip live in sbin dirs an SSH exec session often can't see.
	if server.OS != "windows" {
		hostnameCmd = sshpool.PosixCommand(hostnameCmd)
		uptimeCmd = sshpool.PosixCommand(uptimeCmd)
		portsScript = sshpool.PosixCommand(portsScript)
		svcScriptToRun = sshpool.PosixCommand(svcScriptToRun)
		ifaceScriptToRun = sshpool.PosixCommand(ifaceScriptToRun)
	}

	// Hostname
	hostnameOut, _, _ := client.RunCommandTimeout(hostnameCmd, cmdTimeout)
	info.Hostname = strings.TrimSpace(hostnameOut)

	// Uptime
	uptimeOut, _, _ := client.RunCommandTimeout(uptimeCmd, cmdTimeout)
	info.Uptime = strings.TrimSpace(uptimeOut)

	// ── Listening Ports ──
	ssOut, _, err := client.RunCommandTimeout(portsScript, cmdTimeout)
	if err != nil {
		log.Printf("networking: ports query failed for server %d: %v", server.ID, err)
	}
	info.Ports = parsePorts(ssOut)

	// ── Services ──
	svcOut, _, err := client.RunCommandTimeout(svcScriptToRun, cmdTimeout)
	if err != nil {
		log.Printf("networking: services query failed for server %d: %v", server.ID, err)
	}
	info.Services = parseServices(svcOut)

	// ── Network Interfaces ──
	ifaceOut, _, err := client.RunCommandTimeout(ifaceScriptToRun, cmdTimeout)
	if err != nil {
		log.Printf("networking: interfaces query failed for server %d: %v", server.ID, err)
	}
	info.Interfaces = parseInterfaces(ifaceOut)

	c.JSON(http.StatusOK, info)
}

func parsePorts(output string) []ListeningPort {
	ports := []ListeningPort{}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || line[0] == '{' && len(line) < 3 {
			continue
		}

		var p ListeningPort
		if err := json.Unmarshal([]byte(line), &p); err == nil {
			// Enrich with well-known port descriptions
			if p.Program == "" {
				p.Program = describePort(p.Local)
			}
			ports = append(ports, p)
		}
	}
	return ports
}

func parseServices(output string) []SystemService {
	services := []SystemService{}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var s SystemService
		if err := json.Unmarshal([]byte(line), &s); err == nil {
			services = append(services, s)
		}
	}
	return services
}

func parseInterfaces(output string) []NetworkInterface {
	ifaces := []NetworkInterface{}
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || line[0] != '{' {
			continue
		}
		var iface NetworkInterface
		if err := json.Unmarshal([]byte(line), &iface); err == nil {
			ifaces = append(ifaces, iface)
		}
	}
	return ifaces
}

func describePort(addr string) string {
	// Extract port number from address like 0.0.0.0:80 or :::80
	parts := strings.Split(addr, ":")
	if len(parts) == 0 {
		return ""
	}
	portStr := parts[len(parts)-1]
	switch portStr {
	case "22":
		return "sshd"
	case "80":
		return "nginx/http"
	case "443":
		return "nginx/https"
	case "5432":
		return "postgresql"
	case "3306":
		return "mysql"
	case "6379":
		return "redis"
	case "27017":
		return "mongodb"
	case "8080":
		return "http-alt"
	case "9090":
		return "cockpit/metrics"
	case "53":
		return "dns"
	case "25":
		return "smtp"
	case "110":
		return "pop3"
	case "143":
		return "imap"
	case "3389":
		return "rdp"
	case "5601":
		return "kibana"
	case "9200":
		return "elasticsearch"
	case "9092":
		return "kafka"
	case "8443":
		return "https-alt"
	case "2181":
		return "zookeeper"
	case "2379":
		return "etcd"
	case "2380":
		return "etcd-raft"
	case "8888":
		return "jupyter"
	case "3000":
		return "grafana"
	case "10250":
		return "kubelet"
	case "10251":
		return "kube-scheduler"
	case "10252":
		return "kube-controller"
	case "10255":
		return "kubelet-read"
	case "5000":
		return "registry"
	default:
		return ""
	}
}
