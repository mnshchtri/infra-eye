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

	// Fetch user for personal keys
	var user models.User
	db.DB.First(&user, uID)

	// 4. Get AI Response
	answer := askAI(fullCtx, req.Question, req.ImageBase64, req.ImageMimeType, req.Provider, &user)

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

// netraSystemPrompt is the operating doctrine for Netra. Fenced blocks inside
// it use ~~~ so the surrounding Go raw string can stay untouched; they are
// rewritten to ``` below.
const netraSystemPrompt = `You are नेत्र (Netra), the senior DevSecOps / SRE / platform security engineer embedded in InfraEye, an agentless observability platform. You debug production Linux servers and Kubernetes clusters, triage security signals, and design safe remediations. You are direct, technical, and calm under incident pressure.

## OPERATING DOCTRINE (production first)
1. **Evidence before diagnosis.** Never guess. If data is missing, request it (MCP tool call for clusters, a bash command for servers) before naming a root cause. Say what you know, what you suspect, and what would confirm it.
2. **Blast radius before action.** Every suggested change states: what it touches, whether it interrupts traffic, and how to roll it back. Prefer the least invasive fix that resolves the issue.
3. **One change at a time.** Propose a single change, then verify, then proceed. Never bundle unrelated fixes into one step during an incident.
4. **Read-only by default.** Mutating operations (delete, exec, scale, apply, restart) require a stated justification and a rollback path. Never propose destructive operations (namespace deletion, volume deletion, force-drain, ` + "`rm -rf`" + `, DROP TABLE) unless the user explicitly asks and you have warned about the consequences.
5. **Least privilege.** When a fix involves permissions, grant the narrowest role/scope that works. Flag any suggestion that would widen access.
6. **Secrets stay secret.** Never echo credential values, tokens, or private keys into chat — reference them by name/location. If context data appears to contain a leaked secret, flag it as a finding.

## DEBUGGING METHODOLOGY
**Triage order:** user impact → what changed recently → resource saturation → errors in logs/events → dependencies (DNS, DB, upstream) → host/kernel.

**Linux hosts (USE method):** for CPU, memory, disk, network — check Utilization, Saturation, Errors:
- CPU: ` + "`top -bn1`, `ps aux --sort=-%cpu | head`, `mpstat 1 3`" + `; load avg vs core count; steal time on VMs.
- Memory: ` + "`free -m`, `ps aux --sort=-%mem | head`" + `; OOM killer traces via ` + "`dmesg -T | grep -i oom`" + `; swap thrash.
- Disk: ` + "`df -h`, `df -i`" + ` (inodes!), ` + "`du -xhd1 / | sort -h`, `iostat -x 1 3`" + `; deleted-but-open files via ` + "`lsof +L1`" + `.
- Network: ` + "`ss -tunap`, `ip -s link`" + `, conntrack table fill, ephemeral port exhaustion.
- Services: ` + "`systemctl --failed`, `journalctl -u <svc> -p err -n 50 --no-pager`" + `.

**Kubernetes failure taxonomy — go straight to the right check:**
- CrashLoopBackOff → ` + "`pods_log`" + ` (add previous container logs), exit code: 137=OOM/SIGKILL, 143=SIGTERM, 1=app error; check probes vs slow startup.
- OOMKilled → memory limit vs actual usage; recommend right-sized requests/limits, not just "raise the limit".
- ImagePullBackOff → image tag exists? registry auth (imagePullSecrets)? rate limits?
- Pending → ` + "`events_list`" + `: insufficient CPU/mem, node selectors/taints, unbound PVC.
- Service unreachable → endpoints empty (selector mismatch)? NetworkPolicy? kube-dns/CoreDNS health? CNI pod status.
- Node NotReady → kubelet, disk/memory pressure conditions, CNI, cloud-provider health.
- Resource knowledge: requests drive scheduling, limits drive throttling/OOM; QoS classes (Guaranteed/Burstable/BestEffort) decide eviction order; CPU throttling shows up as latency with low apparent utilization.

## SECURITY TRIAGE LENS (defensive)
When logs, events, or manifests pass through you, screen them for:
- **Access anomalies:** SSH brute force (repeated ` + "`Failed password`" + `, ` + "`Invalid user`" + `), logins at odd hours/IPs, new sudoers or authorized_keys changes.
- **Kubernetes RBAC:** service accounts bound to cluster-admin, wildcard verbs/resources in roles, default SA with mounted token doing API calls.
- **Workload hardening:** privileged containers, hostPath/hostNetwork/hostPID, containers running as root, missing resource limits, :latest tags in production.
- **Exposure:** services unexpectedly of type LoadBalancer/NodePort, 0.0.0.0 binds on the host, resources in the catalog reachable without the gateway.
- **Secrets hygiene:** credentials in env vars/ConfigMaps/logs, kubeconfigs or tokens in world-readable paths.
Report findings with severity (critical/high/medium/low), evidence, and a remediation — never exploitation steps.

## LIVE CLUSTER ACCESS (MCP)
You can request real-time cluster data. Emit a fenced code block with language tag ` + "`mcp`" + ` containing ONLY one JSON object:

~~~mcp
{"tool": "pods_list", "args": {"namespace": "kube-system"}}
~~~

The user sees an Execute button; the output returns to you automatically for analysis.

| Tool | Description | Key Args | Type |
|---|---|---|---|
| ` + "`pods_list`" + ` | List pods | namespace (opt) | read |
| ` + "`pods_log`" + ` | Pod logs | name, namespace, tail (opt) | read |
| ` + "`events_list`" + ` | Cluster events | namespace (opt) | read |
| ` + "`resources_get`" + ` | Get one resource | apiVersion, kind, name, namespace | read |
| ` + "`resources_list`" + ` | List resources | apiVersion, kind, namespace (opt) | read |
| ` + "`namespaces_list`" + ` | List namespaces | (none) | read |
| ` + "`pods_delete`" + ` | Delete a stuck pod | name, namespace | MUTATING |
| ` + "`pods_exec`" + ` | Run command in pod | name, namespace, command (array) | MUTATING |
| ` + "`resources_create_or_update`" + ` | Apply YAML | resource (YAML string) | MUTATING |
| ` + "`resources_scale`" + ` | Scale workload | apiVersion, kind, name, namespace, scale | MUTATING |

Rules: read tools freely, one per message step. MUTATING tools only after stating why, the blast radius, and the rollback. For plain servers (non-K8s), give commands in ` + "```bash" + ` blocks instead — annotate any command that modifies state.

## RESPONSE FORMAT
For diagnostic questions, structure the answer as:
1. **Assessment** — one-line verdict of what is (most likely) happening.
2. **Evidence** — the specific data points from context/tool output backing it.
3. **Root cause / hypotheses** — ranked, with what would confirm each.
4. **Fix** — exact commands or tool calls, least invasive first, rollback noted for anything mutating.
5. **Verify** — how to prove it worked.
6. **Prevent** — (when relevant) an alert rule, limit, probe, or hardening step so it doesn't recur. InfraEye supports self-healing alert rules (cpu/mem/disk/log_keyword conditions triggering SSH commands) — suggest one when it fits.
Keep casual questions casual — no template for a one-line answer. Use tables for comparisons, keep prose tight.

`

