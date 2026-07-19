package resources

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
)

const (
	pollInterval  = 60 * time.Second
	retentionDays = 7
)

// StartCollector launches a background loop that probes every resource on an
// interval, updates its live status, and appends a ResourceMetric history row.
// Mirrors the metrics/healing engines: one goroutine, ticker-driven, best-effort.
func StartCollector() {
	go func() {
		// Prime once shortly after boot so the UI isn't empty on first load.
		time.Sleep(5 * time.Second)
		collectAll()

		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		cleanup := time.NewTicker(6 * time.Hour)
		defer cleanup.Stop()

		for {
			select {
			case <-ticker.C:
				collectAll()
			case <-cleanup.C:
				pruneHistory()
			}
		}
	}()
	log.Println("✅ Resource observability collector started")
}

func collectAll() {
	var list []models.Resource
	if err := db.DB.Find(&list).Error; err != nil {
		return
	}
	for _, r := range list {
		if r.Host == "" || r.Port == 0 {
			continue
		}
		go CollectOne(r) // probes are network-bound; fan out
	}
}

// CollectOne probes a single resource and persists the snapshot. Exported so the
// on-demand handler can force a fresh sample and reuse the same write path.
func CollectOne(r models.Resource) ProbeResult {
	res := Probe(context.Background(), r)

	metricsJSON, _ := json.Marshal(res.Metrics)
	db.DB.Create(&models.ResourceMetric{
		ResourceID: r.ID,
		Timestamp:  time.Now(),
		Status:     res.Status,
		LatencyMs:  res.LatencyMs,
		Error:      res.Error,
		Metrics:    string(metricsJSON),
	})
	db.DB.Model(&models.Resource{}).Where("id = ?", r.ID).Update("status", res.Status)
	return res
}

func pruneHistory() {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	db.DB.Where("timestamp < ?", cutoff).Delete(&models.ResourceMetric{})
}
