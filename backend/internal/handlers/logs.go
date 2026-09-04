package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// GetLogs — paginated historical logs
func GetLogs(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	stream := c.Query("stream")
	level := c.Query("level")
	search := c.Query("search")

	if page < 1 {
		page = 1
	}
	if limit > 500 {
		limit = 500
	}
	offset := (page - 1) * limit

	query := db.DB.Where("server_id = ?", id)
	if stream != "" {
		query = query.Where("stream = ?", stream)
	}
	if level != "" {
		query = query.Where("level = ?", level)
	}
	if search != "" {
		if db.DB.Name() == "postgres" {
			query = query.Where("message ILIKE ?", "%"+search+"%")
		} else {
			query = query.Where("LOWER(message) LIKE LOWER(?)", "%"+search+"%")
		}
	}

	var total int64
	query.Model(&models.LogEntry{}).Count(&total)

	var logs []models.LogEntry
	query.Order("timestamp DESC").Limit(limit).Offset(offset).Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"data":  logs,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// LogStatsBucket is one fixed-width time bucket of fleet-wide log volume by level.
type LogStatsBucket struct {
	T     int64 `json:"t"` // bucket start, unix ms
	Info  int   `json:"info"`
	Warn  int   `json:"warn"`
	Error int   `json:"error"`
}

// GetLogStats aggregates log volume by level over fixed time buckets, across
// every server the caller can see — for the Dashboard's fleet-wide log/error
// trend chart. Bucketed in Go rather than SQL (date_trunc etc.) so this stays
// portable between the Postgres and SQLite (desktop app) backends.
func GetLogStats(c *gin.Context) {
	minutes, _ := strconv.Atoi(c.DefaultQuery("minutes", "60"))
	if minutes <= 0 || minutes > 1440 {
		minutes = 60
	}
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)

	role := c.GetString("role")
	userID := c.GetUint("user_id")

	query := db.DB.Model(&models.LogEntry{}).Where("timestamp >= ?", since)
	if role != "admin" && role != "devops" {
		query = query.Where("server_id IN (SELECT server_id FROM server_accesses WHERE user_id = ? AND deleted_at IS NULL)", userID)
	}

	var entries []models.LogEntry
	if err := query.Select("timestamp", "level").Find(&entries).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	const numBuckets = 24
	bucketDur := time.Duration(minutes) * time.Minute / numBuckets

	buckets := make([]LogStatsBucket, numBuckets)
	for i := range buckets {
		buckets[i].T = since.Add(time.Duration(i) * bucketDur).UnixMilli()
	}

	totals := LogStatsBucket{}
	for _, e := range entries {
		idx := int(e.Timestamp.Sub(since) / bucketDur)
		if idx < 0 {
			idx = 0
		}
		if idx >= numBuckets {
			idx = numBuckets - 1
		}
		switch e.Level {
		case "error":
			buckets[idx].Error++
			totals.Error++
		case "warn":
			buckets[idx].Warn++
			totals.Warn++
		default:
			buckets[idx].Info++
			totals.Info++
		}
	}

	c.JSON(http.StatusOK, gin.H{"buckets": buckets, "totals": totals})
}

func ClearLogs(c *gin.Context) {
	id := c.Param("id")
	if err := db.DB.Where("server_id = ?", id).Delete(&models.LogEntry{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "logs cleared successfully"})
}

// LogSource describes one selectable log stream. Group is used by the UI to
// render <optgroup> sections (cluster sources can number in the hundreds).
type LogSource struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Group string `json:"group,omitempty"`
}

