package handlers

import (
	"log"
	"time"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
)

// wsSessionSweepInterval bounds how long a deactivated account's already-open
// sockets can survive. UpdateUser closes them immediately, so this is the
// backstop for every other way an account can stop being valid: a direct DB
// edit, an OIDC role sync, a row deleted out from under a live session.
const wsSessionSweepInterval = 30 * time.Second

// StartWSSessionSweeper periodically closes WebSockets belonging to accounts
// that are no longer active.
//
// A socket authenticates once at the upgrade handshake and then runs its own
// read loop, so the per-request IsActive check in middleware.Auth() never sees
// it again. Without this, deactivating someone mid-session leaves their open
// pod shell or SSH terminal executing commands against production until the
// socket happens to close on its own.
func StartWSSessionSweeper() {
	go func() {
		ticker := time.NewTicker(wsSessionSweepInterval)
		defer ticker.Stop()
		for range ticker.C {
			sweepWSSessions()
		}
	}()
}

// sweepWSSessions closes the sockets of any tracked user who is no longer
// active or no longer exists.
func sweepWSSessions() {
	userIDs := ws.TrackedUserIDs()
	if len(userIDs) == 0 {
		return
	}

	// Ask only about users who actually hold a socket, and only for the two
	// columns that matter.
	var live []models.User
	if err := db.DB.Select("id").Where("id IN ? AND is_active = ?", userIDs, true).Find(&live).Error; err != nil {
		// A database blip must not disconnect anyone — the same reasoning as
		// middleware.Auth() answering 500 rather than 401. Skip this round.
		log.Printf("WS session sweep skipped: %v", err)
		return
	}

	stillValid := make(map[uint]bool, len(live))
	for _, u := range live {
		stillValid[u.ID] = true
	}
	for _, id := range userIDs {
		if !stillValid[id] {
			if n := ws.CloseUser(id); n > 0 {
				log.Printf("🔒 closed %d WebSocket(s) for user %d (deactivated or removed)", n, id)
			}
		}
	}
}

// DisconnectUserSockets closes every live WebSocket for a user. Called when an
// admin deactivates or deletes an account so the effect is immediate rather
// than waiting up to one sweep interval.
func DisconnectUserSockets(userID uint) {
	if n := ws.CloseUser(userID); n > 0 {
		log.Printf("🔒 closed %d WebSocket(s) for user %d (account change)", n, userID)
	}
}