func buildContext(serverID uint) string {
	var b strings.Builder
	b.WriteString(strings.ReplaceAll(netraSystemPrompt, "~~~", "```"))

	if serverID > 0 {
		appendServerContext(&b, serverID)
	} else {
		appendFleetContext(&b)
	}
	appendResourceCatalog(&b)
	appendAlertingContext(&b, serverID)

	return b.String()
}

func appendServerContext(b *strings.Builder, serverID uint) {
	var server models.Server
	if err := db.DB.First(&server, serverID).Error; err != nil {
		return
	}
	kind := "linux server (SSH)"
	if server.IsK8s {
		kind = "Kubernetes cluster"
	}
	fmt.Fprintf(b, "# TARGET: SINGLE %s\nName: %s | Host: %s | OS: %s | Status: %s | Tags: %s\n", strings.ToUpper(kind), server.Name, server.Host, server.OS, server.Status, server.Tags)
	if server.Description != "" {
		fmt.Fprintf(b, "Description: %s\n", server.Description)
	}
	b.WriteString("\n")

	// Latest metric snapshot
	var metric models.Metric
	if err := db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").First(&metric).Error; err == nil {
		fmt.Fprintf(b, "## Latest metrics (%s)\nCPU: %.1f%% | Memory: %.1f%% (%.0f/%.0f MB) | Disk: %.1f%% (%.1f/%.1f GB) | Net RX %.2f / TX %.2f MB/s | Load1: %.2f | Uptime: %s\n\n",
			metric.Timestamp.Format("2006-01-02 15:04:05"),
			metric.CPUPercent, metric.MemPercent, metric.MemUsedMB, metric.MemTotalMB,
			metric.DiskPercent, metric.DiskUsedGB, metric.DiskTotalGB,
			metric.NetRxMBps, metric.NetTxMBps, metric.LoadAvg1,
			(time.Duration(metric.Uptime) * time.Second).String())
	}

	// Recent logs — errors/warnings first, then latest of any level
	var errLogs []models.LogEntry
	db.DB.Where("server_id = ? AND level IN ?", serverID, []string{"warn", "warning", "error", "fatal", "critical"}).Order("timestamp DESC").Limit(20).Find(&errLogs)
	var recentLogs []models.LogEntry
	db.DB.Where("server_id = ?", serverID).Order("timestamp DESC").Limit(15).Find(&recentLogs)
	if len(errLogs) > 0 || len(recentLogs) > 0 {
		b.WriteString("## Recent logs (screen for errors, saturation, and security anomalies)\n")
		seen := map[uint]bool{}
		for _, l := range append(errLogs, recentLogs...) {
			if seen[l.ID] {
				continue
			}
			seen[l.ID] = true
			fmt.Fprintf(b, "[%s] [%s] [%s] %s\n", l.Timestamp.Format("15:04:05"), l.Level, l.Source, l.Message)
		}
		b.WriteString("\n")
	}

	// Recent healing actions on this server
	appendHealingHistory(b, serverID)

	// Live Kubernetes pulse
	if server.IsK8s && server.KubeConfig != "" {
		appendK8sPulse(b, server.KubeConfig)
	}
}

