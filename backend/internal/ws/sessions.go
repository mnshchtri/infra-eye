package ws

import (
	"sync"

	"github.com/gorilla/websocket"
)

// A WebSocket authenticates once, at the upgrade handshake, and then runs its
// own read loop — it never re-enters the HTTP auth middleware. Without a way to
// reach back into live sockets, deactivating an account leaves any terminal,
// pod shell, or log stream the user already had open running until the socket
// happens to close. This registry is that reach-back: every upgraded connection
// is tracked against its user so it can be closed on demand.
//
// Deliberately free of any database dependency, so this package stays a generic
// pub/sub layer. Deciding *which* users should be cut off is the caller's job
// (see handlers.StartWSSessionSweeper).

type trackedConn struct {
	userID uint
	conn   *websocket.Conn
}

var (
	sessionsMu sync.Mutex
	sessionSeq uint64
	sessions   = map[uint64]trackedConn{}
)

// Track registers a live connection against the user who opened it and returns
// a release func the caller must defer. Releasing on natural disconnect is what
// keeps this map from growing for the life of the process.
func Track(userID uint, conn *websocket.Conn) (release func()) {
	sessionsMu.Lock()
	sessionSeq++
	id := sessionSeq
	sessions[id] = trackedConn{userID: userID, conn: conn}
	sessionsMu.Unlock()

	return func() {
		sessionsMu.Lock()
		delete(sessions, id)
		sessionsMu.Unlock()
	}
}

// CloseUser force-closes every tracked connection belonging to userID and
// reports how many it closed. Closing the underlying conn unblocks whatever
// read loop the handler is sitting in, which is what actually terminates an
// in-flight SSH or kubectl exec session.
func CloseUser(userID uint) int {
	sessionsMu.Lock()
	var doomed []*websocket.Conn
	for id, s := range sessions {
		if s.userID == userID {
			doomed = append(doomed, s.conn)
			// Drop it here rather than waiting for the handler's release, so a
			// repeated sweep doesn't try to close the same socket twice.
			delete(sessions, id)
		}
	}
	sessionsMu.Unlock()

	for _, c := range doomed {
		_ = c.Close()
	}
	return len(doomed)
}

// TrackedUserIDs returns the distinct users with at least one live connection,
// so a sweeper can check just those accounts instead of the whole table.
func TrackedUserIDs() []uint {
	sessionsMu.Lock()
	defer sessionsMu.Unlock()

	seen := map[uint]bool{}
	out := make([]uint, 0, len(sessions))
	for _, s := range sessions {
		if !seen[s.userID] {
			seen[s.userID] = true
			out = append(out, s.userID)
		}
	}
	return out
}
