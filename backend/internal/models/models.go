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
	Role     string `gorm:"default:'intern'" json:"role"`
	Email    string `json:"email"`
	Avatar   string `json:"avatar"`
	IsActive bool   `gorm:"default:true" json:"is_active"`
	// Personal AI API Keys. Never serialized: ListUsers and the create/update
	// handlers return this struct to admin *and devops*, which would hand every
	// operator each colleague's billable LLM keys. UpdateProfile echoes the
	// caller's own keys back explicitly, which is the only place they belong.
	OpenRouterKey string `json:"-"`
	DeepSeekKey   string `json:"-"`
	ClaudeKey     string `json:"-"`
	GeminiKey     string `json:"-"`
	MistralKey    string `json:"-"`
	// LocalLLMURL points at a self-hosted, OpenAI-compatible chat endpoint
	// (Ollama, LM Studio, llama.cpp server, vLLM). Overrides the server-wide
	// LOCAL_LLM_URL/LOCAL_LLM_MODEL env defaults when set.
	LocalLLMURL   string `json:"local_llm_url"`
	LocalLLMModel string `json:"local_llm_model"`
}

type Server struct {
	ID               uint           `gorm:"primaryKey" json:"id"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
	Name             string         `gorm:"not null" json:"name"`
	Host             string         `json:"host"`
	Port             int            `gorm:"default:22" json:"port"`
	SSHUser          string         `json:"ssh_user"`
	SSHKeyPath       string         `json:"ssh_key_path"`
	SSHPassword      string         `json:"-"`                               // encrypted
	AuthType         string         `gorm:"default:'key'" json:"auth_type"`  // key or password
	Tags             string         `json:"tags"`                            // comma-separated
	Status           string         `gorm:"default:'unknown'" json:"status"` // online, offline, unknown
	Description      string         `json:"description"`
	KubeConfig       string         `gorm:"type:text" json:"kube_config"`
	IsK8s            bool           `gorm:"default:false" json:"is_k8s"`
	K8sConnected     bool           `gorm:"default:true" json:"k8s_connected"`
	OS               string         `json:"os"`                 // linux, darwin, unknown
	Distro           string         `json:"distro"`             // devicon-compatible id, e.g. ubuntu, debian, fedora
	DistroVersion    string         `json:"distro_version"`     // e.g. 22.04
	DistroPrettyName string         `json:"distro_pretty_name"` // e.g. "Ubuntu 22.04.3 LTS"
	KernelVersion    string         `json:"kernel_version"`     // e.g. 5.15.0-91-generic
	FolderID         *uint          `gorm:"index" json:"folder_id"`
	GitManaged       bool           `gorm:"default:false" json:"git_managed"` // created/updated by Git-sync; cleared on manual edit
	GitKey           string         `gorm:"index" json:"git_key,omitempty"`   // Name at last sync (reserved for future rename detection)
}

// Folder is a user-defined grouping (e.g. "dev", "staging", "production")
// that servers, clusters, and resources can be filed under. Flat — no nesting.
type Folder struct {
	ID        uint           `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
	Name      string         `gorm:"not null" json:"name"`
	Color     string         `json:"color"` // hex accent used for badges/chips
}

// ServerAccess grants a non-privileged user visibility of a specific server or
// cluster. Admin and devops roles bypass grants; trainee and intern only see
// servers they have been explicitly granted.
type ServerAccess struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	ServerID    uint           `gorm:"index;not null" json:"server_id"`
	UserID      uint           `gorm:"index;not null" json:"user_id"`
	AccessLevel string         `gorm:"default:'read'" json:"access_level"` // read | operate
	User        User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

type Resource struct {
	ID           uint           `gorm:"primaryKey" json:"id"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"index" json:"-"`
	Name         string         `gorm:"not null" json:"name"`
	Description  string         `json:"description"`
	Tags         string         `json:"tags"`
	ResourceType string         `gorm:"default:'generic'" json:"resource_type"`
	Protocol     string         `gorm:"default:'tcp'" json:"protocol"`
	Host         string         `json:"host"`
	Port         int            `gorm:"default:0" json:"port"`
	Username     string         `json:"username"`
	Password     string         `json:"-"` // encrypted
	Secret       string         `json:"-"` // token or api key
	AuthType     string         `gorm:"default:'none'" json:"auth_type"`
	UseGateway   bool           `gorm:"default:true" json:"use_gateway"`
	Status       string         `gorm:"default:'unknown'" json:"status"`
	Database     string         `json:"database"`
	Metadata     string         `gorm:"type:text" json:"metadata"`
	FolderID     *uint          `gorm:"index" json:"folder_id"`
}

