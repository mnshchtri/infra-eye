package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
)

// UpgradeConn is a shared WebSocket upgrader used across handlers
func UpgradeConn(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("❌ WS upgrade failure: %v (client: %s, agent: %s)", err, r.RemoteAddr, r.UserAgent())
	}
	return conn, err
}

// MetricsWSHandler subscribes a WS connection to the server metrics room
func MetricsWSHandler(conn *websocket.Conn, serverID string) {
	room := fmt.Sprintf("server:%s:metrics", serverID)
	client := ws.GlobalHub.Register(conn, room)
	// Read until client disconnects (to detect disconnection)
	client.ReadPump(ws.GlobalHub, nil)
}

// AllMetricsWSHandler subscribes a WS connection to all available server metrics rooms
func AllMetricsWSHandler(conn *websocket.Conn) {
	var servers []models.Server
	db.DB.Find(&servers)

	// Register with a dummy room first
	client := ws.GlobalHub.Register(conn, "all_metrics")

	for _, s := range servers {
		room := fmt.Sprintf("server:%d:metrics", s.ID)
		ws.GlobalHub.JoinRoom(client, room)
	}

	// Read until client disconnects
	client.ReadPump(ws.GlobalHub, nil)
}
