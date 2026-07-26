package gitsync

import (
	"fmt"

	"github.com/infra-eye/backend/internal/models"
	"gorm.io/gorm"
)

type reconcileResult struct {
	ServersCreated, ServersUpdated, ServersDeleted int
	RulesCreated, RulesUpdated, RulesDeleted       int
	Conflicts                                      []string
}

func samePtr(a, b *uint) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// reconcileServers applies the algorithm from the plan: create rows that
// don't exist by name, update rows this package already manages, skip (and
// report) rows that collide with a manually-created row, and soft-delete any
// previously git-managed row whose name is no longer present.
func reconcileServers(tx *gorm.DB, entries []serverEntry, res *reconcileResult) error {
	seenNames := make(map[string]bool, len(entries))

	for _, e := range entries {
		seenNames[e.Name] = true

		var folderID *uint
		if e.Folder != "" {
			var folder models.Folder
			if err := tx.Where("name = ?", e.Folder).FirstOrCreate(&folder, models.Folder{Name: e.Folder}).Error; err != nil {
				return fmt.Errorf("resolve folder %q: %w", e.Folder, err)
			}
			folderID = &folder.ID
		}

		port := e.Port
		if port == 0 {
			port = 22
		}
		authType := e.AuthType
		if authType == "" {
			authType = "key"
		}

		var existing models.Server
		err := tx.Where("name = ?", e.Name).First(&existing).Error
		switch {
		case err == gorm.ErrRecordNotFound:
			server := models.Server{
				Name:        e.Name,
				Host:        e.Host,
				Port:        port,
				SSHUser:     e.SSHUser,
				AuthType:    authType,
				Tags:        e.Tags,
				Description: e.Description,
				OS:          e.OS,
				IsK8s:       e.IsK8s,
				Status:      "unknown",
				FolderID:    folderID,
				GitManaged:  true,
				GitKey:      e.Name,
			}
			if err := tx.Create(&server).Error; err != nil {
				return fmt.Errorf("create server %q: %w", e.Name, err)
			}
			res.ServersCreated++
		case err != nil:
			return fmt.Errorf("lookup server %q: %w", e.Name, err)
		case !existing.GitManaged:
			res.Conflicts = append(res.Conflicts, fmt.Sprintf(
				"server %q: name conflicts with an existing manually-created server (id %d) — rename one to sync", e.Name, existing.ID))
		default:
			unchanged := existing.Host == e.Host && existing.Port == port && existing.SSHUser == e.SSHUser &&
				existing.AuthType == authType && existing.Tags == e.Tags && existing.Description == e.Description &&
				existing.OS == e.OS && existing.IsK8s == e.IsK8s && samePtr(existing.FolderID, folderID) &&
				existing.GitKey == e.Name
			if unchanged {
				continue
			}
			updates := map[string]interface{}{
				"host":        e.Host,
				"port":        port,
				"ssh_user":    e.SSHUser,
				"auth_type":   authType,
				"tags":        e.Tags,
				"description": e.Description,
				"os":          e.OS,
				"is_k8s":      e.IsK8s,
				"folder_id":   folderID,
				"git_key":     e.Name,
			}
			if err := tx.Model(&existing).Updates(updates).Error; err != nil {
				return fmt.Errorf("update server %q: %w", e.Name, err)
			}
			res.ServersUpdated++
		}
	}

	var managed []models.Server
	if err := tx.Where("git_managed = ?", true).Find(&managed).Error; err != nil {
		return fmt.Errorf("list git-managed servers: %w", err)
	}
	for _, s := range managed {
		if seenNames[s.Name] {
			continue
		}
		if err := tx.Delete(&s).Error; err != nil {
			return fmt.Errorf("delete server %q: %w", s.Name, err)
		}
		res.ServersDeleted++
	}
	return nil
}

