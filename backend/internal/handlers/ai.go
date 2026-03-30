package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type chatRequest struct {
	ServerID      uint   `json:"server_id"`
	Question      string `json:"question" binding:"required"`
	ImageBase64   string `json:"image_base64"`
	ImageMimeType string `json:"image_mime_type"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIRequest struct {
	Model    string          `json:"model"`
	Messages []openAIMessage `json:"messages"`
}

type openAIResponse struct {
	Choices []struct {
		Message openAIMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Gemini REST API Support (Multimodal)
type geminiRequest struct {
	Contents []geminiContent `json:"contents"`
}

type geminiContent struct {
	Role  string       `json:"role"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text       string      `json:"text,omitempty"`
	InlineData *inlineData `json:"inline_data,omitempty"`
}

type inlineData struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func AIChat(c *gin.Context) {
	var req chatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	context := buildContext(req.ServerID)
	// Pass image data to askAI
	answer := askAI(context, req.Question, req.ImageBase64, req.ImageMimeType)

	c.JSON(http.StatusOK, gin.H{
		"answer":    answer,
		"server_id": req.ServerID,
		"asked_at":  time.Now(),
	})
}

func buildContext(serverID uint) string {
	ctx := "You are an expert DevOps/SRE AI assistant named Kikagaku. Help diagnose and fix server issues.\n\n"
	
	if serverID > 0 {
		var server models.Server
		if err := db.DB.First(&server, serverID).Error; err == nil {
			ctx += fmt.Sprintf("Server: %s (%s)\nStatus: %s\nTags: %s\n\n", server.Name, server.Host, server.Status, server.Tags)
		}

		// Last 20 log entries
		var logs []models.LogEntry
		db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").Limit(20).Find(&logs)
		if len(logs) > 0 {
			ctx += "Recent logs (newest first):\n"
			for _, l := range logs {
				ctx += fmt.Sprintf("[%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), l.Level, l.Message)
			}
			ctx += "\n"
		}

		// Last metric
		var metric models.Metric
		if err := db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").First(&metric).Error; err == nil {
			ctx += fmt.Sprintf("Latest metrics:\n- CPU: %.1f%%\n- Memory: %.1f%% (%.0f/%.0f MB)\n- Disk: %.1f%% (Used: %.1f GB, Total: %.1f GB)\n- Network RX: %.2f MB/s, TX: %.2f MB/s\n- Load avg: %.2f\n- Uptime: %d seconds\n\n",
				metric.CPUPercent, metric.MemPercent, metric.MemUsedMB, metric.MemTotalMB,
				metric.DiskPercent, metric.DiskUsedGB, metric.DiskTotalGB,
				metric.NetRxMBps, metric.NetTxMBps,
				metric.LoadAvg1, metric.Uptime)
		}

		// LIVE KUBERNETES CONTEXT (if cluster)
		if server.KubeConfig != "" {
			if clientset, err := GetK8sClient(server.KubeConfig); err == nil {
				k8sCtx := context.TODO()
				ctx += "--- LIVE KUBERNETES PULSE ---\n"
				
				// Fetch failing pods
				if pods, err := clientset.CoreV1().Pods("").List(k8sCtx, metav1.ListOptions{}); err == nil {
					failingPods := 0
					var summary strings.Builder
					for _, p := range pods.Items {
						if p.Status.Phase != "Running" && p.Status.Phase != "Succeeded" {
							failingPods++
							if failingPods <= 10 { // Limit to 10 failing pods to avoid context bloat
								summary.WriteString(fmt.Sprintf("- pod/%s [%s] namespace=%s\n", p.Name, p.Status.Phase, p.Namespace))
							}
						}
					}
					ctx += fmt.Sprintf("Cluster Status: %d total pods, %d pods NOT running.\n", len(pods.Items), failingPods)
					if summary.Len() > 0 {
						ctx += "Failing Pods:\n" + summary.String()
					}
				}

				// Fetch last 10 non-Normal events
				if events, err := clientset.CoreV1().Events("").List(k8sCtx, metav1.ListOptions{
					Limit: 10,
				}); err == nil {
					if len(events.Items) > 0 {
						ctx += "Recent Cluster Events:\n"
						for i, e := range events.Items {
							if i >= 10 { break }
							ctx += fmt.Sprintf("- [%s] %s: %s (%s)\n", e.Type, e.Reason, e.Message, e.InvolvedObject.Name)
						}
					}
				}
				ctx += "----------------------------\n\n"
			}
		}
	}

	return ctx
}

