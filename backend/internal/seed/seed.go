package seed

import (
	"log"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

func Run() {
	seedUsers()
	seedAlertRules()
}

func seedUsers() {
	type seedUser struct {
		username string
		password string
		role     string
		email    string
	}

	users := []seedUser{
		{"admin",   "infra123",   "admin",   "admin@infraeye.local"},
		{"devops",  "devops123",  "devops",  "devops@infraeye.local"},
		{"trainee", "trainee123", "trainee", "trainee@infraeye.local"},
		{"intern",  "intern123",  "intern",  "intern@infraeye.local"},
	}

	for _, u := range users {
		var count int64
		db.DB.Model(&models.User{}).Where("username = ?", u.username).Count(&count)
		if count == 0 {
			hash, _ := bcrypt.GenerateFromPassword([]byte(u.password), bcrypt.DefaultCost)
			db.DB.Create(&models.User{
				Username:     u.username,
				PasswordHash: string(hash),
				Role:         u.role,
				Email:        u.email,
				IsActive:     true,
			})
		}
	}

	log.Println("✅ Seed check complete for default RBAC users: admin, devops, trainee, intern")
}

func seedAlertRules() {
	var count int64
	db.DB.Model(&models.AlertRule{}).Count(&count)
	if count > 0 {
		return
	}

	rules := []models.AlertRule{
		{
			Name:            "High CPU Alert",
			ConditionType:   "cpu",
			ConditionOp:     "gt",
			ConditionValue:  "85",
			Severity:        "critical",
			ActionType:      "ssh_command",
			ActionCommand:   "ps aux --sort=-%cpu | head -5 >> /tmp/infra-eye-cpu-alert.log",
			CooldownMinutes: 10,
			Enabled:         true,
			Description:     "Alert when CPU exceeds 85%",
		},
		{
			Name:            "High Memory Alert",
			ConditionType:   "mem",
			ConditionOp:     "gt",
			ConditionValue:  "90",
			Severity:        "critical",
			ActionType:      "ssh_command",
			ActionCommand:   "free -h >> /tmp/infra-eye-mem-alert.log",
			CooldownMinutes: 10,
			Enabled:         true,
			Description:     "Alert when memory exceeds 90%",
		},
		{
			Name:            "Disk Space Warning",
			ConditionType:   "disk",
			ConditionOp:     "gt",
			ConditionValue:  "80",
			Severity:        "warning",
			ActionType:      "notify",
			CooldownMinutes: 30,
			Enabled:         true,
			Description:     "Alert when disk usage exceeds 80%",
		},
	}

	for _, rule := range rules {
		db.DB.Create(&rule)
	}
	log.Println("✅ Seeded default alert rules")
}
