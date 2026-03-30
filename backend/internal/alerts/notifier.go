package alerts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/infra-eye/backend/internal/config"
)

// SendToGoogleChat sends a formatted alert message to a Google Chat webhook
func SendToGoogleChat(ruleName, serverName, info, severity, status string) {
	url := config.C.GoogleChatWebhookURL
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

	// Format text message
	messageText := fmt.Sprintf("%s *ALERT: %s*\n*Server:* %s\n*Detail:* %s\n*Severity:* %s\n*System Status:* %s",
		icon, ruleName, serverName, info, severity, status)

	// Google Chat simple message payload
	payload := map[string]interface{}{
		"text": messageText,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("❌ Google Chat Marshal Error: %v", err)
		return
	}

	resp, err := http.Post(url, "application/json", bytes.NewBuffer(jsonData))
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
