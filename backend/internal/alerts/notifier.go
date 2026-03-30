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
							"widgets": []map[string]interface{}{
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
								{
									"buttonList": map[string]interface{}{
										"buttons": []map[string]interface{}{
											{
												"text": "Open InfraEye Dashboard",
												"onClick": map[string]interface{}{
													"openLink": map[string]interface{}{
														"url": "http://localhost:5173", // URL of the frontend dashboard
													},
												},
											},
										},
									},
								},
							},
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
