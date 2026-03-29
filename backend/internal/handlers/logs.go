package handlers

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// GetLogs — paginated historical logs
func GetLogs(c *gin.Context) {
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
		query = query.Where("message ILIKE ?", "%"+search+"%")
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

// StreamLogs — WebSocket that tails /var/log/syslog live
func StreamLogs(c *gin.Context) {
	id := c.Param("id")
	serverID, _ := strconv.ParseUint(id, 10, 64)

	var server models.Server
	if err := db.DB.First(&server, serverID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
		return
	}

	room := fmt.Sprintf("server:%d:logs", serverID)
	client := ws.GlobalHub.Register(conn, room)

	// Start SSH log tailing in goroutine
	go tailLogs(server, room)

	client.ReadPump(ws.GlobalHub, nil)
}

func tailLogs(server models.Server, room string) {
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
	session.Stderr = nil

	cmd := "tail -F /var/log/syslog 2>/dev/null || tail -F /var/log/messages 2>/dev/null || journalctl -f --no-pager 2>/dev/null"
	if err := session.Start(cmd); err != nil {
		return
	}

	buf := make([]byte, 4096)
	for {
		n, err := pr.Read(buf)
		if n > 0 {
			line := string(buf[:n])
			entry := models.LogEntry{
				ServerID:  server.ID,
				Timestamp: time.Now(),
				Stream:    "syslog",
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
	for _, w := range []string{"error", "ERR", "ERROR", "CRITICAL", "CRIT"} {
		if contains(line, w) {
			return "error"
		}
	}
	for _, w := range []string{"warn", "WARN", "WARNING"} {
		if contains(line, w) {
			return "warn"
		}
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
