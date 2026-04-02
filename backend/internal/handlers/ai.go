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
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

type chatRequest struct {
	ThreadID      uint   `json:"thread_id"`
	ServerID      uint   `json:"server_id"`
	Question      string `json:"question" binding:"required"`
	ImageBase64   string `json:"image_base64"`
	ImageMimeType string `json:"image_mime_type"`
	Provider      string `json:"provider"`
}

type openAIMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
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

	userID, _ := c.Get("user_id")
	uID := userID.(uint)

	// 1. Ensure Thread exists
	var thread models.ChatThread
	if req.ThreadID > 0 {
		if err := db.DB.Where("id = ? AND user_id = ?", req.ThreadID, uID).First(&thread).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Chat thread not found"})
			return
		}
	} else {
		// Auto-create thread if none provided
		title := req.Question
		if len(title) > 40 {
			title = title[:37] + "..."
		}
		thread = models.ChatThread{
			UserID:   uID,
			ServerID: req.ServerID,
			Title:    title,
		}
		db.DB.Create(&thread)
	}

	// 2. Save User Message
	userMsg := models.ChatMessage{
		ThreadID: thread.ID,
		Role:     "user",
		Content:  req.Question,
		ServerID: req.ServerID,
		ImageB64: req.ImageBase64,
	}
	db.DB.Create(&userMsg)

	// 3. Fetch Recent History for Context (last 10 messages in THIS thread)
	var history []models.ChatMessage
	db.DB.Where("thread_id = ?", thread.ID).Order("created_at DESC").Limit(10).Find(&history)
	
	// Format history for the AI
	historyCtx := ""
	if len(history) > 0 {
		historyCtx = "--- RECENT CONVERSATION HISTORY ---\n"
		// Reverse to chronological order
		for i := len(history) - 1; i >= 0; i-- {
			historyCtx += fmt.Sprintf("[%s]: %s\n", strings.ToUpper(history[i].Role), history[i].Content)
		}
		historyCtx += "-----------------------------------\n\n"
	}

	systemCtx := buildContext(req.ServerID)
	fullCtx := systemCtx + historyCtx

	// 4. Get AI Response
	answer := askAI(fullCtx, req.Question, req.ImageBase64, req.ImageMimeType, req.Provider)

	// 5. Save Assistant Response
	assistantMsg := models.ChatMessage{
		ThreadID: thread.ID,
		Role:     "assistant",
		Content:  answer,
		ServerID: req.ServerID,
	}
	db.DB.Create(&assistantMsg)

	// Update thread's UpdatedAt
	db.DB.Model(&thread).Update("updated_at", time.Now())

	c.JSON(http.StatusOK, gin.H{
		"answer":    answer,
		"thread_id": thread.ID,
		"asked_at":  time.Now(),
	})
}

func ListThreads(c *gin.Context) {
	userID, _ := c.Get("user_id")
	serverID := c.Query("server_id")
	
	var threads []models.ChatThread
	query := db.DB.Where("user_id = ?", userID)
	if serverID != "" {
		query = query.Where("server_id = ?", serverID)
	}
	
	if err := query.Order("updated_at DESC").Find(&threads).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch threads"})
		return
	}
	c.JSON(http.StatusOK, threads)
}

func CreateThread(c *gin.Context) {
	var thread models.ChatThread
	if err := c.ShouldBindJSON(&thread); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	
	userID, _ := c.Get("user_id")
	thread.UserID = userID.(uint)
	
	if err := db.DB.Create(&thread).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create thread"})
		return
	}
	c.JSON(http.StatusOK, thread)
}

func GetChatHistory(c *gin.Context) {
	threadID := c.Param("id")
	userID, _ := c.Get("user_id")
	
	var messages []models.ChatMessage
	// Verify user owns the thread
	var thread models.ChatThread
	if err := db.DB.Where("id = ? AND user_id = ?", threadID, userID).First(&thread).Error; err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := db.DB.Where("thread_id = ?", threadID).Order("created_at ASC").Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch history"})
		return
	}
	
	c.JSON(http.StatusOK, messages)
}

