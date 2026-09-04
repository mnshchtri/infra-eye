package gitsync

import (
	"context"
	"encoding/json"
	"path/filepath"
	"time"

	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"gorm.io/gorm"
)

// AppSetting keys — one row per key, same convention as internal/alerts'
// webhook settings (env-var default + DB override, see handlers/settings.go).
const (
	SettingRepoURL         = "gitsync.repo_url"
	SettingBranch          = "gitsync.branch"
	SettingSubdir          = "gitsync.subdir"
	SettingEnabled         = "gitsync.enabled"
	SettingIntervalMinutes = "gitsync.interval_minutes"
	SettingPAT             = "gitsync.pat"

	defaultBranch          = "main"
	defaultIntervalMinutes = 15
	serversFileName        = "servers.yaml"
	alertRulesFileName     = "alert-rules.yaml"
)

func branchOrDefault() string {
	if b := db.GetSetting(SettingBranch); b != "" {
		return b
	}
	return defaultBranch
}

// TestConnection checks that the given repo/branch is reachable without
// cloning. Used by both the settings-test endpoint (explicit args, so a user
// can test before saving) and can be called with the saved settings.
func TestConnection(repoURL, branch, pat string) error {
	if branch == "" {
		branch = defaultBranch
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return testConnection(ctx, repoURL, branch, pat)
}

// RunSync performs one full sync attempt: clone-or-pull, parse, reconcile,
// recording a GitSyncRun row throughout. Errors (git failures, YAML parse
// errors) are stored verbatim in ErrorText — never abstracted, except that any
// credential spliced into the remote URL is redacted (see RedactCredentials).
func RunSync(trigger string) *models.GitSyncRun {
	run := &models.GitSyncRun{StartedAt: time.Now(), Trigger: trigger, Status: "running"}
	db.DB.Create(run)

	defer func() {
		run.FinishedAt = time.Now()
		db.DB.Save(run)
	}()

	repoURL := db.GetSetting(SettingRepoURL)
	if repoURL == "" {
		run.Status = "failed"
		run.ErrorText = "no Git repository configured"
		return run
	}
	branch := branchOrDefault()
	subdir := db.GetSetting(SettingSubdir)
	pat := db.GetSetting(SettingPAT)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if err := cloneOrPull(ctx, repoURL, branch, pat); err != nil {
		run.Status = "failed"
		run.ErrorText = RedactCredentials(err.Error())
		return run
	}

	servers, err := parseServers(WorkDir, filepath.Join(subdir, serversFileName))
	if err != nil {
		run.Status = "failed"
		run.ErrorText = RedactCredentials(err.Error())
		return run
	}
	rules, err := parseAlertRules(WorkDir, filepath.Join(subdir, alertRulesFileName))
	if err != nil {
		run.Status = "failed"
		run.ErrorText = RedactCredentials(err.Error())
		return run
	}

	// Conflicts starts as a non-nil empty slice so json.Marshal serializes it
	// as "[]" rather than "null" when nothing was appended — a bare "null"
	// would break any frontend code doing conflicts.map(...) on the parsed value.
	result := reconcileResult{Conflicts: []string{}}
	txErr := db.DB.Transaction(func(tx *gorm.DB) error {
		if err := reconcileServers(tx, servers, &result); err != nil {
			return err
		}
		if err := reconcileAlertRules(tx, rules, &result); err != nil {
			return err
		}
		return nil
	})
	if txErr != nil {
		run.Status = "failed"
		run.ErrorText = RedactCredentials(txErr.Error())
		return run
	}

	run.ServersCreated, run.ServersUpdated, run.ServersDeleted = result.ServersCreated, result.ServersUpdated, result.ServersDeleted
	run.RulesCreated, run.RulesUpdated, run.RulesDeleted = result.RulesCreated, result.RulesUpdated, result.RulesDeleted
	if b, err := json.Marshal(result.Conflicts); err == nil {
		run.ConflictsJSON = string(b)
	}
	if len(result.Conflicts) > 0 {
		run.Status = "partial"
	} else {
		run.Status = "success"
	}
	return run
}