func askAI(systemContext, question, imageBase64, imageMime string) string {
	// 1. Try Gemini (Priority - Gemini Flash is great for Multimodal)
	if config.C.GeminiKey != "" {
		return askGemini(systemContext, question, imageBase64, imageMime)
	}

	// 2. Fallback to OpenAI
	if config.C.OpenAIKey != "" {
		return askOpenAI(systemContext, question)
	}

	// 3. Final Mock Fallback
	return mockAIResponse(question)
}

func askGemini(systemContext, question, imageBase64, imageMime string) string {
	apiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%s", config.C.GeminiKey)

	parts := []geminiPart{
		{Text: "SYSTEM CONTEXT: " + systemContext + "\n\nUSER QUESTION: " + question},
	}

	// Add image if provided
	if imageBase64 != "" && imageMime != "" {
		parts = append(parts, geminiPart{
			InlineData: &inlineData{
				MimeType: imageMime,
				Data:     imageBase64,
			},
		})
	}

	reqBody := geminiRequest{
		Contents: []geminiContent{
			{
				Role:  "user",
				Parts: parts,
			},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	resp, err := http.Post(apiURL, "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Gemini request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var gemResp geminiResponse
	if err := json.Unmarshal(body, &gemResp); err != nil {
		return fmt.Sprintf("Gemini parse error: %v | raw: %s", err, string(body))
	}

	if gemResp.Error != nil {
		return fmt.Sprintf("Gemini API error: %s", gemResp.Error.Message)
	}

	if len(gemResp.Candidates) == 0 || len(gemResp.Candidates[0].Content.Parts) == 0 {
		return "No response from Gemini REST API."
	}

	return gemResp.Candidates[0].Content.Parts[0].Text
}

func askOpenAI(systemContext, question string) string {
	reqBody := openAIRequest{
		Model: "gpt-4o",
		Messages: []openAIMessage{
			{Role: "system", Content: systemContext},
			{Role: "user", Content: question},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Request creation failed: %v", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+config.C.OpenAIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("OpenAI request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Sprintf("Parse error: %v", err)
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("OpenAI error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return "No response from AI."
	}

	return aiResp.Choices[0].Message.Content
}

func mockAIResponse(question string) string {
	backtick := "`"
	tripleBacktick := "```"
	return fmt.Sprintf(
		"**AI Analysis** (mock — set OPENAI_API_KEY for real responses)\n\n"+
			"**Question:** %s\n\n"+
			"**Analysis:** Based on the server context and recent logs, here are my observations:\n\n"+
			"1. **Investigate high resource usage** — Check running processes with %sps aux --sort -%%cpu | head -20%s\n"+
			"2. **Review recent log errors** — Use %sjournalctl -p err -n 50%s to see critical errors\n"+
			"3. **Check disk space** — Run %sdf -h%s and %sdu -sh /*%s to find large directories\n"+
			"4. **Kubernetes health** — Run %skubectl get pods --all-namespaces | grep -v Running%s to find failed pods\n\n"+
			"**Suggested fix command:**\n"+
			"%sbash\n"+
			"# Check top processes\nps aux --sort=-%%-cpu | head -10\n"+
			"# Check disk\ndf -h\n"+
			"# Check failed services\nsystemctl --failed\n"+
			"%s\n\n"+
			"> Configure your Gemini API key in %sbackend/.env%s for intelligent AI-powered analysis.",
		question,
		backtick, backtick,
		backtick, backtick,
		backtick, backtick, backtick, backtick,
		backtick, backtick,
		tripleBacktick, tripleBacktick,
		backtick, backtick,
	)
}