// LogSources — GET /servers/:id/log-sources : the selectable log streams for
// this server's OS (journalctl unit, syslog, auth, kernel, …).
func LogSources(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	var server models.Server
	if err := db.DB.First(&server, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	// Direct-API Kubernetes clusters have no SSH host — their sources are the
	// cluster streams: events, node events, and pod logs per workload/service/pod.
	if server.Host == "" && server.IsK8s {
		c.JSON(http.StatusOK, gin.H{"os": "kubernetes", "sources": buildK8sLogSources(server)})
		return
	}

	var sources []LogSource
	switch server.OS {
	case "darwin":
		sources = []LogSource{
			{ID: "system", Label: "System (unified log)"},
			{ID: "errors", Label: "Errors & Faults"},
			{ID: "auth", Label: "Authentication / SSH"},
			{ID: "install", Label: "Install log"},
		}
	case "windows":
		sources = []LogSource{
			{ID: "system", Label: "System"},
			{ID: "application", Label: "Application"},
			{ID: "security", Label: "Security"},
		}
	default: // linux
		sources = []LogSource{
			{ID: "journal", Label: "Journal (all units)"},
			{ID: "syslog", Label: "Syslog"},
			{ID: "auth", Label: "Authentication / SSH"},
			{ID: "kernel", Label: "Kernel (dmesg)"},
			{ID: "boot", Label: "Current boot"},
		}
	}
	// SSH-managed clusters get both: host system logs AND the cluster streams.
	if server.IsK8s && server.KubeConfig != "" {
		for i := range sources {
			sources[i].Group = "Host system (SSH)"
		}
		sources = append(sources, buildK8sLogSources(server)...)
	}
	c.JSON(http.StatusOK, gin.H{"sources": sources, "os": server.OS})
}

// normalizeSource maps an empty/absent source to the OS default so the room
// name and stored Stream tag are stable.
func normalizeSource(os, source string) string {
	if source != "" {
		return source
	}
	if os == "darwin" {
		return "system"
	}
	return "journal"
}

// logStreamCommand returns the shell command that tails the given source on the
// server's OS. It always seeds the last 50 lines then follows.
func logStreamCommand(server models.Server, source string) string {
	switch server.OS {
	case "darwin":
		switch source {
		case "errors":
			return `/usr/bin/log show --last 2m --style syslog --predicate 'messageType == error OR messageType == fault'; /usr/bin/log stream --style syslog --level error`
		case "auth":
			return `/usr/bin/log show --last 5m --style syslog --predicate 'process == "sshd" OR process == "sudo" OR process == "authd" OR eventMessage CONTAINS[c] "authentication"'; /usr/bin/log stream --style syslog --predicate 'process == "sshd" OR process == "sudo" OR process == "authd"'`
		case "install":
			return `tail -n 50 -f /var/log/install.log`
		default: // system
			return `/usr/bin/log show --last 2m --style syslog; /usr/bin/log stream --style syslog --level info`
		}
	case "windows":
		logName := "System"
		switch source {
		case "application":
			logName = "Application"
		case "security":
			logName = "Security"
		}
		return fmt.Sprintf(`powershell -Command "$lastTime = [DateTime]::Now; Get-WinEvent -LogName %s -MaxEvents 50 | Sort-Object TimeCreated; while($true) { $newEvents = Get-WinEvent -LogName %s -FilterHashtable @{LogName='%s'; StartTime=$lastTime} -ErrorAction SilentlyContinue | Where-Object { $_.TimeCreated -gt $lastTime } | Sort-Object TimeCreated; if ($newEvents) { $newEvents | ForEach-Object { Write-Host \"[$($_.TimeCreated.ToString('HH:mm:ss'))] [$($_.LevelDisplayName)] $($_.Message)\" }; $lastTime = $newEvents[-1].TimeCreated }; Start-Sleep -Milliseconds 1000 }"`, logName, logName, logName)
	default: // linux
		switch source {
		case "syslog":
			return `tail -n 50 -F /var/log/syslog 2>/dev/null || tail -n 50 -F /var/log/messages 2>/dev/null`
		case "auth":
			return `tail -n 50 -F /var/log/auth.log 2>/dev/null || tail -n 50 -F /var/log/secure 2>/dev/null || journalctl -n 50 -f -u ssh -u sshd -u sudo 2>/dev/null`
		case "kernel":
			return `journalctl -k -n 50 -f 2>/dev/null || dmesg -w 2>/dev/null || tail -n 50 -F /var/log/kern.log 2>/dev/null`
		case "boot":
			return `journalctl -b -n 50 -f 2>/dev/null || tail -n 50 -F /var/log/syslog 2>/dev/null`
		default: // journal
			return `journalctl -n 50 -f 2>/dev/null || tail -n 50 -F /var/log/syslog 2>/dev/null || tail -n 50 -F /var/log/messages 2>/dev/null`
		}
	}
}

// StreamLogs — WebSocket that tails the selected system log source live.
func StreamLogs(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id := c.Param("id")
	serverID, _ := strconv.ParseUint(id, 10, 64)
	source := c.Query("source")

	var server models.Server
	if err := db.DB.First(&server, serverID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	conn, release, err := UpgradeTracked(c)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}
	defer release()

	// Room is scoped to the selected source so viewers of different sources on
	// the same server don't cross-contaminate each other's streams.
	// A cluster source (events/node:/workload:/service:/pod:) streams from the
	// Kubernetes API; anything else tails the host over SSH.
	isCluster := server.IsK8s && server.KubeConfig != "" && (isK8sLogSource(source) || (server.Host == "" && source == ""))
	roomSource := source
	if isCluster {
		if roomSource == "" {
			roomSource = "events"
		}
	} else {
		roomSource = normalizeSource(server.OS, source)
	}
	room := fmt.Sprintf("server:%d:logs:%s", serverID, roomSource)
	client := ws.GlobalHub.Register(conn, room)

	// Start log tailing, tied to this connection's lifetime. When the client
	// disconnects (e.g. the user switches source, which closes the old socket),
	// stop the tail so it doesn't keep running and leak into the next view.
	stop := make(chan struct{})
	switch {
	case isCluster && (roomSource == "events" || roomSource == "warnings"):
		go streamClusterEvents(server, room, roomSource, "", stop)
	case isCluster && strings.HasPrefix(roomSource, "node:"):
		nodeName := strings.TrimPrefix(roomSource, "node:")
		go streamClusterEvents(server, room, roomSource, "involvedObject.kind=Node,involvedObject.name="+nodeName, stop)
	case isCluster:
		go streamK8sPodLogs(server, room, roomSource, stop)
	default:
		go tailLogs(server, room, source, stop)
	}

	client.ReadPump(ws.GlobalHub, nil)
	close(stop)
}

// streamClusterEvents polls the cluster's Kubernetes events and emits new ones
// as log entries (warnings, scheduling, image pulls, restarts, …). A non-empty
// fieldSelector narrows the stream, e.g. to a single node's events.
func streamClusterEvents(server models.Server, room, source, fieldSelector string, stop <-chan struct{}) {
	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		ws.GlobalHub.Broadcast(room, "error", gin.H{"message": fmt.Sprintf("cluster connection failed: %v", err)})
		return
	}

	warningsOnly := source == "warnings"
	seen := map[string]bool{}
	ticker := time.NewTicker(4 * time.Second)
	defer ticker.Stop()

	emit := func() {
		evList, err := clientset.CoreV1().Events("").List(context.TODO(), metav1.ListOptions{Limit: 300, FieldSelector: fieldSelector})
		if err != nil {
			ws.GlobalHub.Broadcast(room, "error", gin.H{"message": fmt.Sprintf("event fetch failed: %v", err)})
			return
		}
		// Sort by last-seen time so a seed pass emits in chronological order.
		items := evList.Items
		sort.Slice(items, func(i, j int) bool {
			return items[i].LastTimestamp.Time.Before(items[j].LastTimestamp.Time)
		})
		for _, e := range items {
			key := string(e.UID) + ":" + strconv.Itoa(int(e.Count))
			if seen[key] {
				continue
			}
			seen[key] = true
			if warningsOnly && e.Type != "Warning" {
				continue
			}
			level := "info"
			if e.Type == "Warning" {
				level = "warn"
			}
			ts := e.LastTimestamp.Time
			if ts.IsZero() {
				ts = e.CreationTimestamp.Time
			}
			obj := e.InvolvedObject.Kind + "/" + e.InvolvedObject.Name
			ns := e.InvolvedObject.Namespace
			if ns == "" {
				ns = e.Namespace
			}
			msg := fmt.Sprintf("[%s] %s %s: %s", ns, obj, e.Reason, e.Message)
			entry := models.LogEntry{
				ServerID:  server.ID,
				Timestamp: ts,
				Stream:    source,
				Level:     level,
				Message:   msg,
				Source:    e.Source.Component,
			}
			db.DB.Create(&entry)
			ws.GlobalHub.Broadcast(room, "log", entry)
		}
	}

	emit()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			emit()
		}
	}
}

