package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"k8s.io/client-go/tools/clientcmd"
)

// mcpClient is a shared HTTP client for MCP communication
var mcpClient = &http.Client{Timeout: 30 * time.Second}

// ── MCP JSON-RPC types ─────────────────────────────────────────────────────

type mcpRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      *int        `json:"id,omitempty"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type mcpResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *mcpError       `json:"error,omitempty"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpToolCallParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

// ── ListMCPTools ────────────────────────────────────────────────────────────
// GET /api/mcp/tools — Returns list of available MCP tools from the sidecar
func ListMCPTools(c *gin.Context) {
	result, err := callMCPMethod("tools/list", nil, 0)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "MCP server unreachable",
			"details": err.Error(),
			"hint":    "Ensure kubernetes-mcp-server is running on " + config.C.MCPServerURL,
		})
		return
	}
	c.Data(http.StatusOK, "application/json", result)
}

// ── ExecuteMCPTool ──────────────────────────────────────────────────────────
// POST /api/mcp/tool — Executes a specific MCP tool with provided arguments
func ExecuteMCPTool(c *gin.Context) {
	var req struct {
		Tool      string                 `json:"tool" binding:"required"`
		Arguments map[string]interface{} `json:"arguments"`
		ServerID  uint                   `json:"server_id"` // optional: use server's kubeconfig
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// If a server_id is provided and it has a kubeconfig, inject the context
	if req.ServerID > 0 {
		var server models.Server
		if err := db.DB.First(&server, req.ServerID).Error; err == nil && server.KubeConfig != "" {
			if req.Arguments == nil {
				req.Arguments = map[string]interface{}{}
			}
			
			// Load the config to find the correct context name
			prefix := fmt.Sprintf("server-%d", server.ID)
			cfg, err := clientcmd.Load([]byte(server.KubeConfig))
			if err == nil {
				// Use current context if it matches our prefix, or find first matching one
				selectedCtx := ""
				for name := range cfg.Contexts {
					if strings.HasPrefix(name, prefix) {
						selectedCtx = name
						break
					}
				}
				// If no match, fallback to the standard prefix-plus-default name
				if selectedCtx == "" {
					selectedCtx = prefix + "-default"
				}
				req.Arguments["context"] = selectedCtx
			} else {
				// Fallback if load fails
				req.Arguments["context"] = prefix + "-default"
			}
		}
	}

	params := mcpToolCallParams{
		Name:      req.Tool,
		Arguments: req.Arguments,
	}

	result, err := callMCPMethod("tools/call", params, 1)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error":   "MCP tool execution failed",
			"details": err.Error(),
		})
		return
	}

	// Parse and re-emit the result content
	var parsed struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		// Return raw result if parsing fails
		c.Data(http.StatusOK, "application/json", result)
		return
	}

	output := ""
	for _, content := range parsed.Content {
		if content.Type == "text" {
			output += content.Text
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"tool":     req.Tool,
		"output":   output,
		"is_error": parsed.IsError,
		"success":  !parsed.IsError,
	})
}

// ── MCPServerStatus ─────────────────────────────────────────────────────────
// GET /api/mcp/status — Check if MCP server is reachable
func MCPServerStatus(c *gin.Context) {
	resp, err := mcpClient.Get(config.C.MCPServerURL + "/health")
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"available": false,
			"url":       config.C.MCPServerURL,
			"error":     err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{
		"available":   resp.StatusCode == 200,
		"url":         config.C.MCPServerURL,
		"status_code": resp.StatusCode,
	})
}

var (
	mcpInitialized bool
	mcpInitMutex   sync.Mutex
)

// ── callMCPMethod ────────────────────────────────────────────────────────────
// Internal helper: sends a JSON-RPC 2.0 request to the MCP HTTP server.
// It handles SSE response parsing and automated initialization with retry logic.
func callMCPMethod(method string, params interface{}, id int) (json.RawMessage, error) {
	// 1. Ensure the session is initialized
	if err := ensureMCPInitialized(); err != nil {
		return nil, err
	}

	// 2. Perform the actual call
	result, err := callMCPMethodRaw(method, params, intPtr(id))

	// 3. Robust Retry: If the server restarted and claims we are uninitialized, 
	// reset local state and try again once.
	if err != nil && strings.Contains(err.Error(), "is invalid during session initialization") {
		// Reset state
		mcpInitMutex.Lock()
		mcpInitialized = false
		mcpInitMutex.Unlock()

		// Re-initialize and retry call
		if err := ensureMCPInitialized(); err != nil {
			return nil, err
		}
		return callMCPMethodRaw(method, params, intPtr(id))
	}

	return result, err
}

func ensureMCPInitialized() error {
	mcpInitMutex.Lock()
	defer mcpInitMutex.Unlock()

	if mcpInitialized {
		return nil
	}

	initParams := map[string]interface{}{
		"protocolVersion": "2024-11-05", // Standard MCP version
		"capabilities":    map[string]interface{}{},
		"clientInfo": map[string]string{
			"name":    "infra-eye-backend",
			"version": "1.0.0",
		},
	}

	// Step A: Initialize
	if _, err := callMCPMethodRaw("initialize", initParams, intPtr(999)); err != nil {
		return fmt.Errorf("handshake[initialize] failed: %v", err)
	}

	// Step B: Notifications/Initialized
	if _, err := callMCPMethodRaw("notifications/initialized", nil, nil); err != nil {
		return fmt.Errorf("handshake[initialized notification] failed: %v", err)
	}

	mcpInitialized = true
	return nil
}

func intPtr(i int) *int { return &i }

func callMCPMethodRaw(method string, params interface{}, id *int) (json.RawMessage, error) {
	reqBody := mcpRequest{
		JSONRPC: "2.0",
		ID:      id,
		Method:  method,
		Params:  params,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal error: %v", err)
	}

	// The MCP server expects POSTs to the /mcp or session-specific endpoint
	// For this sidecar, we use a single global endpoint
	httpReq, err := http.NewRequest("POST", config.C.MCPServerURL+"/mcp", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("request creation failed: %v", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := mcpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("MCP server unreachable: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %v", err)
	}

	// Handle SSE format: strip "event: message\ndata: "
	rawStr := string(body)
	if bytes.Contains(body, []byte("data: ")) {
		// Quick extraction of the data part
		parts := bytes.Split(body, []byte("data: "))
		if len(parts) > 1 {
			rawStr = string(bytes.TrimSpace(parts[1]))
		}
	}

	// ── Notification Handling ──
	// JSON-RPC 2.0: Notifications (no ID) do not expect a response body.
	if id == nil {
		return nil, nil
	}

	// For standard requests, if the body is empty, it's an error
	if strings.TrimSpace(rawStr) == "" {
		return nil, fmt.Errorf("empty response for request method %s", method)
	}

	var mcpResp mcpResponse
	if err := json.Unmarshal([]byte(rawStr), &mcpResp); err != nil {
		return nil, fmt.Errorf("parse MCP response: %v | raw: %s", err, rawStr)
	}

	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP error [%d]: %s", mcpResp.Error.Code, mcpResp.Error.Message)
	}

	return mcpResp.Result, nil
}