type ResourceAccess struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
	ResourceID  uint           `gorm:"index;not null" json:"resource_id"`
	UserID      uint           `gorm:"index;not null" json:"user_id"`
	AccessLevel string         `gorm:"default:'read'" json:"access_level"`
	User        User           `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

type ResourceAudit struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	CreatedAt   time.Time `json:"created_at"`
	ResourceID  uint      `gorm:"index;not null" json:"resource_id"`
	UserID      uint      `gorm:"index" json:"user_id"`
	Action      string    `gorm:"not null" json:"action"`
	Details     string    `gorm:"type:text" json:"details"`
	PerformedBy string    `json:"performed_by"`
}

// SecurityScan holds the latest result of one security scan (kernel CVEs,
// OS/SSH hardening, Kubernetes cluster posture, or resource exposure/TLS)
// for one target. One row per (TargetType, TargetID, ScanType) — scans are
// always run live on request; only the most recent outcome is cached here so
// audit pages can show current posture without forcing a re-scan on load.
type SecurityScan struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	TargetType   string    `gorm:"uniqueIndex:idx_security_scan_target" json:"target_type"` // server | resource
	TargetID     uint      `gorm:"uniqueIndex:idx_security_scan_target" json:"target_id"`
	ScanType     string    `gorm:"uniqueIndex:idx_security_scan_target" json:"scan_type"` // kernel | hardening | cluster | resource
	FindingCount int       `json:"finding_count"`
	HighCount    int       `json:"high_count"`
	ResultJSON   string    `gorm:"type:text" json:"-"`
	ScannedBy    uint      `json:"scanned_by"`
	ScannedAt    time.Time `json:"scanned_at"`
}

// ResourceMetric is a single health/observability probe snapshot for a resource,
// captured by the background collector (or an on-demand probe). Metrics holds a
// JSON blob of type-specific numbers (db connections, redis memory, kafka lag…).
type ResourceMetric struct {
	ID         uint      `gorm:"primaryKey" json:"id"`
	ResourceID uint      `gorm:"index;not null" json:"resource_id"`
	Timestamp  time.Time `gorm:"index" json:"timestamp"`
	Status     string    `json:"status"`                   // online | degraded | offline
	LatencyMs  float64   `json:"latency_ms"`               // probe round-trip
	Error      string    `json:"error"`                    // populated when offline/degraded
	Metrics    string    `gorm:"type:text" json:"metrics"` // JSON: type-specific gauges
}

// NetworkScan caches the most recent set of real interface CIDRs read from a
// server over SSH (topology live scan). Follows the SecurityScan precedent:
// scans always run live on request, only the latest outcome is kept so the
// infrastructure map can show real network segments — never guessed ones —
// without forcing an SSH sweep on every page load.
type NetworkScan struct {
	ServerID  uint      `gorm:"primaryKey;autoIncrement:false" json:"server_id"`
	CIDRs     string    `gorm:"column:cidrs;type:text" json:"cidrs"` // JSON array, e.g. ["10.0.0.0/24","172.17.0.0/16"]
	ScannedAt time.Time `json:"scanned_at"`
}

type Metric struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	ServerID    uint      `gorm:"index;not null" json:"server_id"`
	Timestamp   time.Time `gorm:"index" json:"timestamp"`
	CPUPercent  float64   `json:"cpu_percent"`
	MemPercent  float64   `json:"mem_percent"`
	MemUsedMB   float64   `json:"mem_used_mb"`
	MemTotalMB  float64   `json:"mem_total_mb"`
	DiskPercent float64   `json:"disk_percent"`
	DiskUsedGB  float64   `json:"disk_used_gb"`
	DiskTotalGB float64   `json:"disk_total_gb"`
	NetRxMBps   float64   `json:"net_rx_mbps"`
	NetTxMBps   float64   `json:"net_tx_mbps"`
	LoadAvg1    float64   `json:"load_avg_1"`
	Uptime      int64     `json:"uptime_seconds"`
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
	ServerID        uint           `json:"server_id"`                      // 0 = all servers
	ConditionType   string         `gorm:"not null" json:"condition_type"` // cpu, mem, disk, log_keyword
	ConditionOp     string         `gorm:"not null" json:"condition_op"`   // gt, lt, contains
	ConditionValue  string         `gorm:"not null" json:"condition_value"`
	Severity        string         `gorm:"default:'warning'" json:"severity"` // warning, critical
	ActionType      string         `gorm:"not null" json:"action_type"`       // ssh_command, notify
	ActionCommand   string         `gorm:"type:text" json:"action_command"`
	CooldownMinutes int            `gorm:"default:5" json:"cooldown_minutes"`
	Enabled         bool           `gorm:"default:true" json:"enabled"`
	Description     string         `json:"description"`
	GitManaged      bool           `gorm:"default:false" json:"git_managed"` // created/updated by Git-sync; cleared on manual edit
	GitKey          string         `gorm:"index" json:"git_key,omitempty"`   // Name at last sync (reserved for future rename detection)
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

// GitSyncRun is the audit log for one Infrastructure-as-Code sync attempt
// (scheduled or manually triggered). Errors are stored verbatim (raw git
// stderr / YAML parse errors), never abstracted, per InfraEye's "honest
// error messages" design principle.
type GitSyncRun struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	StartedAt      time.Time `json:"started_at"`
	FinishedAt     time.Time `json:"finished_at"`
	Trigger        string    `json:"trigger"` // scheduled, manual
	Status         string    `json:"status"`  // running, success, partial, failed
	ErrorText      string    `gorm:"type:text" json:"error_text"`
	ConflictsJSON  string    `gorm:"type:text" json:"conflicts_json"` // []string of skip/conflict lines
	ServersCreated int       `json:"servers_created"`
	ServersUpdated int       `json:"servers_updated"`
	ServersDeleted int       `json:"servers_deleted"`
	RulesCreated   int       `json:"rules_created"`
	RulesUpdated   int       `json:"rules_updated"`
	RulesDeleted   int       `json:"rules_deleted"`
}

type ChatMessage struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`
	ThreadID  uint      `gorm:"index" json:"thread_id"`
	ServerID  uint      `gorm:"index" json:"server_id"` // 0 = global
	Role      string    `gorm:"not null" json:"role"`   // user, assistant
	Content   string    `gorm:"type:text;not null" json:"content"`
	ImageB64  string    `gorm:"type:text" json:"-"` // image context if any
}