// reconcileAlertRules mirrors reconcileServers exactly, resolving the
// "server:" name against every server that exists at this point in the sync
// (including ones reconcileServers just created in the same transaction), so
// a single commit can define both files self-consistently.
func reconcileAlertRules(tx *gorm.DB, entries []alertRuleEntry, res *reconcileResult) error {
	var allServers []models.Server
	if err := tx.Find(&allServers).Error; err != nil {
		return fmt.Errorf("list servers for rule resolution: %w", err)
	}
	serverIDByName := make(map[string]uint, len(allServers))
	for _, s := range allServers {
		serverIDByName[s.Name] = s.ID
	}

	seenNames := make(map[string]bool, len(entries))

	for _, e := range entries {
		seenNames[e.Name] = true

		var serverID uint
		if e.Server != "" {
			id, ok := serverIDByName[e.Server]
			if !ok {
				res.Conflicts = append(res.Conflicts, fmt.Sprintf(
					"alert rule %q: server %q not found", e.Name, e.Server))
				continue
			}
			serverID = id
		}

		severity := e.Severity
		if severity == "" {
			severity = "warning"
		}
		cooldown := e.CooldownMinutes
		if cooldown == 0 {
			cooldown = 5
		}

		var existing models.AlertRule
		err := tx.Where("name = ?", e.Name).First(&existing).Error
		switch {
		case err == gorm.ErrRecordNotFound:
			rule := models.AlertRule{
				Name:            e.Name,
				ServerID:        serverID,
				ConditionType:   e.ConditionType,
				ConditionOp:     e.ConditionOp,
				ConditionValue:  e.ConditionValue,
				Severity:        severity,
				ActionType:      e.ActionType,
				ActionCommand:   e.ActionCommand,
				CooldownMinutes: cooldown,
				Enabled:         e.Enabled,
				Description:     e.Description,
				GitManaged:      true,
				GitKey:          e.Name,
			}
			if err := tx.Create(&rule).Error; err != nil {
				return fmt.Errorf("create alert rule %q: %w", e.Name, err)
			}
			res.RulesCreated++
		case err != nil:
			return fmt.Errorf("lookup alert rule %q: %w", e.Name, err)
		case !existing.GitManaged:
			res.Conflicts = append(res.Conflicts, fmt.Sprintf(
				"alert rule %q: name conflicts with an existing manually-created rule (id %d) — rename one to sync", e.Name, existing.ID))
		default:
			unchanged := existing.ServerID == serverID && existing.ConditionType == e.ConditionType &&
				existing.ConditionOp == e.ConditionOp && existing.ConditionValue == e.ConditionValue &&
				existing.Severity == severity && existing.ActionType == e.ActionType &&
				existing.ActionCommand == e.ActionCommand && existing.CooldownMinutes == cooldown &&
				existing.Enabled == e.Enabled && existing.Description == e.Description && existing.GitKey == e.Name
			if unchanged {
				continue
			}
			updates := map[string]interface{}{
				"server_id":        serverID,
				"condition_type":   e.ConditionType,
				"condition_op":     e.ConditionOp,
				"condition_value":  e.ConditionValue,
				"severity":         severity,
				"action_type":      e.ActionType,
				"action_command":   e.ActionCommand,
				"cooldown_minutes": cooldown,
				"enabled":          e.Enabled,
				"description":      e.Description,
				"git_key":          e.Name,
			}
			if err := tx.Model(&existing).Updates(updates).Error; err != nil {
				return fmt.Errorf("update alert rule %q: %w", e.Name, err)
			}
			res.RulesUpdated++
		}
	}

	var managed []models.AlertRule
	if err := tx.Where("git_managed = ?", true).Find(&managed).Error; err != nil {
		return fmt.Errorf("list git-managed alert rules: %w", err)
	}
	for _, r := range managed {
		if seenNames[r.Name] {
			continue
		}
		if err := tx.Delete(&r).Error; err != nil {
			return fmt.Errorf("delete alert rule %q: %w", r.Name, err)
		}
		res.RulesDeleted++
	}
	return nil
}
