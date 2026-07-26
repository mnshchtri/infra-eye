package gitsync

import (
	"fmt"
	"os"
	"path/filepath"

	"sigs.k8s.io/yaml"
)

// serverEntry is the schema for one entry in servers.yaml. Deliberately has
// no fields for SSHKeyPath/SSHPassword/KubeConfig — credentials are never
// expected to live in a Git repo, so the sync code path structurally cannot
// write them, regardless of what a YAML file might contain.
type serverEntry struct {
	Name        string `json:"name"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	SSHUser     string `json:"ssh_user"`
	AuthType    string `json:"auth_type"`
	Tags        string `json:"tags"`
	Description string `json:"description"`
	Folder      string `json:"folder"`
	OS          string `json:"os"`
	IsK8s       bool   `json:"is_k8s"`
}

type serversFile struct {
	Servers []serverEntry `json:"servers"`
}

// alertRuleEntry is the schema for one entry in alert-rules.yaml. Server is a
// name (git-friendly), resolved to a ServerID during reconciliation — empty
// means "all servers" (ServerID 0), matching the existing convention.
type alertRuleEntry struct {
	Name            string `json:"name"`
	Server          string `json:"server"`
	ConditionType   string `json:"condition_type"`
	ConditionOp     string `json:"condition_op"`
	ConditionValue  string `json:"condition_value"`
	Severity        string `json:"severity"`
	ActionType      string `json:"action_type"`
	ActionCommand   string `json:"action_command"`
	CooldownMinutes int    `json:"cooldown_minutes"`
	Enabled         bool   `json:"enabled"`
	Description     string `json:"description"`
}

type alertRulesFile struct {
	AlertRules []alertRuleEntry `json:"alert_rules"`
}

// parseServers reads and validates <dir>/<relPath>. A missing file is not an
// error — it just means this sync run has nothing to reconcile for servers.
func parseServers(dir, relPath string) ([]serverEntry, error) {
	data, err := os.ReadFile(filepath.Join(dir, relPath))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", relPath, err)
	}
	var f serversFile
	if err := yaml.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("%s: %w", relPath, err)
	}
	for i, e := range f.Servers {
		if e.Name == "" {
			return nil, fmt.Errorf("%s: entry %d: name is required", relPath, i+1)
		}
	}
	return f.Servers, nil
}

func parseAlertRules(dir, relPath string) ([]alertRuleEntry, error) {
	data, err := os.ReadFile(filepath.Join(dir, relPath))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", relPath, err)
	}
	var f alertRulesFile
	if err := yaml.Unmarshal(data, &f); err != nil {
		return nil, fmt.Errorf("%s: %w", relPath, err)
	}
	for i, e := range f.AlertRules {
		switch {
		case e.Name == "":
			return nil, fmt.Errorf("%s: entry %d: name is required", relPath, i+1)
		case e.ConditionType == "" || e.ConditionOp == "" || e.ConditionValue == "":
			return nil, fmt.Errorf("%s: entry %d (%s): condition_type, condition_op, and condition_value are required", relPath, i+1, e.Name)
		case e.ActionType == "":
			return nil, fmt.Errorf("%s: entry %d (%s): action_type is required", relPath, i+1, e.Name)
		}
	}
	return f.AlertRules, nil
}