func appendFleetContext(b *strings.Builder) {
	b.WriteString("# TARGET: INFRASTRUCTURE-WIDE (whole fleet)\n\n## Fleet state\n")
	var servers []models.Server
	if err := db.DB.Find(&servers).Error; err == nil {
		for _, s := range servers {
			kind := "server"
			if s.IsK8s {
				kind = "k8s-cluster"
			}
			fmt.Fprintf(b, "- %s [%s] host=%s status=%s tags=%s\n", s.Name, kind, s.Host, s.Status, s.Tags)

			var metric models.Metric
			if err := db.DB.Where("server_id = ?", s.ID).Order("timestamp DESC").First(&metric).Error; err == nil {
				fmt.Fprintf(b, "    metrics: CPU %.1f%% | RAM %.1f%% | DISK %.1f%% | load1 %.2f\n", metric.CPUPercent, metric.MemPercent, metric.DiskPercent, metric.LoadAvg1)
			}

			var logs []models.LogEntry
			db.DB.Where("server_id = ? AND level IN ?", s.ID, []string{"warn", "warning", "error", "fatal", "critical"}).Order("timestamp DESC").Limit(3).Find(&logs)
			for _, l := range logs {
				fmt.Fprintf(b, "    log[%s]: %s\n", l.Level, l.Message)
			}
		}
	}
	b.WriteString("\n")
	appendHealingHistory(b, 0)
}

// appendResourceCatalog gives Netra knowledge of the cataloged external
// resources (databases, caches, HTTP services…) and their latest probe result,
// so it can reason about dependencies when debugging.
func appendResourceCatalog(b *strings.Builder) {
	var resources []models.Resource
	if err := db.DB.Limit(30).Find(&resources).Error; err != nil || len(resources) == 0 {
		return
	}
	b.WriteString("## Resource catalog (external dependencies: DBs, caches, services)\n")
	for _, r := range resources {
		fmt.Fprintf(b, "- %s [%s/%s] %s:%d status=%s", r.Name, r.ResourceType, r.Protocol, r.Host, r.Port, r.Status)
		if r.Database != "" {
			fmt.Fprintf(b, " db=%s", r.Database)
		}
		if !r.UseGateway {
			b.WriteString(" gateway=BYPASSED(direct exposure — security-relevant)")
		}
		var probe models.ResourceMetric
		if err := db.DB.Where("resource_id = ?", r.ID).Order("timestamp DESC").First(&probe).Error; err == nil {
			fmt.Fprintf(b, " | last probe: %s %.0fms", probe.Status, probe.LatencyMs)
			if probe.Error != "" {
				fmt.Fprintf(b, " error=%q", probe.Error)
			}
		}
		b.WriteString("\n")
	}
	b.WriteString("\n")
}

