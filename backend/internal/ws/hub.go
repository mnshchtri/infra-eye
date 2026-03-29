package ws

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

// Message is the envelope for all WebSocket messages
type Message struct {
	Type    string          `json:"type"`
	Room    string          `json:"room"`
	Payload json.RawMessage `json:"payload"`
}

// Client represents a connected WebSocket client
type Client struct {
	conn  *websocket.Conn
	send  chan []byte
	rooms map[string]bool
}

// Hub manages all connected clients
type Hub struct {
	mu      sync.RWMutex
	rooms   map[string]map[*Client]bool // room -> clients
	clients map[*Client]bool
}

var GlobalHub = NewHub()

func NewHub() *Hub {
	return &Hub{
		rooms:   make(map[string]map[*Client]bool),
		clients: make(map[*Client]bool),
	}
}

func (h *Hub) Register(conn *websocket.Conn, room string) *Client {
	client := &Client{
		conn:  conn,
		send:  make(chan []byte, 256),
		rooms: map[string]bool{room: true},
	}
	h.mu.Lock()
	if h.rooms[room] == nil {
		h.rooms[room] = make(map[*Client]bool)
	}
	h.rooms[room][client] = true
	h.clients[client] = true
	h.mu.Unlock()

	go client.writePump()
	return client
}

func (h *Hub) Unregister(client *Client) {
	h.mu.Lock()
	for room := range client.rooms {
		delete(h.rooms[room], client)
		if len(h.rooms[room]) == 0 {
			delete(h.rooms, room)
		}
	}
	delete(h.clients, client)
	h.mu.Unlock()
	close(client.send)
}

// Broadcast sends a message to all clients in a room
func (h *Hub) Broadcast(room string, msgType string, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WS broadcast marshal error: %v", err)
		return
	}

	msg := Message{Type: msgType, Room: room, Payload: data}
	raw, _ := json.Marshal(msg)

	h.mu.RLock()
	clients := h.rooms[room]
	h.mu.RUnlock()

	for client := range clients {
		select {
		case client.send <- raw:
		default:
			// slow client — drop
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (c *Client) ReadPump(hub *Hub, onMessage func([]byte)) {
	defer hub.Unregister(c)
	for {
		_, msg, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		if onMessage != nil {
			onMessage(msg)
		}
	}
}