func DeleteThread(c *gin.Context) {
	threadID := c.Param("id")
	userID, _ := c.Get("user_id")
	
	// Verify ownership
	if err := db.DB.Where("id = ? AND user_id = ?", threadID, userID).Delete(&models.ChatThread{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete thread"})
		return
	}
	
	// Cascade delete messages
	db.DB.Where("thread_id = ?", threadID).Delete(&models.ChatMessage{})
	
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func ClearChatHistory(c *gin.Context) {
	// Keep for global clear if needed, but DeleteThread is preferred now.
	serverIDStr := c.Query("server_id")
	userID, _ := c.Get("user_id")
	
	query := db.DB.Where("user_id = ?", userID)
	if serverIDStr != "" {
		query = query.Where("server_id = ?", serverIDStr)
	} else {
		query = query.Where("server_id = 0")
	}
	
	if err := query.Delete(&models.ChatMessage{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear history"})
		return
	}
	
	c.JSON(http.StatusOK, gin.H{"status": "cleared"})
}

func buildContext(serverID uint) string {
	ctx := `You are नेत्र (Netra), an elite DevSecOps, SRE, and Infrastructure Security Engineer embedded in InfraEye.
You are blunt, professional, and highly technical. You prioritize stability, performance, security, and automation.

## YOUR CAPABILITIES
You have access to a live Kubernetes MCP (Model Context Protocol) server. You can request real-time data from the cluster and ask the user to execute fix commands — all from within this chat.

## HOW TO USE MCP TOOLS
When you need to inspect or fix the cluster, emit a fenced code block with the language tag ` + "`" + `mcp` + "`" + ` containing ONLY a JSON object like this:

` + "```mcp" + `
{"tool": "pods_list", "args": {"namespace": "kube-system"}}
` + "```" + `

The user will see an "▶ Execute" button. After they click it, the output will be sent back to you automatically so you can analyze it and recommend the next step.

## AVAILABLE MCP TOOLS
| Tool | Description | Key Args |
|---|---|---|
| ` + "`pods_list`" + ` | List all pods | namespace (opt) |
| ` + "`pods_log`" + ` | Get pod logs | name, namespace, tail (opt) |
| ` + "`pods_delete`" + ` | Delete a stuck pod | name, namespace |
| ` + "`pods_exec`" + ` | Run command in pod | name, namespace, command (array) |
| ` + "`events_list`" + ` | Get cluster events | namespace (opt) |
| ` + "`resources_get`" + ` | Get a resource | apiVersion, kind, name, namespace |
| ` + "`resources_list`" + ` | List resources | apiVersion, kind, namespace (opt) |
| ` + "`resources_create_or_update`" + ` | Apply YAML fix | resource (YAML string) |
| ` + "`resources_scale`" + ` | Scale deployment | apiVersion, kind, name, namespace, scale |
| ` + "`namespaces_list`" + ` | List namespaces | (none) |

## WORKFLOW FOR FIXING ISSUES
1. Use ` + "`events_list`" + ` or ` + "`pods_list`" + ` to gather evidence
2. Use ` + "`pods_log`" + ` to read error logs
3. Emit a ` + "`resources_create_or_update`" + ` or ` + "`resources_scale`" + ` tool call to fix
4. Verify with another ` + "`pods_list`" + ` after the fix

## RULES
- For read-only tools (list, get, log), emit them freely.
- For mutating tools (delete, exec, scale, create/update), always explain WHY before emitting the tool call.
- Never guess. If you need data, request it with a tool call first.
- If the issue is on a server (not K8s), use standard bash suggestions in ` + "```bash" + ` blocks instead.

`

	if serverID > 0 {
		var server models.Server
		if err := db.DB.First(&server, serverID).Error; err == nil {
			ctx += fmt.Sprintf("TARGET CONTEXT: SINGLE SERVER\nServer: %s (%s)\nStatus: %s\nTags: %s\n\n", server.Name, server.Host, server.Status, server.Tags)
		}

		// Last 30 log entries (emphasize analyzing these for threats)
		var logs []models.LogEntry
		db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").Limit(30).Find(&logs)
		if len(logs) > 0 {
			ctx += "Recent logs (analyze for errors, warnings, and security threats):\n"
			for _, l := range logs {
				ctx += fmt.Sprintf("[%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), l.Level, l.Message)
			}
			ctx += "\n"
		}

		// Last metric
		var metric models.Metric
		if err := db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").First(&metric).Error; err == nil {
			ctx += fmt.Sprintf("Latest metrics (analyze for resource exhaustion or anomalies):\n- CPU: %.1f%%\n- Memory: %.1f%% (%.0f/%.0f MB)\n- Disk: %.1f%% (Used: %.1f GB, Total: %.1f GB)\n- Network RX: %.2f MB/s, TX: %.2f MB/s\n- Load avg: %.2f\n- Uptime: %d seconds\n\n",
				metric.CPUPercent, metric.MemPercent, metric.MemUsedMB, metric.MemTotalMB,
				metric.DiskPercent, metric.DiskUsedGB, metric.DiskTotalGB,
				metric.NetRxMBps, metric.NetTxMBps,
				metric.LoadAvg1, metric.Uptime)
		}

		// LIVE KUBERNETES CONTEXT (if cluster)
		if server.KubeConfig != "" {
			if clientset, err := k8s.GetK8sClient(server.KubeConfig); err == nil {
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

				// Fetch last 10 non-Normal events (security relevance)
				if events, err := clientset.CoreV1().Events("").List(k8sCtx, metav1.ListOptions{
					Limit: 10,
				}); err == nil {
					if len(events.Items) > 0 {
						ctx += "Recent Cluster Events (check for CrashLoopBackOff, OOMKilled, or RBAC issues):\n"
						for i, e := range events.Items {
							if i >= 10 { break }
							ctx += fmt.Sprintf("- [%s] %s: %s (%s)\n", e.Type, e.Reason, e.Message, e.InvolvedObject.Name)
						}
					}
				}
				ctx += "----------------------------\n\n"
			}
		}
	} else {
		ctx += "TARGET CONTEXT: INFRASTRUCTURE WIDE\n--- GLOBAL FLEET STATE ---\n"
		var servers []models.Server
		if err := db.DB.Find(&servers).Error; err == nil {
			for _, s := range servers {
				ctx += fmt.Sprintf("Server: %s (%s) | Status: %s | Tags: %s\n", s.Name, s.Host, s.Status, s.Tags)
				
				var metric models.Metric
				if err := db.DB.Where("server_id = ?", s.ID).Order("timestamp DESC").First(&metric).Error; err == nil {
					ctx += fmt.Sprintf("  ↳ Metrics: CPU %.1f%%, RAM %.1f%%, DISK %.1f%%\n", metric.CPUPercent, metric.MemPercent, metric.DiskPercent)
				}
				
				// Get recent warning/error/critical/fatal logs for this server
				var logs []models.LogEntry
				db.DB.Where("server_id = ? AND level IN ?", s.ID, []string{"warn", "warning", "error", "fatal", "critical"}).Order("timestamp DESC").Limit(3).Find(&logs)
				if len(logs) > 0 {
					ctx += "  ↳ Recent Critical/Warning Logs (potential security or stability threats):\n"
					for _, l := range logs {
						ctx += fmt.Sprintf("    [%s] %s\n", l.Level, l.Message)
					}
				}
				ctx += "\n"
			}
		}
		ctx += "-----------------------------------\n\n"
	}

	return ctx
}

func askAI(systemContext, question, imageBase64, imageMime, provider string) string {
	
	// Check user selected provider
	if provider == "openrouter" && config.C.OpenRouterKey != "" {
		return askOpenRouter(systemContext, question)
	}
	if provider == "deepseek" && config.C.DeepSeekKey != "" {
		return askDeepSeek(systemContext, question)
	}
	if provider == "google" && config.C.GeminiKey != "" {
		return askGemini(systemContext, question, imageBase64, imageMime)
	}
	if provider == "mistral" && config.C.MistralKey != "" {
		return askMistral(systemContext, question, imageBase64, imageMime)
	}

	// Default logic if no provider specified or keys missing
	if config.C.OpenRouterKey != "" {
		return askOpenRouter(systemContext, question)
	}

	if config.C.DeepSeekKey != "" {
		return askDeepSeek(systemContext, question)
	}

	if config.C.GeminiKey != "" {
		return askGemini(systemContext, question, imageBase64, imageMime)
	}

	if config.C.MistralKey != "" {
		return askMistral(systemContext, question, imageBase64, imageMime)
	}

	if config.C.OpenAIKey != "" {
		return askOpenAI(systemContext, question)
	}

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

	return aiResp.Choices[0].Message.Content.(string)
}

func askDeepSeek(systemContext, question string) string {
	reqBody := openAIRequest{
		Model: "deepseek-chat",
		Messages: []openAIMessage{
			{Role: "system", Content: systemContext},
			{Role: "user", Content: question},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", "https://api.deepseek.com/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Request creation failed: %v", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+config.C.DeepSeekKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("DeepSeek request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Sprintf("Parse error: %v", err)
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("DeepSeek error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return "No response from DeepSeek AI."
	}

	return aiResp.Choices[0].Message.Content.(string)
}

func askOpenRouter(systemContext, question string) string {
	reqBody := openAIRequest{
		Model: "deepseek/deepseek-chat", // You can change to google/gemini-2.5-flash or meta-llama/llama-3.1-8b-instruct
		Messages: []openAIMessage{
			{Role: "system", Content: systemContext},
			{Role: "user", Content: question},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", "https://openrouter.ai/api/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Request creation failed: %v", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+config.C.OpenRouterKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("HTTP-Referer", "http://localhost:80")
	httpReq.Header.Set("X-Title", "InfraEye")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("OpenRouter request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Sprintf("Parse error: %v | raw: %s", err, string(body))
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("OpenRouter error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return "No response from OpenRouter."
	}

	return aiResp.Choices[0].Message.Content.(string)
}

func askMistral(systemContext, question, imageBase64, imageMime string) string {
	model := "mistral-large-latest"
	var content interface{} = "SYSTEM CONTEXT: " + systemContext + "\n\nUSER QUESTION: " + question

	// If there's an image, switch to the multimodal-enabled model (Pixtral)
	if imageBase64 != "" && imageMime != "" {
		model = "pixtral-12b-2409"
		content = []interface{}{
			map[string]interface{}{
				"type": "text",
				"text": "SYSTEM CONTEXT: " + systemContext + "\n\nUSER QUESTION: " + question,
			},
			map[string]interface{}{
				"type": "image_url",
				"image_url": map[string]string{
					"url": fmt.Sprintf("data:%s;base64,%s", imageMime, imageBase64),
				},
			},
		}
	}

	reqBody := openAIRequest{
		Model: model,
		Messages: []openAIMessage{
			{Role: "user", Content: content},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", "https://api.mistral.ai/v1/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Request creation failed: %v", err)
	}

	httpReq.Header.Set("Authorization", "Bearer "+config.C.MistralKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("Mistral request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		// Return friendly error if JSON parsing fails
		return fmt.Sprintf("Mistral response error: %v (likely service timeout or quota limit).", err)
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("Mistral error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return "No response from Mistral AI Vision."
	}

	return aiResp.Choices[0].Message.Content.(string)
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
			"> Configure your API keys (OpenRouter, DeepSeek, Gemini, or OpenAI) in %sbackend/.env%s for intelligent AI-powered analysis.",
		question,
		backtick, backtick,
		backtick, backtick,
		backtick, backtick, backtick, backtick,
		backtick, backtick,
		tripleBacktick, tripleBacktick,
		backtick, backtick,
	)
}