// appendAlertingContext lists the enabled alert/self-healing rules that apply
// to the current scope, so Netra can spot coverage gaps and avoid proposing
// fixes the healing engine already automates.
func appendAlertingContext(b *strings.Builder, serverID uint) {
	var rules []models.AlertRule
	q := db.DB.Where("enabled = ?", true)
	if serverID > 0 {
		q = q.Where("server_id IN ?", []uint{0, serverID})
	}
	if err := q.Limit(20).Find(&rules).Error; err != nil || len(rules) == 0 {
		b.WriteString("## Alert rules\nNo enabled alert/self-healing rules in scope — flag monitoring gaps you notice.\n\n")
		return
	}
	b.WriteString("## Enabled alert / self-healing rules\n")
	for _, r := range rules {
		scope := "all servers"
		if r.ServerID > 0 {
			scope = fmt.Sprintf("server #%d", r.ServerID)
		}
		fmt.Fprintf(b, "- %q [%s] when %s %s %s → %s", r.Name, r.Severity, r.ConditionType, r.ConditionOp, r.ConditionValue, r.ActionType)
		if r.ActionCommand != "" {
			fmt.Fprintf(b, " (%s)", r.ActionCommand)
		}
		fmt.Fprintf(b, " | scope: %s | cooldown %dm\n", scope, r.CooldownMinutes)
	}
	b.WriteString("\n")
}

func appendHealingHistory(b *strings.Builder, serverID uint) {
	var actions []models.HealingAction
	q := db.DB.Order("created_at DESC").Limit(5)
	if serverID > 0 {
		q = q.Where("server_id = ?", serverID)
	}
	if err := q.Find(&actions).Error; err != nil || len(actions) == 0 {
		return
	}
	b.WriteString("## Recent self-healing actions (automated remediations already attempted)\n")
	for _, a := range actions {
		out := a.Output
		if len(out) > 200 {
			out = out[:200] + "…"
		}
		fmt.Fprintf(b, "- [%s] %s | trigger: %s | cmd: %s | output: %s\n", a.CreatedAt.Format("01-02 15:04"), a.Status, a.TriggerInfo, a.Command, out)
	}
	b.WriteString("\n")
}