type ChatThread struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `gorm:"index" json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Title     string    `gorm:"not null" json:"title"`
	UserID    uint      `gorm:"index" json:"user_id"`
	ServerID  uint      `gorm:"index" json:"server_id"`
}

// AgentRun is one goal-driven, multi-turn Claude tool-calling session against
// a single server. Each turn proposes at most one tool call (ssh_command or
// an MCP/Kubernetes tool), which is only executed after explicit human
// approval of the corresponding AgentStep.
type AgentRun struct {
	ID         uint        `gorm:"primaryKey" json:"id"`
	UserID     uint        `gorm:"index" json:"user_id"`
	ServerID   uint        `gorm:"index" json:"server_id"`
	Goal       string      `gorm:"type:text" json:"goal"`
	Status     string      `gorm:"default:running" json:"status"` // running, awaiting_approval, completed, failed, cancelled
	Provider   string      `json:"provider"`                      // "claude" for v1
	Model      string      `json:"model"`
	StartedAt  time.Time   `json:"started_at"`
	FinishedAt *time.Time  `json:"finished_at"`
	ErrorText  string      `gorm:"type:text" json:"error_text"`
	Steps      []AgentStep `gorm:"foreignKey:AgentRunID" json:"steps"`
	CreatedAt  time.Time   `gorm:"index" json:"created_at"`
	UpdatedAt  time.Time   `json:"updated_at"`
}

// AgentStep is one proposed action (or the final answer) within an AgentRun.
type AgentStep struct {
	ID              uint       `gorm:"primaryKey" json:"id"`
	AgentRunID      uint       `gorm:"index;uniqueIndex:idx_run_step" json:"agent_run_id"`
	StepNumber      int        `gorm:"uniqueIndex:idx_run_step" json:"step_number"`
	Kind            string     `json:"kind"` // ssh_command, mcp_tool, final_answer, unknown_tool
	ToolName        string     `json:"tool_name"`
	ToolArgs        string     `gorm:"type:text" json:"tool_args"` // JSON-marshaled map
	ToolUseID       string     `json:"tool_use_id"`                // Claude's tool_use block id
	Reasoning       string     `gorm:"type:text" json:"reasoning"` // assistant text preceding the tool call, or the final answer
	Status          string     `json:"status"`                     // pending_approval, approved, rejected, executed, failed
	Output          string     `gorm:"type:text" json:"output"`
	ErrorText       string     `gorm:"type:text" json:"error_text"`
	DecidedByUserID *uint      `json:"decided_by_user_id"`
	DecidedAt       *time.Time `json:"decided_at"`
	ExecutedAt      *time.Time `json:"executed_at"`
	CreatedAt       time.Time  `json:"created_at"`
}

// AppSetting is a platform-wide key/value setting configured from the UI
// (e.g. notification webhook URLs). A stored value overrides the matching
// environment-variable default.
type AppSetting struct {
	Key       string    `gorm:"primaryKey" json:"key"`
	Value     string    `gorm:"type:text" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}
