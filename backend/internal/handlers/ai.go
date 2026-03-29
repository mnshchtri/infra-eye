package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
)

type chatRequest struct {
	ServerID uint   `json:"server_id"`
	Question string `json:"question" binding:"required"`
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

func AIChat(c *gin.Context) {
	var req chatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	context := buildContext(req.ServerID)
	answer := askAI(context, req.Question)

	c.JSON(http.StatusOK, gin.H{
		"answer":    answer,
		"server_id": req.ServerID,
		"asked_at":  time.Now(),
	})
}

func buildContext(serverID uint) string {
	ctx := "You are an expert DevOps/SRE AI assistant. Help diagnose and fix server issues.\n\n"

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
			ctx += fmt.Sprintf("Latest metrics:\n- CPU: %.1f%%\n- Memory: %.1f%% (%.0f/%.0f MB)\n- Disk: %.1f%%\n- Load avg: %.2f\n- Uptime: %d seconds\n\n",
				metric.CPUPercent, metric.MemPercent, metric.MemUsedMB, metric.MemTotalMB,
				metric.DiskPercent, metric.LoadAvg1, metric.Uptime)
		}
	}

	return ctx
}

func askAI(systemContext, question string) string {
	if config.C.OpenAIKey == "" {
		// Mock response when no API key
		return mockAIResponse(question)
	}

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
			"> Configure your OpenAI API key in %sbackend/.env%s for intelligent AI-powered analysis.",
		question,
		backtick, backtick,
		backtick, backtick,
		backtick, backtick, backtick, backtick,
		backtick, backtick,
		tripleBacktick, tripleBacktick,
		backtick, backtick,
	)
}
