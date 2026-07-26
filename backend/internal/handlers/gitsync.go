package handlers

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/gitsync"
	"github.com/infra-eye/backend/internal/models"
)

// validateGitURL restricts sync targets to https:// for v1 — explicitly
// rejecting file://, ssh://, and bare git@host: forms. This is a documented
// v1 limitation (SSH deploy-key custody is out of scope), not a bug.
// An empty URL is valid — it clears the setting.
func validateGitURL(raw string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid URL"
	}
	if u.Scheme != "https" {
		return "repository URL must use https:// (SSH/local paths aren't supported yet)"
	}
	return ""
}

// GetGitSyncSettings returns the current Infrastructure-as-Code sync config.
// The PAT itself is never echoed back — only whether one is configured.
func GetGitSyncSettings(c *gin.Context) {
	interval := gitsync.SettingIntervalMinutes
	intervalVal := db.GetSetting(interval)
	if intervalVal == "" {
		intervalVal = "15"
	}
	c.JSON(http.StatusOK, gin.H{
		"repo_url":         db.GetSetting(gitsync.SettingRepoURL),
		"branch":           db.GetSetting(gitsync.SettingBranch),
		"subdir":           db.GetSetting(gitsync.SettingSubdir),
		"enabled":          db.GetSetting(gitsync.SettingEnabled) == "true",
		"interval_minutes": intervalVal,
		"pat_set":          db.GetSetting(gitsync.SettingPAT) != "",
	})
}

type gitSyncSettingsRequest struct {
	RepoURL         *string `json:"repo_url"`
	Branch          *string `json:"branch"`
	Subdir          *string `json:"subdir"`
	Enabled         *bool   `json:"enabled"`
	IntervalMinutes *int    `json:"interval_minutes"`
	PAT             *string `json:"pat"`
}

// UpdateGitSyncSettings saves sync config. Fields left null are untouched;
// an empty string clears that setting.
func UpdateGitSyncSettings(c *gin.Context) {
	var req gitSyncSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.RepoURL != nil {
		v := strings.TrimSpace(*req.RepoURL)
		if msg := validateGitURL(v); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
		if err := db.SetSetting(gitsync.SettingRepoURL, v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.Branch != nil {
		if err := db.SetSetting(gitsync.SettingBranch, strings.TrimSpace(*req.Branch)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.Subdir != nil {
		if err := db.SetSetting(gitsync.SettingSubdir, strings.Trim(strings.TrimSpace(*req.Subdir), "/")); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.Enabled != nil {
		v := "false"
		if *req.Enabled {
			v = "true"
		}
		if err := db.SetSetting(gitsync.SettingEnabled, v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.IntervalMinutes != nil {
		if *req.IntervalMinutes < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "interval_minutes must be at least 1"})
			return
		}
		if err := db.SetSetting(gitsync.SettingIntervalMinutes, strconv.Itoa(*req.IntervalMinutes)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.PAT != nil {
		if err := db.SetSetting(gitsync.SettingPAT, *req.PAT); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}

	GetGitSyncSettings(c)
}

type testGitSyncRequest struct {
	RepoURL string `json:"repo_url"`
	Branch  string `json:"branch"`
	PAT     string `json:"pat"`
}

// TestGitSyncConnection checks repo reachability without touching the DB or
// the working copy. Uses request-body values if given (test-before-saving),
// otherwise falls back to the currently saved settings.
func TestGitSyncConnection(c *gin.Context) {
	var req testGitSyncRequest
	_ = c.ShouldBindJSON(&req)

	repoURL := strings.TrimSpace(req.RepoURL)
	if repoURL == "" {
		repoURL = db.GetSetting(gitsync.SettingRepoURL)
	}
	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		branch = db.GetSetting(gitsync.SettingBranch)
	}
	pat := req.PAT
	if pat == "" {
		pat = db.GetSetting(gitsync.SettingPAT)
	}

	if repoURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no repository URL configured"})
		return
	}
	if msg := validateGitURL(repoURL); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	if err := gitsync.TestConnection(repoURL, branch, pat); err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// TriggerGitSync runs a sync immediately (regardless of the "enabled" flag,
// which only gates the automatic schedule) and returns the resulting run.
func TriggerGitSync(c *gin.Context) {
	run := gitsync.RunSync("manual")
	c.JSON(http.StatusOK, run)
}

func ListGitSyncRuns(c *gin.Context) {
	var runs []models.GitSyncRun
	db.DB.Order("started_at DESC").Limit(50).Find(&runs)
	c.JSON(http.StatusOK, runs)
}
