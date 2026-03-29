package handlers

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
)

func GetMetrics(c *gin.Context) {
	id := c.Param("id")
	minutesStr := c.DefaultQuery("minutes", "60")
	minutes, _ := strconv.Atoi(minutesStr)
	if minutes <= 0 {
		minutes = 60
	}

	since := time.Now().Add(-time.Duration(minutes) * time.Minute)

	var metrics []models.Metric
	db.DB.Where("server_id = ? AND timestamp >= ?", id, since).
		Order("timestamp ASC").
		Limit(500).
		Find(&metrics)

	c.JSON(http.StatusOK, metrics)
}

func GetLatestMetric(c *gin.Context) {
	id := c.Param("id")
	var metric models.Metric
	if err := db.DB.Where("server_id = ?", id).
		Order("timestamp DESC").
		First(&metric).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no metrics found"})
		return
	}
	c.JSON(http.StatusOK, metric)
}
