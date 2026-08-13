// Agent orchestrates multi-turn, human-approved DevOps automation: given a
// goal and a target server, it drives a Claude tool-calling loop that
// proposes one SSH or Kubernetes/MCP action per turn, executes it only after
// explicit approval, feeds the real result back, and repeats until Claude
// produces a final answer. See docs/DESIGN_PRINCIPLES.md for why results and
// errors are passed through to the model/user verbatim rather than abstracted.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/agent"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	sshclient "github.com/infra-eye/backend/internal/ssh"
	"github.com/infra-eye/backend/internal/ws"
)

const (
	sshToolName   = "run_ssh_command"
	maxAgentTurns = 25
)

func agentRoom(runID uint) string {
	return fmt.Sprintf("agent-run-%d", runID)
}

// ── Tool definitions ────────────────────────────────────────────────────────

func sshToolDefinition() agent.ToolDefinition {
	schema := json.RawMessage(`{
		"type": "object",
		"properties": {
			"server_id": {"type": "integer", "description": "Target server id; must equal the server this run is scoped to"},
			"command": {"type": "string", "description": "Shell command to execute over SSH on the target server"}
		},
		"required": ["server_id", "command"]
	}`)
	return agent.ToolDefinition{
		Name:        sshToolName,
		Description: "Run a shell command over SSH on the target Linux server. Requires human approval before execution.",
		InputSchema: schema,
	}
}

func fetchMCPToolDefinitions() ([]agent.ToolDefinition, error) {
	result, err := callMCPMethod("tools/list", nil, 0)
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		return nil, err
	}
	defs := make([]agent.ToolDefinition, 0, len(parsed.Tools))
	for _, t := range parsed.Tools {
		defs = append(defs, agent.ToolDefinition{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: t.InputSchema,
		})
	}
	return defs, nil
}

func agentPreamble(run *models.AgentRun, server models.Server) string {
	return fmt.Sprintf(`You are InfraEye's Agent, operating in a human-approved DevOps automation loop against server %q (id %d).

Goal: %s

Rules:
- Propose at most ONE tool call per turn. Every tool call requires explicit human approval before it executes — you will see the real result (or a rejection notice) before your next turn.
- Use %s for shell commands over SSH, and the provided Kubernetes/MCP tools for cluster operations. Only target server_id %d.
- When the goal is fully achieved, or you need to stop, respond with plain text summarizing the outcome and do not call any tool — this ends the run.
- If a tool call is rejected, do not repeat it verbatim; propose an alternative approach or ask a clarifying question as your final answer.`,
		server.Name, server.ID, run.Goal, sshToolName, run.ServerID)
}

// ── Conversation reconstruction ─────────────────────────────────────────────

func buildMessageHistory(run *models.AgentRun, steps []models.AgentStep) []agent.Message {
	messages := []agent.Message{
		{Role: "user", Content: []agent.ContentBlock{{Type: "text", Text: run.Goal}}},
	}

	for _, step := range steps {
		if step.Kind == "final_answer" || step.Status == "pending_approval" {
			continue
		}

		assistantBlocks := []agent.ContentBlock{}
		if step.Reasoning != "" {
			assistantBlocks = append(assistantBlocks, agent.ContentBlock{Type: "text", Text: step.Reasoning})
		}
		assistantBlocks = append(assistantBlocks, agent.ContentBlock{
			Type:  "tool_use",
			ID:    step.ToolUseID,
			Name:  step.ToolName,
			Input: json.RawMessage(step.ToolArgs),
		})
		messages = append(messages, agent.Message{Role: "assistant", Content: assistantBlocks})

		resultText := step.Output
		isError := false
		switch step.Status {
		case "rejected":
			resultText = "User rejected this action and it was not executed. Propose an alternative or ask a clarifying question."
			isError = true
		case "failed":
			resultText = step.ErrorText
			isError = true
		}
		messages = append(messages, agent.Message{Role: "user", Content: []agent.ContentBlock{
			{Type: "tool_result", ToolUseID: step.ToolUseID, Content: resultText, IsError: isError},
		}})
	}

	return messages
}

// ── Turn driver ──────────────────────────────────────────────────────────────

