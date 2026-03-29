package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/ws"
)

// UpgradeConn is a shared WebSocket upgrader used across handlers
func UpgradeConn(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade error: %v", err)
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
