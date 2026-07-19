package handlers

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/alerts"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
)

// validateWebhookURL enforces HTTPS and the provider's real webhook host, so a
// stored URL can't be pointed at internal services (SSRF) or plain HTTP.
// An empty URL is valid — it clears the setting.
func validateWebhookURL(raw, requiredHost string) string {
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "invalid URL"
	}
	if u.Scheme != "https" {
		return "webhook URL must use https"
	}
	if !strings.EqualFold(u.Host, requiredHost) {
		return "host must be " + requiredHost
	}
	return ""
}

// GetNotificationSettings returns the UI-configured webhook URLs plus whether
// an env-var fallback exists (admin only — values are shown in full so they
// can be edited).
func GetNotificationSettings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"google_chat_webhook_url": db.GetSetting(alerts.SettingGoogleChatWebhook),
		"slack_webhook_url":       db.GetSetting(alerts.SettingSlackWebhook),
		"google_chat_env_set":     config.C.GoogleChatWebhookURL != "",
		"slack_env_set":           config.C.SlackWebhookURL != "",
	})
}

type notificationSettingsRequest struct {
	GoogleChatWebhookURL *string `json:"google_chat_webhook_url"`
	SlackWebhookURL      *string `json:"slack_webhook_url"`
}

// UpdateNotificationSettings saves webhook URLs. Fields left null are
// untouched; an empty string clears the setting (env fallback applies again).
func UpdateNotificationSettings(c *gin.Context) {
	var req notificationSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.GoogleChatWebhookURL != nil {
		v := strings.TrimSpace(*req.GoogleChatWebhookURL)
		if msg := validateWebhookURL(v, "chat.googleapis.com"); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Google Chat webhook: " + msg})
			return
		}
		if err := db.SetSetting(alerts.SettingGoogleChatWebhook, v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}
	if req.SlackWebhookURL != nil {
		v := strings.TrimSpace(*req.SlackWebhookURL)
		if msg := validateWebhookURL(v, "hooks.slack.com"); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Slack webhook: " + msg})
			return
		}
		if err := db.SetSetting(alerts.SettingSlackWebhook, v); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save setting: " + err.Error()})
			return
		}
	}

	GetNotificationSettings(c)
}

type testNotificationRequest struct {
	Channel string `json:"channel" binding:"required"` // google_chat | slack
	URL     string `json:"url"`                        // optional: test before saving
}

// TestNotificationWebhook sends a test message so admins can verify a webhook
// from the Settings UI. Uses the URL from the request if given (pre-save
// testing), otherwise the currently active one (setting or env).
func TestNotificationWebhook(c *gin.Context) {
	var req testNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var target, label, requiredHost string
	switch req.Channel {
	case "google_chat":
		label, requiredHost = "Google Chat", "chat.googleapis.com"
		target = alerts.GoogleChatWebhookURL()
	case "slack":
		label, requiredHost = "Slack", "hooks.slack.com"
		target = alerts.SlackWebhookURL()
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "channel must be google_chat or slack"})
		return
	}

	if v := strings.TrimSpace(req.URL); v != "" {
		target = v
	}
	if target == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no webhook URL configured for " + label})
		return
	}
	if msg := validateWebhookURL(target, requiredHost); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": label + " webhook: " + msg})
		return
	}

	if err := alerts.SendTest(target, label); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "test message failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "Test notification sent to " + label})
}