// appendK8sPulse snapshots live cluster health: node readiness, failing pods,
// and warning events. Failures degrade silently — the MCP tools are the
// fallback for on-demand data.
func appendK8sPulse(b *strings.Builder, kubeconfig string) {
	clientset, err := k8s.GetK8sClient(kubeconfig)
	if err != nil {
		fmt.Fprintf(b, "## Live Kubernetes pulse\nUNAVAILABLE — could not connect to cluster: %s\n\n", err.Error())
		return
	}
	k8sCtx := context.TODO()
	b.WriteString("## Live Kubernetes pulse\n")

	// Node readiness + pressure conditions
	if nodes, err := clientset.CoreV1().Nodes().List(k8sCtx, metav1.ListOptions{}); err == nil {
		ready := 0
		var problems []string
		for _, n := range nodes.Items {
			for _, cond := range n.Status.Conditions {
				switch cond.Type {
				case "Ready":
					if cond.Status == "True" {
						ready++
					} else {
						problems = append(problems, fmt.Sprintf("node/%s NotReady (%s)", n.Name, cond.Reason))
					}
				case "MemoryPressure", "DiskPressure", "PIDPressure":
					if cond.Status == "True" {
						problems = append(problems, fmt.Sprintf("node/%s %s", n.Name, cond.Type))
					}
				}
			}
		}
		fmt.Fprintf(b, "Nodes: %d/%d Ready\n", ready, len(nodes.Items))
		for _, p := range problems {
			fmt.Fprintf(b, "- %s\n", p)
		}
	}

	// Failing pods with container-level reason (CrashLoopBackOff etc.)
	if pods, err := clientset.CoreV1().Pods("").List(k8sCtx, metav1.ListOptions{}); err == nil {
		failing := 0
		var summary strings.Builder
		for _, p := range pods.Items {
			if p.Status.Phase == "Running" || p.Status.Phase == "Succeeded" {
				// Running pods can still be broken: crashlooping containers
				healthy := true
				for _, cs := range p.Status.ContainerStatuses {
					if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
						healthy = false
						if failing < 10 {
							fmt.Fprintf(&summary, "- pod/%s ns=%s container=%s %s (restarts: %d)\n", p.Name, p.Namespace, cs.Name, cs.State.Waiting.Reason, cs.RestartCount)
						}
					}
				}
				if !healthy {
					failing++
				}
				continue
			}
			failing++
			if failing <= 10 {
				fmt.Fprintf(&summary, "- pod/%s ns=%s phase=%s\n", p.Name, p.Namespace, p.Status.Phase)
			}
		}
		fmt.Fprintf(b, "Pods: %d total, %d unhealthy\n", len(pods.Items), failing)
		b.WriteString(summary.String())
	}

	// Warning events (fall back to whatever exists if none are Warning)
	if events, err := clientset.CoreV1().Events("").List(k8sCtx, metav1.ListOptions{Limit: 50}); err == nil {
		var lines []string
		for _, e := range events.Items {
			if e.Type != "Normal" {
				lines = append(lines, fmt.Sprintf("- [%s] %s: %s (%s/%s)", e.Type, e.Reason, e.Message, e.InvolvedObject.Kind, e.InvolvedObject.Name))
			}
		}
		if len(lines) > 12 {
			lines = lines[len(lines)-12:]
		}
		if len(lines) > 0 {
			b.WriteString("Warning events:\n" + strings.Join(lines, "\n") + "\n")
		}
	}
	b.WriteString("\n")
}

func askAI(systemContext, question, imageBase64, imageMime, provider string, user *models.User) string {
	
	// Priority: 1. User specified provider + User key -> 2. User specified provider + Global key -> 3. Auto-fallback

	// Google/Gemini
	if provider == "google" || (provider == "" && (user.GeminiKey != "" || config.C.GeminiKey != "")) {
		key := config.C.GeminiKey
		if user.GeminiKey != "" { key = user.GeminiKey }
		if key != "" { return askGemini(systemContext, question, imageBase64, imageMime, key) }
	}

	// DeepSeek
	if provider == "deepseek" || (provider == "" && (user.DeepSeekKey != "" || config.C.DeepSeekKey != "")) {
		key := config.C.DeepSeekKey
		if user.DeepSeekKey != "" { key = user.DeepSeekKey }
		if key == "" { key = config.C.DeepSeekKey }
		if key != "" { return askDeepSeek(systemContext, question, key) }
	}

	// Claude (User key only for now as requested, or can add global)
	if provider == "claude" || (provider == "" && user.ClaudeKey != "") {
		if user.ClaudeKey != "" { return askClaude(systemContext, question, user.ClaudeKey) }
	}

	// Local LLM (self-hosted, OpenAI-compatible: Ollama, LM Studio, llama.cpp server, vLLM)
	if provider == "local" || (provider == "" && (user.LocalLLMURL != "" || config.C.LocalLLMURL != "")) {
		url := config.C.LocalLLMURL
		if user.LocalLLMURL != "" { url = user.LocalLLMURL }
		model := config.C.LocalLLMModel
		if user.LocalLLMModel != "" { model = user.LocalLLMModel }
		if url != "" { return askLocalLLM(systemContext, question, url, model) }
		if provider == "local" { return "No local LLM endpoint configured. Set LOCAL_LLM_URL (server-wide) or add your local endpoint in Settings → AI." }
	}

	// OpenRouter (Default fallback)
	if provider == "openrouter" || provider == "" {
		key := config.C.OpenRouterKey
		if user.OpenRouterKey != "" { key = user.OpenRouterKey }
		if key != "" { return askOpenRouter(systemContext, question, key) }
	}

	// Mistral
	if provider == "mistral" || (provider == "" && (user.MistralKey != "" || config.C.MistralKey != "")) {
		key := config.C.MistralKey
		if user.MistralKey != "" { key = user.MistralKey }
		if key != "" { return askMistral(systemContext, question, imageBase64, imageMime, key) }
	}

	if config.C.OpenAIKey != "" {
		return askOpenAI(systemContext, question)
	}

	return mockAIResponse(question)
}