func failAgentRun(run *models.AgentRun, errText string) {
	now := time.Now()
	run.Status = "failed"
	run.ErrorText = errText
	run.FinishedAt = &now
	db.DB.Save(run)
	ws.GlobalHub.Broadcast(agentRoom(run.ID), "run_failed", gin.H{"run_id": run.ID, "status": run.Status, "error": run.ErrorText})
}

// doAgentTurn executes exactly one turn of the agent loop: it calls Claude
// with the reconstructed conversation and either creates a pending_approval
// step (waiting for a human decision), a final_answer step (run completed),
// or fails the run. It recurses once, synchronously, when Claude names a
// tool that isn't offered — no human decision is needed to correct that.
func doAgentTurn(run *models.AgentRun) {
	var steps []models.AgentStep
	db.DB.Where("agent_run_id = ?", run.ID).Order("step_number ASC").Find(&steps)

	if len(steps) >= maxAgentTurns {
		failAgentRun(run, fmt.Sprintf("Reached the maximum of %d turns without completing the goal.", maxAgentTurns))
		return
	}

	var server models.Server
	if err := db.DB.First(&server, run.ServerID).Error; err != nil {
		failAgentRun(run, "target server not found")
		return
	}

	var user models.User
	if err := db.DB.First(&user, run.UserID).Error; err != nil || user.ClaudeKey == "" {
		failAgentRun(run, "Claude API key not configured for this user")
		return
	}

	systemPrompt := buildContext(run.ServerID) + "\n\n" + agentPreamble(run, server)

	tools := []agent.ToolDefinition{sshToolDefinition()}
	if mcpTools, err := fetchMCPToolDefinitions(); err == nil {
		tools = append(tools, mcpTools...)
	}

	messages := buildMessageHistory(run, steps)

	result, err := agent.CallClaude(user.ClaudeKey, systemPrompt, messages, tools)
	if err != nil {
		failAgentRun(run, err.Error())
		return
	}

	var reasoning string
	var toolUse *agent.ContentBlock
	for i := range result.Content {
		block := result.Content[i]
		if block.Type == "text" {
			if reasoning != "" {
				reasoning += "\n"
			}
			reasoning += block.Text
		} else if block.Type == "tool_use" && toolUse == nil {
			toolUse = &result.Content[i]
		}
	}

	nextStepNumber := len(steps) + 1

	if toolUse == nil {
		now := time.Now()
		step := models.AgentStep{
			AgentRunID: run.ID,
			StepNumber: nextStepNumber,
			Kind:       "final_answer",
			Reasoning:  reasoning,
			Status:     "executed",
			ExecutedAt: &now,
		}
		db.DB.Create(&step)
		run.Status = "completed"
		run.FinishedAt = &now
		db.DB.Save(run)
		ws.GlobalHub.Broadcast(agentRoom(run.ID), "run_completed", gin.H{"run_id": run.ID, "step": step})
		return
	}

	knownTool := toolUse.Name == sshToolName
	if !knownTool {
		for _, t := range tools {
			if t.Name == toolUse.Name {
				knownTool = true
				break
			}
		}
	}

	kind := "mcp_tool"
	if toolUse.Name == sshToolName {
		kind = "ssh_command"
	}

	if !knownTool {
		now := time.Now()
		step := models.AgentStep{
			AgentRunID: run.ID,
			StepNumber: nextStepNumber,
			Kind:       "unknown_tool",
			ToolName:   toolUse.Name,
			ToolArgs:   string(toolUse.Input),
			ToolUseID:  toolUse.ID,
			Reasoning:  reasoning,
			Status:     "failed",
			ErrorText:  fmt.Sprintf("Unknown tool %q was proposed and was not executed.", toolUse.Name),
			ExecutedAt: &now,
		}
		db.DB.Create(&step)
		ws.GlobalHub.Broadcast(agentRoom(run.ID), "step_updated", gin.H{"run_id": run.ID, "step": step})
		doAgentTurn(run)
		return
	}

	step := models.AgentStep{
		AgentRunID: run.ID,
		StepNumber: nextStepNumber,
		Kind:       kind,
		ToolName:   toolUse.Name,
		ToolArgs:   string(toolUse.Input),
		ToolUseID:  toolUse.ID,
		Reasoning:  reasoning,
		Status:     "pending_approval",
	}
	db.DB.Create(&step)
	run.Status = "awaiting_approval"
	db.DB.Save(run)
	ws.GlobalHub.Broadcast(agentRoom(run.ID), "step_created", gin.H{"run_id": run.ID, "step": step})
}

