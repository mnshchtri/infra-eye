package db

import (
	"log"

	"github.com/glebarez/sqlite"
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

	var dialector gorm.Dialector
	if config.C.DBDriver == "sqlite" {
		dialector = sqlite.Open(config.C.DBDSN)
	} else {
		dialector = postgres.Open(config.C.DBDSN)
	}

	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logLevel),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("✅ Database connected")

	// Auto-migrate all models
	if err := DB.AutoMigrate(
		&models.User{},
		&models.Folder{},
		&models.Server{},
		&models.ServerAccess{},
		&models.Resource{},
		&models.ResourceAccess{},
		&models.ResourceAudit{},
		&models.ResourceMetric{},
		&models.Metric{},
		&models.LogEntry{},
		&models.AlertRule{},
		&models.HealingAction{},
		&models.ChatMessage{},
		&models.ChatThread{},
		&models.AppSetting{},
		&models.SecurityScan{},
	); err != nil {
		log.Fatalf("Auto-migrate failed: %v", err)
	}

	log.Println("✅ Database migrated")

	// Ensure all servers with KubeConfig are flagged as IsK8s
	DB.Model(&models.Server{}).Where("kube_config != ? AND is_k8s = ?", "", false).Update("is_k8s", true)
}

// GetSetting returns the stored value for a platform setting key, or "" when
// unset (callers fall back to their env-var default).
func GetSetting(key string) string {
	if DB == nil {
		return ""
	}
	var s models.AppSetting
	if err := DB.First(&s, "key = ?", key).Error; err != nil {
		return ""
	}
	return s.Value
}

// SetSetting upserts a platform setting. An empty value clears it, restoring
// the env-var default.
func SetSetting(key, value string) error {
	return DB.Save(&models.AppSetting{Key: key, Value: value}).Error
}
