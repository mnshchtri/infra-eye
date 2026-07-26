package gitsync

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/infra-eye/backend/internal/db"
)

var engineCancel context.CancelFunc

// StartEngine begins the scheduled sync loop. The interval is read once at
// start (db.GetSetting, falling back to defaultIntervalMinutes) — like the
// rest of the codebase, there's no hot-reload precedent, so a changed
// interval takes effect on next restart. Each tick is a no-op unless
// gitsync.enabled is "true", so this is safe to always start.
func StartEngine() {
	interval := defaultIntervalMinutes
	if v := db.GetSetting(SettingIntervalMinutes); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			interval = n
		}
	}

	ctx, cancel := context.WithCancel(context.Background())
	engineCancel = cancel
	go func() {
		ticker := time.NewTicker(time.Duration(interval) * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if db.GetSetting(SettingEnabled) == "true" {
					RunSync("scheduled")
				}
			}
		}
	}()
	log.Println("✅ Git-sync engine started")
}

// StopEngine cancels the running sync ticker, if any. Used on desktop-app
// shutdown so the goroutine doesn't keep firing after the DB closes.
func StopEngine() {
	if engineCancel != nil {
		engineCancel()
		engineCancel = nil
	}
}