// executeAgentStep runs the approved step's tool call and records the real
// output/error on it. Only called after explicit human approval.
func executeAgentStep(run *models.AgentRun, step *models.AgentStep) {
	now := time.Now()

	switch step.Kind {
	case "ssh_command":
		var args struct {
			ServerID uint   `json:"server_id"`
			Command  string `json:"command"`
		}
		if err := json.Unmarshal([]byte(step.ToolArgs), &args); err != nil {
			step.Status = "failed"
			step.ErrorText = fmt.Sprintf("invalid tool arguments: %v", err)
			break
		}
		if args.ServerID != run.ServerID {
			step.Status = "failed"
			step.ErrorText = fmt.Sprintf("refused: server_id %d does not match this run's server %d", args.ServerID, run.ServerID)
			break
		}
		var server models.Server
		if err := db.DB.First(&server, run.ServerID).Error; err != nil {
			step.Status = "failed"
			step.ErrorText = "target server not found"
			break
		}
		client, err := sshclient.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
		if err != nil {
			step.Status = "failed"
			step.ErrorText = fmt.Sprintf("SSH connect error: %v", err)
			break
		}
		stdout, stderr, err := client.RunCommandTimeout(args.Command, 30*time.Second)
		if err != nil {
			step.Status = "failed"
			step.ErrorText = fmt.Sprintf("Error: %v\nStderr: %s\nStdout: %s", err, stderr, stdout)
		} else {
			step.Status = "executed"
			step.Output = stdout
			if stderr != "" {
				step.Output += "\n[stderr]\n" + stderr
			}
		}
	case "mcp_tool":
		var args map[string]interface{}
		if step.ToolArgs != "" {
			_ = json.Unmarshal([]byte(step.ToolArgs), &args)
		}
		output, isError, err := executeMCPToolInternal(run.ServerID, step.ToolName, args)
		if err != nil {
			step.Status = "failed"
			step.ErrorText = err.Error()
		} else if isError {
			step.Status = "failed"
			step.ErrorText = output
		} else {
			step.Status = "executed"
			step.Output = output
		}
	default:
		step.Status = "failed"
		step.ErrorText = "unsupported step kind"
	}

	step.ExecutedAt = &now
	db.DB.Save(step)
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

func loadOwnedAgentRun(c *gin.Context) (models.AgentRun, bool) {
	var run models.AgentRun
	if err := db.DB.First(&run, c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "agent run not found"})
		return run, false
	}
	role := c.GetString("role")
	userID := c.GetUint("user_id")
	if run.UserID != userID && role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "you do not have access to this agent run"})
		return run, false
	}
	return run, true
}

func loadAgentRunWithSteps(runID uint) models.AgentRun {
	var run models.AgentRun
	db.DB.First(&run, runID)
	steps := []models.AgentStep{}
	db.DB.Where("agent_run_id = ?", runID).Order("step_number ASC").Find(&steps)
	run.Steps = steps
	return run
}

