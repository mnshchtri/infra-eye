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
	var count int64
	db.DB.Model(&models.User{}).Count(&count)
	if count > 0 {
		return
	}

	hash, _ := bcrypt.GenerateFromPassword([]byte("infra123"), bcrypt.DefaultCost)
	admin := models.User{
		Username:     "admin",
		PasswordHash: string(hash),
		Role:         "admin",
		Email:        "admin@infraeye.local",
	}
	db.DB.Create(&admin)

	opHash, _ := bcrypt.GenerateFromPassword([]byte("operator123"), bcrypt.DefaultCost)
	operator := models.User{
		Username:     "operator",
		PasswordHash: string(opHash),
		Role:         "operator",
		Email:        "operator@infraeye.local",
	}
	db.DB.Create(&operator)

	log.Println("✅ Seeded users: admin/infra123, operator/operator123")
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
