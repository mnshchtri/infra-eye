package logger

import (
	"fmt"
	"time"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
)

// RecordLog saves a log entry to the database and broadcasts it via WebSocket
func RecordLog(serverID uint, stream, level, message string) {
	entry := models.LogEntry{
		ServerID:  serverID,
		Timestamp: time.Now(),
		Stream:    stream,
		Level:     level,
		Message:   message,
	}

	// Save to DB
	if err := db.DB.Create(&entry).Error; err != nil {
		fmt.Printf("❌ Failed to save log to DB: %v\n", err)
		return
	}

	// Broadcast via WebSocket
	room := fmt.Sprintf("server:%d:logs", serverID)
	ws.GlobalHub.Broadcast(room, "log", entry)
}
