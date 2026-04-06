package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/mcp"
	"github.com/infra-eye/backend/internal/models"
	"k8s.io/client-go/tools/clientcmd"
)

// mcpClient is used for short-lived JSON-RPC POST calls (tool invocations, handshake)
var mcpClient = &http.Client{Timeout: 60 * time.Second}

// mcpSSEClient has NO timeout — it owns the long-lived SSE stream.
// A 30s timeout on the shared client was killing the stream before tool responses arrived.
var mcpSSEClient = &http.Client{Timeout: 0}


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
func MCPServerStatus(c *gin.Context) {
	// Force a fresh sync of the master kubeconfig before checking status
	if err := mcp.SyncMasterKubeconfig(); err != nil {
		log.Printf("⚠️ MCP: Kubeconfig sync failed: %v", err)
	}

	resp, err := mcpClient.Get(config.C.MCPServerURL + "/healthz")
	if err != nil {
		// Try fallback to root if /health 404s or fails
		resp, err = mcpClient.Get(config.C.MCPServerURL + "/sse")
	}

	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"available": false,
			"url":       config.C.MCPServerURL,
			"error":     err.Error(),
			"hint":      "Check if mcp-server container is running and port 8090 is open",
		})
		return
	}
	defer resp.Body.Close()

	c.JSON(http.StatusOK, gin.H{
		"available":   resp.StatusCode == 200 || resp.StatusCode == 404, // 404 means server is up but endpoint missing
		"url":         config.C.MCPServerURL,
		"status_code": resp.StatusCode,
	})
}

var (
	mcpInitialized   bool
	mcpSessionURL    string
	mcpSSEConnection io.ReadCloser
	mcpInitMutex     sync.Mutex

	// Atomic counter for unique JSON-RPC request IDs.
	// Using a fixed id (e.g. 1) caused concurrent tool calls to collide
	// on the same pending channel, so only one would receive the response.
	mcpRequestIDCounter int64

	// pendingRequests keeps track of ongoing JSON-RPC calls over SSE
	pendingRequests = make(map[int]chan json.RawMessage)
	pendingMutex    sync.Mutex
)

// ── callMCPMethod ────────────────────────────────────────────────────────────
// Internal helper: sends a JSON-RPC 2.0 request to the MCP HTTP server.
// Uses an atomic counter to generate unique request IDs, preventing concurrent
// tool calls from colliding on the same pending SSE response channel.
func callMCPMethod(method string, params interface{}, _ int) (json.RawMessage, error) {
	// Generate a unique ID for this request
	id := int(atomic.AddInt64(&mcpRequestIDCounter, 1))

	// 1. Ensure the session is initialized
	if err := ensureMCPInitialized(); err != nil {
		return nil, err
	}

	// 2. Perform the actual call
	result, err := callMCPMethodRaw(method, params, intPtr(id))

	// 3. Robust Retry: If the server claims we are uninitialized or session is lost
	if err != nil && (strings.Contains(err.Error(), "invalid during session initialization") ||
		strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "session not found")) {

		log.Printf("🔄 MCP: Session lost or invalid, re-initializing: %v", err)

		// Reset state
		mcpInitMutex.Lock()
		if mcpSSEConnection != nil {
			mcpSSEConnection.Close()
			mcpSSEConnection = nil
		}
		mcpInitialized = false
		mcpSessionURL = ""
		mcpInitMutex.Unlock()

		// Re-initialize and retry with a fresh unique ID
		newID := int(atomic.AddInt64(&mcpRequestIDCounter, 1))
		if err := ensureMCPInitialized(); err != nil {
			return nil, err
		}
		return callMCPMethodRaw(method, params, intPtr(newID))
	}

	return result, err
}

