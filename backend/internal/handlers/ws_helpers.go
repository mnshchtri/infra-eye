package handlers

import (
	"fmt"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
)

// upgradeConn is the raw upgrade. Unexported on purpose: an untracked socket
// outlives its owner's deactivation, so UpgradeTracked is the only way in.
func upgradeConn(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("❌ WS upgrade failure: %v (client: %s, agent: %s)", err, r.RemoteAddr, r.UserAgent())
	}
	return conn, err
}

// UpgradeTracked upgrades the request and registers the resulting connection
// against the authenticated user, returning a release func the caller must
// defer.
//
// Every WebSocket handler must go through this rather than calling the upgrader
// directly. A socket authenticates once at the handshake and then never
// re-enters the auth middleware, so an untracked connection is one that
// survives its owner being deactivated — for a pod shell or SSH terminal, that
// means commands still executing against production after offboarding.
func UpgradeTracked(c *gin.Context) (*websocket.Conn, func(), error) {
	conn, err := upgradeConn(c.Writer, c.Request)
	if err != nil {
		return nil, func() {}, err
	}
	return conn, ws.Track(c.GetUint("user_id"), conn), nil
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
