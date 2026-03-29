package models

import (
	"time"

	"gorm.io/gorm"
)

type User struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
	Username     string         `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash string         `gorm:"not null" json:"-"`
	// Role defines access level: admin | devops | trainee | intern
	Role         string         `gorm:"default:'intern'" json:"role"`
	Email        string         `json:"email"`
	Avatar       string         `json:"avatar"`
	IsActive     bool           `gorm:"default:true" json:"is_active"`
}

type Server struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	Name        string         `gorm:"not null" json:"name"`
	Host        string         `gorm:"not null" json:"host"`
	Port        int            `gorm:"default:22" json:"port"`
	SSHUser     string         `gorm:"not null" json:"ssh_user"`
	SSHKeyPath  string         `json:"ssh_key_path"`
	SSHPassword string         `json:"-"` // encrypted
	AuthType    string         `gorm:"default:'key'" json:"auth_type"` // key or password
	Tags        string         `json:"tags"`    // comma-separated
	Status      string         `gorm:"default:'unknown'" json:"status"` // online, offline, unknown
	Description string         `json:"description"`
	KubeConfig  string         `json:"-"` // base64 encoded kubeconfig
}

type Metric struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	ServerID     uint      `gorm:"index;not null" json:"server_id"`
	Timestamp    time.Time `gorm:"index" json:"timestamp"`
	CPUPercent   float64   `json:"cpu_percent"`
	MemPercent   float64   `json:"mem_percent"`
	MemUsedMB    float64   `json:"mem_used_mb"`
	MemTotalMB   float64   `json:"mem_total_mb"`
	DiskPercent  float64   `json:"disk_percent"`
	DiskUsedGB   float64   `json:"disk_used_gb"`
	DiskTotalGB  float64   `json:"disk_total_gb"`
	NetRxMBps    float64   `json:"net_rx_mbps"`
	NetTxMBps    float64   `json:"net_tx_mbps"`
	LoadAvg1     float64   `json:"load_avg_1"`
	Uptime       int64     `json:"uptime_seconds"`
}

type LogEntry struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ServerID  uint      `gorm:"index;not null" json:"server_id"`
	Timestamp time.Time `gorm:"index" json:"timestamp"`
	Stream    string    `json:"stream"` // syslog, kernel, app
	Level     string    `json:"level"`  // info, warn, error
	Message   string    `gorm:"type:text" json:"message"`
	Source    string    `json:"source"` // which log file
}

type AlertRule struct {
	ID              uint           `gorm:"primaryKey" json:"id"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
	Name            string         `gorm:"not null" json:"name"`
	ServerID        uint           `json:"server_id"` // 0 = all servers
	ConditionType   string         `gorm:"not null" json:"condition_type"` // cpu, mem, disk, log_keyword
	ConditionOp     string         `gorm:"not null" json:"condition_op"`   // gt, lt, contains
	ConditionValue  string         `gorm:"not null" json:"condition_value"`
	Severity        string         `gorm:"default:'warning'" json:"severity"` // warning, critical
	ActionType      string         `gorm:"not null" json:"action_type"` // ssh_command, notify
	ActionCommand   string         `gorm:"type:text" json:"action_command"`
	CooldownMinutes int            `gorm:"default:5" json:"cooldown_minutes"`
	Enabled         bool           `gorm:"default:true" json:"enabled"`
	Description     string         `json:"description"`
}

type HealingAction struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	AlertRuleID uint      `gorm:"index" json:"alert_rule_id"`
	ServerID    uint      `gorm:"index" json:"server_id"`
	TriggerInfo string    `gorm:"type:text" json:"trigger_info"`
	Command     string    `gorm:"type:text" json:"command"`
	Output      string    `gorm:"type:text" json:"output"`
	Status      string    `json:"status"` // success, failed
}