// CreateAgentRun — POST /api/agent/runs
func CreateAgentRun(c *gin.Context) {
	var req struct {
		Goal     string `json:"goal" binding:"required"`
		ServerID uint   `json:"server_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	role := c.GetString("role")
	userID := c.GetUint("user_id")

	if !HasServerAccess(role, userID, req.ServerID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "you have not been granted access to this server"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	if user.ClaudeKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Set your Claude API key in Settings → AI to use the Agent"})
		return
	}

	if err := db.DB.First(&models.Server{}, req.ServerID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	run := models.AgentRun{
		UserID:    userID,
		ServerID:  req.ServerID,
		Goal:      req.Goal,
		Status:    "running",
		Provider:  "claude",
		Model:     agent.ClaudeModel,
		StartedAt: time.Now(),
	}
	if err := db.DB.Create(&run).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create agent run"})
		return
	}

	doAgentTurn(&run)

	c.JSON(http.StatusCreated, loadAgentRunWithSteps(run.ID))
}

// ListAgentRuns — GET /api/agent/runs
func ListAgentRuns(c *gin.Context) {
	userID := c.GetUint("user_id")
	runs := []models.AgentRun{}
	db.DB.Where("user_id = ?", userID).Order("created_at DESC").Find(&runs)
	c.JSON(http.StatusOK, runs)
}

// GetAgentRun — GET /api/agent/runs/:id
func GetAgentRun(c *gin.Context) {
	run, ok := loadOwnedAgentRun(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, loadAgentRunWithSteps(run.ID))
}

// ApproveAgentStep — POST /api/agent/runs/:id/steps/:stepId/approve
func ApproveAgentStep(c *gin.Context) {
	run, ok := loadOwnedAgentRun(c)
	if !ok {
		return
	}
	if run.Status != "awaiting_approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "run is not awaiting approval"})
		return
	}

	var step models.AgentStep
	if err := db.DB.Where("id = ? AND agent_run_id = ?", c.Param("stepId"), run.ID).First(&step).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "step not found"})
		return
	}
	if step.Status != "pending_approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "step is not pending approval"})
		return
	}

	userID := c.GetUint("user_id")
	now := time.Now()
	step.DecidedByUserID = &userID
	step.DecidedAt = &now

	executeAgentStep(&run, &step)
	ws.GlobalHub.Broadcast(agentRoom(run.ID), "step_updated", gin.H{"run_id": run.ID, "step": step})

	run.Status = "running"
	db.DB.Save(&run)

	doAgentTurn(&run)

	c.JSON(http.StatusOK, loadAgentRunWithSteps(run.ID))
}

// RejectAgentStep — POST /api/agent/runs/:id/steps/:stepId/reject
func RejectAgentStep(c *gin.Context) {
	run, ok := loadOwnedAgentRun(c)
	if !ok {
		return
	}
	if run.Status != "awaiting_approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "run is not awaiting approval"})
		return
	}

	var step models.AgentStep
	if err := db.DB.Where("id = ? AND agent_run_id = ?", c.Param("stepId"), run.ID).First(&step).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "step not found"})
		return
	}
	if step.Status != "pending_approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "step is not pending approval"})
		return
	}

	userID := c.GetUint("user_id")
	now := time.Now()
	step.Status = "rejected"
	step.DecidedByUserID = &userID
	step.DecidedAt = &now
	step.ExecutedAt = &now
	db.DB.Save(&step)
	ws.GlobalHub.Broadcast(agentRoom(run.ID), "step_updated", gin.H{"run_id": run.ID, "step": step})

	run.Status = "running"
	db.DB.Save(&run)

	doAgentTurn(&run)

	c.JSON(http.StatusOK, loadAgentRunWithSteps(run.ID))
}

// CancelAgentRun — POST /api/agent/runs/:id/cancel
func CancelAgentRun(c *gin.Context) {
	run, ok := loadOwnedAgentRun(c)
	if !ok {
		return
	}
	if run.Status != "running" && run.Status != "awaiting_approval" {
		c.JSON(http.StatusConflict, gin.H{"error": "run is not active"})
		return
	}

	now := time.Now()
	db.DB.Model(&models.AgentStep{}).
		Where("agent_run_id = ? AND status = ?", run.ID, "pending_approval").
		Updates(map[string]interface{}{"status": "rejected", "executed_at": now})

	run.Status = "cancelled"
	run.FinishedAt = &now
	db.DB.Save(&run)
	ws.GlobalHub.Broadcast(agentRoom(run.ID), "run_cancelled", gin.H{"run_id": run.ID, "status": run.Status})

	c.JSON(http.StatusOK, loadAgentRunWithSteps(run.ID))
}

// AgentRunWS subscribes a client to live updates for one agent run.
func AgentRunWS(c *gin.Context) {
	run, ok := loadOwnedAgentRun(c)
	if !ok {
		return
	}
	conn, err := UpgradeConn(c.Writer, c.Request)
	if err != nil {
		return
	}
	client := ws.GlobalHub.Register(conn, agentRoom(run.ID))
	client.ReadPump(ws.GlobalHub, nil)
}
