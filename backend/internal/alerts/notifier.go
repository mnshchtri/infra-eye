package alerts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
)

// Setting keys for UI-configured webhook URLs (override env-var defaults).
const (
	SettingGoogleChatWebhook = "google_chat_webhook_url"
	SettingSlackWebhook      = "slack_webhook_url"
)

// GoogleChatWebhookURL resolves the active Google Chat webhook: the value
// saved from the Settings UI wins, otherwise the GOOGLE_CHAT_WEBHOOK_URL env.
func GoogleChatWebhookURL() string {
	if v := db.GetSetting(SettingGoogleChatWebhook); v != "" {
		return v
	}
	return config.C.GoogleChatWebhookURL
}

// SlackWebhookURL resolves the active Slack webhook (UI setting, then env).
func SlackWebhookURL() string {
	if v := db.GetSetting(SettingSlackWebhook); v != "" {
		return v
	}
	return config.C.SlackWebhookURL
}

var webhookClient = &http.Client{Timeout: 15 * time.Second}

// SendTest posts a minimal test message to a webhook URL so admins can verify
// their configuration from the Settings UI. Works for both Google Chat and
// Slack — each accepts a simple {"text": ...} payload.
func SendTest(url, channelLabel string) error {
	payload := map[string]string{
		"text": fmt.Sprintf("✅ InfraEye test notification — %s webhook is working. Alert rules will notify this space.", channelLabel),
	}
	jsonData, _ := json.Marshal(payload)
	resp, err := webhookClient.Post(url, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}
	return nil
}

// SendToGoogleChat sends a formatted alert message to a Google Chat webhook
func SendToGoogleChat(ruleName, serverName, info, severity, status, actionOutput string) {
	url := GoogleChatWebhookURL()
	if url == "" {
		log.Println("⚠️ Google Chat Webhook URL not configured, skipping notification")
		return
	}

	// Choose an icon based on severity
	icon := "⚪"
	switch strings.ToLower(severity) {
	case "critical":
		icon = "🔴"
	case "warning":
		icon = "🟡"
	case "info":
		icon = "🔵"
	}

	widgets := []map[string]interface{}{
		{
			"decoratedText": map[string]interface{}{
				"topLabel": "Severity",
				"text":     severity,
			},
		},
		{
			"decoratedText": map[string]interface{}{
				"topLabel": "Current Status",
				"text":     status,
				"wrapText": true,
			},
		},
		{
			"textParagraph": map[string]interface{}{
				"text": fmt.Sprintf("<b>Diagnostic Info:</b><br>%s", info),
			},
		},
	}

	if actionOutput != "" && actionOutput != "notification-only rule" {
		truncated := actionOutput
		if len(truncated) > 1000 {
			truncated = truncated[:1000] + "\n...[truncated]"
		}
		escapedOutput := strings.ReplaceAll(truncated, "<", "&lt;")
		escapedOutput = strings.ReplaceAll(escapedOutput, ">", "&gt;")
		escapedOutput = strings.ReplaceAll(escapedOutput, "\n", "<br>")
		
		widgets = append(widgets, map[string]interface{}{
			"textParagraph": map[string]interface{}{
				"text": fmt.Sprintf("<b>Logs / Execution Output:</b><br><font color=\"#d32f2f\">%s</font>", escapedOutput),
			},
		})
	}

	widgets = append(widgets, map[string]interface{}{
		"buttonList": map[string]interface{}{
			"buttons": []map[string]interface{}{
				{
					"text": "Open InfraEye Dashboard",
					"onClick": map[string]interface{}{
						"openLink": map[string]interface{}{
							"url": "http://localhost", // URL of the frontend dashboard
						},
					},
				},
			},
		},
	})

	// Rich Google Chat Card V2 payload for better visualization
	payload := map[string]interface{}{
		"cardsV2": []map[string]interface{}{
			{
				"cardId": "incident-alert",
				"card": map[string]interface{}{
					"header": map[string]interface{}{
						"title":    fmt.Sprintf("%s Alert Raised: %s", icon, ruleName),
						"subtitle": fmt.Sprintf("Target Server: %s", serverName),
					},
					"sections": []map[string]interface{}{
						{
							"header": "Incident Details",
							"widgets": widgets,
						},
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("❌ Google Chat Marshal Error: %v", err)
		return
	}

	resp, err := webhookClient.Post(url, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("❌ Google Chat Webhook Error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Google Chat Webhook returned non-200 status: %d", resp.StatusCode)
	} else {
		log.Printf("✅ Alert [%s] successfully sent to Google Chat", ruleName)
	}
}

// SendToSlack sends a formatted alert message to a Slack webhook
func SendToSlack(ruleName, serverName, info, severity, status string) {
	url := SlackWebhookURL()
	if url == "" {
		log.Println("⚠️ Slack Webhook URL not configured, skipping notification")
		return
	}

	icon := "⚪"
	color := "#94a3b8" // gray
	switch strings.ToLower(severity) {
	case "critical":
		icon = "🔴"
		color = "#ef4444" // red
	case "warning":
		icon = "🟡"
		color = "#f59e0b" // amber
	case "info":
		icon = "🔵"
		color = "#3b82f6" // blue
	}

	payload := map[string]interface{}{
		"attachments": []map[string]interface{}{
			{
				"color": color,
				"blocks": []map[string]interface{}{
					{
						"type": "header",
						"text": map[string]interface{}{
							"type": "plain_text",
							"text": fmt.Sprintf("%s Alert: %s", icon, ruleName),
						},
					},
					{
						"type": "section",
						"fields": []map[string]interface{}{
							{
								"type": "mrkdwn",
								"text": fmt.Sprintf("*Server:*\n%s", serverName),
							},
							{
								"type": "mrkdwn",
								"text": fmt.Sprintf("*Severity:*\n%s", severity),
							},
						},
					},
					{
						"type": "section",
						"text": map[string]interface{}{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Status:*\n%s", status),
						},
					},
					{
						"type": "section",
						"text": map[string]interface{}{
							"type": "mrkdwn",
							"text": fmt.Sprintf("*Details:*\n%s", info),
						},
					},
					{
						"type": "actions",
						"elements": []map[string]interface{}{
							{
								"type": "button",
								"text": map[string]interface{}{
									"type": "plain_text",
									"text": "Open Dashboard",
								},
								"url": "http://localhost:5173",
							},
						},
					},
				},
			},
		},
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("❌ Slack Marshal Error: %v", err)
		return
	}

	resp, err := webhookClient.Post(url, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		log.Printf("❌ Slack Webhook Error: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Slack Webhook returned non-200 status: %d", resp.StatusCode)
	} else {
		log.Printf("✅ Alert [%s] successfully sent to Slack", ruleName)
	}
}
