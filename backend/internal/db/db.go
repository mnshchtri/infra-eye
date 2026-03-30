package db

import (
	"log"

	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect() {
	var err error
	logLevel := logger.Error
	if config.C.Env == "development" {
		logLevel = logger.Info
	}

	DB, err = gorm.Open(postgres.Open(config.C.DBDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("✅ Database connected")

	// Auto-migrate all models
	if err := DB.AutoMigrate(
		&models.User{},
		&models.Server{},
		&models.Metric{},
		&models.LogEntry{},
		&models.AlertRule{},
		&models.HealingAction{},
		&models.ChatMessage{},
		&models.ChatThread{},
	); err != nil {
		log.Fatalf("Auto-migrate failed: %v", err)
	}

	log.Println("✅ Database migrated")
}
