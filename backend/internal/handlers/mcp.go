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

// mcpClient is a shared HTTP client for MCP communication
var mcpClient = &http.Client{Timeout: 30 * time.Second}

// ── MCP JSON-RPC types ─────────────────────────────────────────────────────

type mcpRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      int         `json:"id"`
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
			// Pass cluster context via the MCP "context" argument if supported
			if req.Arguments == nil {
				req.Arguments = map[string]interface{}{}
			}
			// kubernetes-mcp-server multi-cluster: pass kubeconfig inline as context name
			// For now, rely on the mounted ~/.kube/config — server-specific kubeconfig
			// support can be added later via dynamic MCP server spawning.
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

// ── callMCPMethod ────────────────────────────────────────────────────────────
// Internal helper: sends a JSON-RPC 2.0 request to the MCP HTTP server
func callMCPMethod(method string, params interface{}, id int) (json.RawMessage, error) {
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

	httpReq, err := http.NewRequest("POST", config.C.MCPServerURL+"/mcp", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("request creation failed: %v", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := mcpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("MCP server unreachable at %s: %v", config.C.MCPServerURL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %v", err)
	}

	var mcpResp mcpResponse
	if err := json.Unmarshal(body, &mcpResp); err != nil {
		return nil, fmt.Errorf("parse MCP response: %v | raw: %s", err, string(body))
	}

	if mcpResp.Error != nil {
		return nil, fmt.Errorf("MCP error [%d]: %s", mcpResp.Error.Code, mcpResp.Error.Message)
	}

	return mcpResp.Result, nil
}
