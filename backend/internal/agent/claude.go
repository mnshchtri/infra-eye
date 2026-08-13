// Package agent provides a minimal Claude Messages API client that supports
// native multi-turn tool calling (tools / tool_use / tool_result), used by
// the Agent DevOps-orchestration handlers. It intentionally does not reuse
// ai.go's askClaude helper, whose single-shot request/response structs use
// a plain string message Content and cannot represent tool_use/tool_result
// content blocks.
package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ClaudeModel is the model used for all Agent tool-calling turns.
const ClaudeModel = "claude-sonnet-5"

const anthropicMessagesURL = "https://api.anthropic.com/v1/messages"

// ContentBlock is one block of a Claude message. Depending on Type, only the
// relevant fields are populated:
//   - "text": Text
//   - "tool_use": ID, Name, Input
//   - "tool_result": ToolUseID, Content, IsError
type ContentBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text,omitempty"`
	ID        string          `json:"id,omitempty"`
	Name      string          `json:"name,omitempty"`
	Input     json.RawMessage `json:"input,omitempty"`
	ToolUseID string          `json:"tool_use_id,omitempty"`
	Content   string          `json:"content,omitempty"`
	IsError   bool            `json:"is_error,omitempty"`
}

// Message is one turn of the conversation, sent to or received from Claude.
type Message struct {
	Role    string         `json:"role"`
	Content []ContentBlock `json:"content"`
}

// ToolDefinition describes one callable tool, in Claude's tools schema.
type ToolDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// TurnResult is the parsed outcome of a single CallClaude turn.
type TurnResult struct {
	StopReason string
	Content    []ContentBlock
}

type anthropicRequest struct {
	Model     string           `json:"model"`
	MaxTokens int              `json:"max_tokens"`
	System    string           `json:"system,omitempty"`
	Messages  []Message        `json:"messages"`
	Tools     []ToolDefinition `json:"tools,omitempty"`
}

type anthropicResponse struct {
	Content    []ContentBlock `json:"content"`
	StopReason string         `json:"stop_reason"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// CallClaude sends one turn of the conversation to Claude, with the given
// system prompt and available tools, and returns the assistant's response
// blocks (which may include one or more tool_use blocks).
func CallClaude(apiKey, systemPrompt string, messages []Message, tools []ToolDefinition) (*TurnResult, error) {
	reqBody := anthropicRequest{
		Model:     ClaudeModel,
		MaxTokens: 4096,
		System:    systemPrompt,
		Messages:  messages,
		Tools:     tools,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", anthropicMessagesURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var aiResp anthropicResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return nil, fmt.Errorf("parse response: %w | raw: %s", err, string(body))
	}

	if aiResp.Error != nil {
		return nil, fmt.Errorf("claude API error: %s", aiResp.Error.Message)
	}

	return &TurnResult{StopReason: aiResp.StopReason, Content: aiResp.Content}, nil
}