func tailLogs(server models.Server, room string, source string, stop <-chan struct{}) {
	sshClient, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		ws.GlobalHub.Broadcast(room, "error", gin.H{"message": fmt.Sprintf("SSH connect failed: %v", err)})
		return
	}

	session, err := sshClient.NewSession()
	if err != nil {
		ws.GlobalHub.Broadcast(room, "error", gin.H{"message": fmt.Sprintf("SSH session failed: %v", err)})
		return
	}
	defer session.Close()

	pr, err := session.StdoutPipe()
	if err != nil {
		return
	}
	// Capture stderr too (instead of discarding it) so real failures — e.g. a
	// macOS `log`/`log stream` call blocked by TCC because sshd lacks Full
	// Disk Access — show up as visible error entries instead of an empty list.
	errPr, err := session.StderrPipe()
	if err != nil {
		return
	}

	// Build the tail command for the requested log source (journal/syslog/auth/…).
	// The macOS branch omits stderr redirection so TCC/permission errors surface
	// as visible entries; absolute /usr/bin/log avoids a shell "log" alias.
	cmd := logStreamCommand(server, source)

	if server.OS == "linux" {
		if server.AuthType == "password" && server.SSHPassword != "" && server.SSHUser != "root" {
			// Wrap command in sudo with password pipe to reach restricted logs
			// (auth.log, kernel), falling back to the unprivileged command.
			cmd = fmt.Sprintf("echo '%s' | sudo -S sh -c '%s' 2>/dev/null || sh -c '%s'", server.SSHPassword, cmd, cmd)
		} else if server.SSHUser != "root" {
			cmd = fmt.Sprintf("sudo -n sh -c '%s' 2>/dev/null || sh -c '%s'", cmd, cmd)
		}
	}

	// Tag stored entries with the source so the UI filter and history work.
	stream := normalizeSource(server.OS, source)

	if err := session.Start(cmd); err != nil {
		ws.GlobalHub.Broadcast(room, "error", gin.H{"message": fmt.Sprintf("Failed to start log stream: %v", err)})
		return
	}

	// When the client disconnects, closing the session unblocks the pipe reads
	// below and terminates the remote `journalctl -f` / `log stream` process.
	go func() {
		<-stop
		session.Close()
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := errPr.Read(buf)
			if n > 0 {
				line := string(buf[:n])
				entry := models.LogEntry{
					ServerID:  server.ID,
					Timestamp: time.Now(),
					Stream:    stream,
					Level:     "error",
					Message:   line,
				}
				db.DB.Create(&entry)
				ws.GlobalHub.Broadcast(room, "log", entry)
			}
			if err != nil {
				return
			}
		}
	}()

	buf := make([]byte, 4096)
	for {
		n, err := pr.Read(buf)
		if n > 0 {
			line := string(buf[:n])
			entry := models.LogEntry{
				ServerID:  server.ID,
				Timestamp: time.Now(),
				Stream:    stream,
				Level:     detectLevel(line),
				Message:   line,
			}
			db.DB.Create(&entry)
			ws.GlobalHub.Broadcast(room, "log", entry)
		}
		if err != nil {
			break
		}
	}
}

func detectLevel(line string) string {
	l := strings.ToLower(line)
	for _, w := range []string{"error", "err", "critical", "crit", "fatal", "emergency"} {
		if strings.Contains(l, w) {
			return "error"
		}
	}
	for _, w := range []string{"warn", "warning", "alert"} {
		if strings.Contains(l, w) {
			return "warn"
		}
	}
	if strings.Contains(l, "debug") {
		return "info" // Could add debug level if needed
	}
	return "info"
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && len(sub) > 0 && fmt.Sprintf("%s", s) != "" &&
		len(s) > 0 && findSubstring(s, sub)
}

func findSubstring(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