func ensureMCPInitialized() error {
	mcpInitMutex.Lock()
	defer mcpInitMutex.Unlock()

	if mcpInitialized && mcpSessionURL != "" {
		return nil
	}

	// Step 0: Establish SSE Session (with retry loop for sidecar startup)
	log.Printf("🔗 MCP: Establishing SSE session at %s/sse", config.C.MCPServerURL)

	var resp *http.Response
	var err error
	for i := 0; i < 5; i++ {
		resp, err = mcpSSEClient.Get(config.C.MCPServerURL + "/sse")
		if err == nil {
			break
		}
		log.Printf("⏳ MCP: Sidecar not ready (attempt %d/5): %v", i+1, err)
		time.Sleep(2 * time.Second)
	}

	if err != nil {
		return fmt.Errorf("sidecar unreachable after retries: %v", err)
	}
	// DO NOT CLOSE resp.Body here! The MCP session is tied to the life of this connection.
	mcpSSEConnection = resp.Body

	// Wait for the 'endpoint' event (robust parsing)
	reader := bufio.NewReader(resp.Body)
	endpoint := ""
	for i := 0; i < 10; i++ { // Check first 10 lines
		line, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		if strings.HasPrefix(line, "data: ") {
			endpoint = strings.TrimSpace(strings.TrimPrefix(line, "data: "))
			break
		}
	}

	if endpoint == "" {
		// Fallback to reading a chunk if no newline found
		buf := make([]byte, 512)
		n, _ := reader.Read(buf)
		content := string(buf[:n])
		if strings.Contains(content, "data: ") {
			parts := strings.Split(content, "data: ")
			if len(parts) > 1 {
				endpoint = strings.TrimSpace(strings.Split(parts[1], "\n")[0])
			}
		}
	}

	if endpoint == "" {
		log.Printf("⚠️ MCP: No endpoint event found in SSE stream. Check sidecar logs.")
		return fmt.Errorf("no endpoint received from /sse")
	}
	log.Printf("📡 MCP: Session endpoint received: %s", endpoint)

	// Step 1: Start Background SSE Message Handler
	// IMPORTANT: pass `reader` (the existing bufio.Reader that already wraps resp.Body),
	// NOT a new bufio.NewReader(body). Creating a second reader on the same body would
	// miss any data already buffered by `reader`, causing tool responses to be dropped.
	go func(r *bufio.Reader) {
		for {
			line, err := r.ReadString('\n')
			if err != nil {
				log.Printf("📡 MCP: SSE Connection closed: %v. Resetting session.", err)
				mcpInitMutex.Lock()
				mcpInitialized = false
				mcpSessionURL = ""
				mcpSSEConnection = nil
				mcpInitMutex.Unlock()
				return
			}

			// Handle lines like "data: { ...JSON-RPC... }"
			if strings.HasPrefix(line, "data: ") {
				data := strings.TrimSpace(strings.TrimPrefix(line, "data: "))
				if data == "" || data == "undefined" {
					continue
				}

				// Try to parse the response
				var mcpResp mcpResponse
				if err := json.Unmarshal([]byte(data), &mcpResp); err == nil {
					// Route the result to the waiting caller
					pendingMutex.Lock()
					ch, ok := pendingRequests[mcpResp.ID]
					if ok {
						ch <- json.RawMessage(data)
						delete(pendingRequests, mcpResp.ID)
					}
					pendingMutex.Unlock()
				}
			}
		}
	}(reader)

	// Prepend host if it's a relative path
	if strings.HasPrefix(endpoint, "/") {
		mcpSessionURL = config.C.MCPServerURL + endpoint
	} else {
		mcpSessionURL = endpoint
	}
	log.Printf("✅ MCP: Session established: %s", mcpSessionURL)

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

	// 0. Register the request ID before sending to avoid race conditions with fast SSE responses
	if id != nil {
		pendingMutex.Lock()
		pendingRequests[*id] = make(chan json.RawMessage, 1)
		pendingMutex.Unlock()
	}

	// Use the established session URL, or fallback to default if not yet established
	targetURL := mcpSessionURL
	if targetURL == "" {
		targetURL = config.C.MCPServerURL + "/mcp"
	}

	httpReq, err := http.NewRequest("POST", targetURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("request creation failed: %v", err)
	}

	// Add session ID header if available in the URL
	if strings.Contains(targetURL, "sessionid=") {
		parts := strings.Split(targetURL, "sessionid=")
		if len(parts) > 1 {
			httpReq.Header.Set("Mcp-Session-Id", parts[1])
		}
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := mcpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("MCP server unreachable at %s: %v", targetURL, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	rawStr := string(body)

	// --- Handle Asynchronous Responses (Status 202) ---
	// Official Model Context Protocol behavior for SSE transport:
	// If the server returns 202, the result will be sent later on the SSE stream.
	if resp.StatusCode == 202 || (resp.StatusCode == 200 && strings.TrimSpace(rawStr) == "") {
		if id == nil {
			return nil, nil // Notification
		}

		// Use the already registered channel (registered in callMCPMethodRaw above)
		pendingMutex.Lock()
		ch, ok := pendingRequests[*id]
		pendingMutex.Unlock()

		if !ok {
			return nil, fmt.Errorf("id %d was not registered for SSE response tracking", *id)
		}

		// Wait for response from the background handler or timeout
		select {
		case asyncData := <-ch:
			rawStr = string(asyncData)
		case <-time.After(90 * time.Second):
			pendingMutex.Lock()
			delete(pendingRequests, *id)
			pendingMutex.Unlock()
			return nil, fmt.Errorf("timeout waiting for SSE response for id %d", *id)
		}
	} else if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("MCP server error (status %d): %s", resp.StatusCode, rawStr)
	}

	// For standard requests, if the body is empty, it's an error
	if strings.TrimSpace(rawStr) == "" {
		return nil, fmt.Errorf("empty response (status %d) for method %s", resp.StatusCode, method)
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

// ── RunKubectlViaMCP ─────────────────────────────────────────────────────────
// POST /api/mcp/kubectl — Executes a kubectl command via the MCP kubernetes server.
// Supports server context injection so the command targets the correct cluster.
func RunKubectlViaMCP(c *gin.Context) {
	var req struct {
		ServerID uint   `json:"server_id"`
		Command  string `json:"command" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build arguments for the MCP kubectl tool
	args := map[string]interface{}{
		"command": req.Command,
	}

	// If a server_id is given, resolve the correct context name
	if req.ServerID > 0 {
		var server models.Server
		if err := db.DB.First(&server, req.ServerID).Error; err == nil && server.KubeConfig != "" {
			prefix := fmt.Sprintf("server-%d", server.ID)
			cfg, parseErr := clientcmd.Load([]byte(server.KubeConfig))
			if parseErr == nil {
				// Find the prefixed context we wrote during SyncMasterKubeconfig
				selectedCtx := ""
				for name := range cfg.Contexts {
					fullName := fmt.Sprintf("%s-%s", prefix, name)
					selectedCtx = fullName
					break
				}
				if selectedCtx == "" {
					selectedCtx = prefix + "-default"
				}
				args["context"] = selectedCtx
			} else {
				args["context"] = prefix + "-default"
			}
		}
	}

	// Sync kubeconfig first to ensure the MCP server sees latest clusters
	if err := mcp.SyncMasterKubeconfig(); err != nil {
		log.Printf("⚠️ MCP kubectl: kubeconfig sync warning: %v", err)
	}

	params := mcpToolCallParams{
		Name:      "kubectl_generic",
		Arguments: args,
	}

	result, err := callMCPMethod("tools/call", params, 2)
	if err != nil {
		// The MCP tool name may differ; try alternate tool names
		params.Name = "kubectl"
		result, err = callMCPMethod("tools/call", params, 3)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error":    "MCP kubectl execution failed",
				"details":  err.Error(),
				"is_error": true,
				"success":  false,
			})
			return
		}
	}

	// Parse the tool result
	var parsed struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		c.Data(http.StatusOK, "application/json", result)
		return
	}

	output := strings.Builder{}
	for _, content := range parsed.Content {
		if content.Type == "text" {
			output.WriteString(content.Text)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"command":  req.Command,
		"output":   output.String(),
		"is_error": parsed.IsError,
		"success":  !parsed.IsError,
	})
}
