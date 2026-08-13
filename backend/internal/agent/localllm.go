// Local LLM tool-calling client: talks to a self-hosted, OpenAI-compatible
// chat endpoint (Ollama, LM Studio, llama.cpp server, vLLM) using the OpenAI
// function-calling wire format, and translates to/from the same generic
// Message/ContentBlock/TurnResult shapes CallClaude uses — so doAgentTurn's
// orchestration logic (buildMessageHistory, tool dispatch, step creation)
// stays provider-agnostic.
package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type openAIFunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type openAIToolDef struct {
	Type     string            `json:"type"`
	Function openAIFunctionDef `json:"function"`
}

type openAIFunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIFunctionCall `json:"function"`
}

type openAIChatMessage struct {
	Role       string           `json:"role"`
	Content    *string          `json:"content"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type localLLMRequest struct {
	Model    string              `json:"model"`
	Messages []openAIChatMessage `json:"messages"`
	Tools    []openAIToolDef     `json:"tools,omitempty"`
}

type localLLMResponse struct {
	Choices []struct {
		Message openAIChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func toOpenAIMessages(systemPrompt string, messages []Message) []openAIChatMessage {
	out := []openAIChatMessage{{Role: "system", Content: &systemPrompt}}

	for _, m := range messages {
		var text string
		var toolUse *ContentBlock
		var toolResult *ContentBlock
		for i := range m.Content {
			block := &m.Content[i]
			switch block.Type {
			case "text":
				if text != "" {
					text += "\n"
				}
				text += block.Text
			case "tool_use":
				toolUse = block
			case "tool_result":
				toolResult = block
			}
		}

		switch {
		case toolResult != nil:
			out = append(out, openAIChatMessage{Role: "tool", Content: &toolResult.Content, ToolCallID: toolResult.ToolUseID})
		case toolUse != nil:
			var contentPtr *string
			if text != "" {
				contentPtr = &text
			}
			out = append(out, openAIChatMessage{
				Role:    "assistant",
				Content: contentPtr,
				ToolCalls: []openAIToolCall{{
					ID:   toolUse.ID,
					Type: "function",
					Function: openAIFunctionCall{
						Name:      toolUse.Name,
						Arguments: string(toolUse.Input),
					},
				}},
			})
		default:
			out = append(out, openAIChatMessage{Role: m.Role, Content: &text})
		}
	}

	return out
}

func toOpenAITools(tools []ToolDefinition) []openAIToolDef {
	defs := make([]openAIToolDef, 0, len(tools))
	for _, t := range tools {
		defs = append(defs, openAIToolDef{
			Type: "function",
			Function: openAIFunctionDef{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  t.InputSchema,
			},
		})
	}
	return defs
}

// CallLocalLLM sends one turn of the conversation to a self-hosted,
// OpenAI-compatible chat endpoint and returns the assistant's response in
// the same generic shape CallClaude produces.
func CallLocalLLM(baseURL, model, systemPrompt string, messages []Message, tools []ToolDefinition) (*TurnResult, error) {
	endpoint := strings.TrimRight(baseURL, "/")
	if !strings.Contains(endpoint, "/chat/completions") {
		endpoint += "/v1/chat/completions"
	}
	// Local inference (especially on CPU, or with a large tool schema) can be slow.
	return callOpenAICompatible(endpoint, "", nil, model, systemPrompt, messages, tools, 120*time.Second, "local LLM")
}

// CallOpenRouter sends one turn to OpenRouter's OpenAI-compatible endpoint,
// which fronts many hosted models (Claude, GPT, Llama, DeepSeek, etc.) behind
// a single API key.
func CallOpenRouter(apiKey, model, systemPrompt string, messages []Message, tools []ToolDefinition) (*TurnResult, error) {
	headers := map[string]string{
		"HTTP-Referer": "http://localhost:80",
		"X-Title":      "InfraEye",
	}
	return callOpenAICompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, headers, model, systemPrompt, messages, tools, 90*time.Second, "OpenRouter")
}

// CallMistral sends one turn to Mistral's OpenAI-compatible chat endpoint.
func CallMistral(apiKey, model, systemPrompt string, messages []Message, tools []ToolDefinition) (*TurnResult, error) {
	return callOpenAICompatible("https://api.mistral.ai/v1/chat/completions", apiKey, nil, model, systemPrompt, messages, tools, 90*time.Second, "Mistral")
}

// callOpenAICompatible is the shared client for any provider speaking the
// OpenAI function-calling wire format (local runtimes, OpenRouter, Mistral).
// It translates to/from the generic Message/ContentBlock/TurnResult shapes
// CallClaude uses, so doAgentTurn's orchestration stays provider-agnostic.
func callOpenAICompatible(endpoint, apiKey string, extraHeaders map[string]string, model, systemPrompt string, messages []Message, tools []ToolDefinition, timeout time.Duration, label string) (*TurnResult, error) {
	reqBody := localLLMRequest{
		Model:    model,
		Messages: toOpenAIMessages(systemPrompt, messages),
		Tools:    toOpenAITools(tools),
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}
	for k, v := range extraHeaders {
		httpReq.Header.Set(k, v)
	}

	client := &http.Client{Timeout: timeout}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%s request failed: %w (is the endpoint at %s reachable?)", label, err, endpoint)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var aiResp localLLMResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return nil, fmt.Errorf("parse response: %w | raw: %s", err, string(body))
	}
	if aiResp.Error != nil {
		return nil, fmt.Errorf("%s error: %s", label, aiResp.Error.Message)
	}
	if len(aiResp.Choices) == 0 {
		return nil, fmt.Errorf("no response from %s", label)
	}

	msg := aiResp.Choices[0].Message
	content := []ContentBlock{}
	if msg.Content != nil && *msg.Content != "" {
		content = append(content, ContentBlock{Type: "text", Text: *msg.Content})
	}
	stopReason := "end_turn"
	for _, tc := range msg.ToolCalls {
		stopReason = "tool_use"
		content = append(content, ContentBlock{
			Type:  "tool_use",
			ID:    tc.ID,
			Name:  tc.Function.Name,
			Input: json.RawMessage(tc.Function.Arguments),
		})
		break // one tool call per turn, matching the agent loop's one-action-per-turn design
	}

	return &TurnResult{StopReason: stopReason, Content: content}, nil
}