func askGemini(systemContext, question, imageBase64, imageMime, apiKey string) string {
	apiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=%s", apiKey)

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

func askDeepSeek(systemContext, question, apiKey string) string {
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

	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
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

// askLocalLLM talks to a self-hosted, OpenAI-compatible chat endpoint (Ollama,
// LM Studio, llama.cpp server, vLLM, text-generation-webui). No API key is
// required since these run on trusted infrastructure the operator controls.
func askLocalLLM(systemContext, question, baseURL, model string) string {
	endpoint := strings.TrimRight(baseURL, "/")
	if !strings.Contains(endpoint, "/chat/completions") {
		endpoint += "/v1/chat/completions"
	}

	reqBody := openAIRequest{
		Model: model,
		Messages: []openAIMessage{
			{Role: "system", Content: systemContext},
			{Role: "user", Content: question},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Request creation failed: %v", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	// Local inference (especially on CPU) can be slow, so allow a generous timeout.
	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("Local LLM request failed: %v (is the server running at %s?)", err, endpoint)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Sprintf("Local LLM parse error: %v | raw: %s", err, string(body))
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("Local LLM error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return "No response from local LLM."
	}

	return aiResp.Choices[0].Message.Content.(string)
}

func askOpenRouter(systemContext, question, apiKey string) string {
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

	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
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

func askMistral(systemContext, question, imageBase64, imageMime, apiKey string) string {
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

	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 90 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("Mistral request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	// Mistral doesn't use OpenAI's {"error":{"message":...}} shape for errors —
	// it returns a bare {"detail": "..."} (e.g. on 401/422), so openAIResponse's
	// Error field never matches and a real failure used to fall through to the
	// generic "No response" message below, hiding the actual cause.
	if resp.StatusCode != http.StatusOK {
		var mistralErr struct {
			Detail  string `json:"detail"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(body, &mistralErr); err == nil {
			if mistralErr.Detail != "" {
				return fmt.Sprintf("Mistral error (%d): %s", resp.StatusCode, mistralErr.Detail)
			}
			if mistralErr.Message != "" {
				return fmt.Sprintf("Mistral error (%d): %s", resp.StatusCode, mistralErr.Message)
			}
		}
		return fmt.Sprintf("Mistral error (%d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var aiResp openAIResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		// Return friendly error if JSON parsing fails
		return fmt.Sprintf("Mistral response error: %v (likely service timeout or quota limit).", err)
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("Mistral error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Choices) == 0 {
		return fmt.Sprintf("No response from Mistral AI Vision. Raw response: %s", strings.TrimSpace(string(body)))
	}

	return aiResp.Choices[0].Message.Content.(string)
}

func askClaude(systemContext, question, apiKey string) string {
	type anthropicMessage struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	type anthropicRequest struct {
		Model     string             `json:"model"`
		MaxTokens int                `json:"max_tokens"`
		System    string             `json:"system"`
		Messages  []anthropicMessage `json:"messages"`
	}
	type anthropicResponse struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	reqBody := anthropicRequest{
		Model:     "claude-3-5-sonnet-20240620",
		MaxTokens: 4096,
		System:    systemContext,
		Messages: []anthropicMessage{
			{Role: "user", Content: question},
		},
	}

	jsonData, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Sprintf("Claude request creation failed: %v", err)
	}

	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Sprintf("Claude request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var aiResp anthropicResponse
	if err := json.Unmarshal(body, &aiResp); err != nil {
		return fmt.Sprintf("Claude parse error: %v | raw: %s", err, string(body))
	}

	if aiResp.Error != nil {
		return fmt.Sprintf("Claude API error: %s", aiResp.Error.Message)
	}

	if len(aiResp.Content) == 0 {
		return "No response from Claude."
	}

	return aiResp.Content[0].Text
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
