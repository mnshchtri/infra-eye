// Package httpapi holds the InfraEye REST/WebSocket route table, shared
// between cmd/server (Docker/production, serves the SPA from disk) and
// cmd/desktop (Wails, serves the SPA from an embedded FS). Each entrypoint
// owns its own gin.Engine, CORS config, and static-asset serving; this
// package only wires the API/WS routes so both stay in sync automatically.
package httpapi

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/handlers"
	"github.com/infra-eye/backend/internal/middleware"
	"github.com/infra-eye/backend/internal/models"
	wshub "github.com/infra-eye/backend/internal/ws"
)

// RegisterRoutes wires every REST and WebSocket route onto r.
func RegisterRoutes(r *gin.Engine) {
	// ── Public routes ──────────────────────────────────────────
	r.POST("/api/auth/login", handlers.Login)
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "version": "1.0.0", "time": time.Now()})
	})

	// OIDC routes
	r.GET("/api/auth/oidc/config", handlers.GetOIDCConfig)
	r.GET("/api/auth/oidc/login", handlers.OIDCLogin)
	r.GET("/api/auth/oidc/callback", handlers.OIDCCallback)

	// ── Protected routes ───────────────────────────────────────
	api := r.Group("/api", middleware.Auth())
	{
		// Auth
		api.GET("/auth/me", handlers.GetMe)
		api.PUT("/auth/me", handlers.UpdateProfile)

		// ── User Management (admin only) ──────────────────────────
		api.GET("/users", middleware.RequireRole("admin", "devops"), handlers.ListUsers)
		api.POST("/users", middleware.RequireRole("admin"), handlers.CreateUser)
		api.PUT("/users/:id", middleware.RequireRole("admin"), handlers.UpdateUser)
		api.DELETE("/users/:id", middleware.RequireRole("admin"), handlers.DeleteUser)

		// ── Folders (shared grouping across servers/clusters/resources) ──
		api.GET("/folders", handlers.ListFolders)
		api.POST("/folders", middleware.RequireRole("admin", "devops"), handlers.CreateFolder)
		api.PUT("/folders/:id", middleware.RequireRole("admin", "devops"), handlers.UpdateFolder)
		api.DELETE("/folders/:id", middleware.RequireRole("admin", "devops"), handlers.DeleteFolder)

		// ── Servers ───────────────────────────────────────────────
		api.GET("/servers", handlers.ListServers)
		api.POST("/servers", middleware.RequireRole("admin", "devops"), handlers.CreateServer)
		api.GET("/servers/:id", handlers.GetServer)
		api.PUT("/servers/:id", middleware.RequireRole("admin", "devops"), handlers.UpdateServer)
		api.DELETE("/servers/:id", middleware.RequireRole("admin"), handlers.DeleteServer)
		api.POST("/servers/:id/test", middleware.RequireRole("admin", "devops"), handlers.TestServerConnection)
		api.POST("/servers/:id/disconnect", middleware.RequireRole("admin", "devops"), handlers.DisconnectServer)
		api.POST("/servers/:id/reboot", middleware.RequireRole("admin", "devops"), handlers.RebootServer)
		api.POST("/servers/:id/diagnose", middleware.RequireRole("admin", "devops"), handlers.DiagnoseServer)
		api.POST("/servers/test-k8s", middleware.RequireRole("admin", "devops"), handlers.TestK8sConnection)
		api.PATCH("/servers/:id/folder", middleware.RequireRole("admin", "devops"), handlers.MoveServerFolder)

		// ── OS accounts on target servers (Cockpit-style) ────────
		api.GET("/servers/:id/accounts", middleware.RequireRole("admin", "devops"), handlers.ListOSAccounts)
		api.GET("/servers/:id/k8s-accounts", middleware.RequireRole("admin", "devops"), handlers.GetK8sAccounts)
		api.POST("/servers/:id/accounts", middleware.RequireRole("admin"), handlers.CreateOSAccount)
		api.PUT("/servers/:id/accounts/:username", middleware.RequireRole("admin"), handlers.UpdateOSAccount)
		api.DELETE("/servers/:id/accounts/:username", middleware.RequireRole("admin"), handlers.DeleteOSAccount)

		// ── Server access grants (per-user RBAC) ─────────────────
		api.GET("/servers/:id/access", middleware.RequireRole("admin", "devops"), handlers.ListServerAccess)
		api.POST("/servers/:id/access", middleware.RequireRole("admin"), handlers.CreateServerAccess)
		api.PUT("/servers/:id/access/:accessId", middleware.RequireRole("admin"), handlers.UpdateServerAccess)
		api.DELETE("/servers/:id/access/:accessId", middleware.RequireRole("admin"), handlers.DeleteServerAccess)

		// ── Resources ───────────────────────────────────────────
		api.GET("/resources", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListResources)
		api.POST("/resources", middleware.RequireRole("admin", "devops"), handlers.CreateResource)
		api.GET("/resources/:id", middleware.RequireRole("admin", "devops", "trainee"), handlers.GetResource)
		api.PUT("/resources/:id", middleware.RequireRole("admin", "devops"), handlers.UpdateResource)
		api.DELETE("/resources/:id", middleware.RequireRole("admin"), handlers.DeleteResource)
		api.POST("/resources/:id/test", middleware.RequireRole("admin", "devops"), handlers.TestResourceConnection)
		api.GET("/resources/:id/observe", middleware.RequireRole("admin", "devops", "trainee"), handlers.ObserveResource)
		api.GET("/resources/:id/metrics", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListResourceMetrics)
		api.GET("/resources/:id/access", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListResourceAccess)
		api.POST("/resources/:id/access", middleware.RequireRole("admin", "devops"), handlers.CreateResourceAccess)
		api.PUT("/resources/:id/access/:accessId", middleware.RequireRole("admin", "devops"), handlers.UpdateResourceAccess)
		api.DELETE("/resources/:id/access/:accessId", middleware.RequireRole("admin", "devops"), handlers.DeleteResourceAccess)
		api.GET("/resources/:id/audit", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListResourceAudit)
		api.POST("/resources/:id/query", middleware.RequireRole("admin", "devops"), handlers.QueryResource)
		api.PATCH("/resources/:id/folder", middleware.RequireRole("admin", "devops"), handlers.MoveResourceFolder)
		api.GET("/resources/:id/audit/security", middleware.RequireRole("admin", "devops", "trainee"), handlers.ScanResourceSecurity)

		// ── Metrics ───────────────────────────────────────────────
		api.GET("/servers/:id/metrics", handlers.GetMetrics)
		api.GET("/servers/:id/metrics/latest", handlers.GetLatestMetric)

		// ── Networking / Services ────────────────────────────────
		api.GET("/servers/:id/networking", handlers.GetServerNetworking)
		api.GET("/servers/:id/k8s-networking", handlers.GetK8sNetworking)

		// ── Audit ─────────────────────────────────────────────────
		api.GET("/servers/:id/audit/kernel", handlers.ScanServerKernel)
		api.GET("/servers/:id/audit/hardening", handlers.ScanServerHardening)
		api.GET("/servers/:id/audit/cluster", handlers.ScanCluster)
		api.GET("/audit/summary", middleware.RequireRole("admin", "devops", "trainee"), handlers.GetSecurityScanSummary)

		// ── Logs ──────────────────────────────────────────────────
		api.GET("/servers/:id/logs", handlers.GetLogs)
		api.GET("/servers/:id/log-sources", handlers.LogSources)
		api.DELETE("/servers/:id/logs", middleware.RequireRole("admin", "devops"), handlers.ClearLogs)
		api.GET("/logs/stats", handlers.GetLogStats)

		// ── Kubectl ───────────────────────────────────────────────
		api.POST("/servers/:id/kubectl", middleware.RequireRole("admin", "devops"), handlers.RunKubectl)
		api.DELETE("/servers/:id/kubectl", middleware.RequireRole("admin", "devops"), handlers.DeleteKubectl)
		api.POST("/servers/:id/kubectl/apply", middleware.RequireRole("admin", "devops"), handlers.ApplyKubectl)
		api.POST("/servers/:id/kubectl/port-forward", middleware.RequireRole("admin", "devops"), handlers.StartPortForward)
		api.GET("/servers/:id/kubectl/port-forward", middleware.RequireRole("admin", "devops"), handlers.ListPortForwards)
		api.DELETE("/servers/:id/kubectl/port-forward/:sessionId", middleware.RequireRole("admin", "devops"), handlers.StopPortForward)
		api.POST("/servers/:id/k8s/disconnect", middleware.RequireRole("admin", "devops"), handlers.DisconnectCluster)
		api.POST("/servers/:id/k8s/reconnect", middleware.RequireRole("admin", "devops"), handlers.ReconnectCluster)

		// ── AI ────────────────────────────────────────────────────
		api.GET("/ai/threads", middleware.RequireRole("admin", "devops"), handlers.ListThreads)
		api.POST("/ai/threads", middleware.RequireRole("admin", "devops"), handlers.CreateThread)
		api.DELETE("/ai/threads/:id", middleware.RequireRole("admin", "devops"), handlers.DeleteThread)
		api.POST("/ai/chat", middleware.RequireRole("admin", "devops"), handlers.AIChat)
		api.GET("/ai/history/:id", middleware.RequireRole("admin", "devops"), handlers.GetChatHistory)
		api.DELETE("/ai/history", middleware.RequireRole("admin", "devops"), handlers.ClearChatHistory)

		// ── MCP (Kubernetes Model Context Protocol) ───────────────
		api.GET("/mcp/status", middleware.RequireRole("admin", "devops"), handlers.MCPServerStatus)
		api.GET("/mcp/tools", middleware.RequireRole("admin", "devops"), handlers.ListMCPTools)
		api.POST("/mcp/tool", middleware.RequireRole("admin", "devops"), handlers.ExecuteMCPTool)
		api.POST("/mcp/kubectl", middleware.RequireRole("admin", "devops"), handlers.RunKubectlViaMCP)

		// ── Agent (multi-turn, human-approved DevOps automation) ──
		api.POST("/agent/runs", middleware.RequireRole("admin", "devops"), handlers.CreateAgentRun)
		api.GET("/agent/runs", middleware.RequireRole("admin", "devops"), handlers.ListAgentRuns)
		api.GET("/agent/runs/:id", middleware.RequireRole("admin", "devops"), handlers.GetAgentRun)
		api.POST("/agent/runs/:id/steps/:stepId/approve", middleware.RequireRole("admin", "devops"), handlers.ApproveAgentStep)
		api.POST("/agent/runs/:id/steps/:stepId/reject", middleware.RequireRole("admin", "devops"), handlers.RejectAgentStep)
		api.POST("/agent/runs/:id/cancel", middleware.RequireRole("admin", "devops"), handlers.CancelAgentRun)
		api.DELETE("/agent/runs/:id", middleware.RequireRole("admin", "devops"), handlers.DeleteAgentRun)

		// ── Alert rules ───────────────────────────────────────────
		api.GET("/alert-rules", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListAlertRules)
		api.POST("/alert-rules", middleware.RequireRole("admin", "devops"), handlers.CreateAlertRule)
		api.POST("/alert-rules/batch", middleware.RequireRole("admin", "devops"), handlers.BatchUpdateAlertRules)
		api.GET("/alert-rules/:id", middleware.RequireRole("admin", "devops", "trainee"), handlers.GetAlertRule)
		api.PUT("/alert-rules/:id", middleware.RequireRole("admin", "devops"), handlers.UpdateAlertRule)
		api.DELETE("/alert-rules/:id", middleware.RequireRole("admin", "devops"), handlers.DeleteAlertRule)

		// ── Healing actions ───────────────────────────────────────
		api.GET("/healing-actions", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListHealingActions)
		api.DELETE("/healing-actions", middleware.RequireRole("admin"), handlers.ClearHealingHistory)

		// ── Notification settings (webhooks for alert rules) ──────
		api.GET("/settings/notifications", middleware.RequireRole("admin"), handlers.GetNotificationSettings)
		api.PUT("/settings/notifications", middleware.RequireRole("admin"), handlers.UpdateNotificationSettings)
		api.POST("/settings/notifications/test", middleware.RequireRole("admin"), handlers.TestNotificationWebhook)

		// ── Infrastructure-as-Code (Git) sync ──────────────────────
		api.GET("/gitsync/settings", middleware.RequireRole("admin", "devops"), handlers.GetGitSyncSettings)
		api.PUT("/gitsync/settings", middleware.RequireRole("admin"), handlers.UpdateGitSyncSettings)
		api.POST("/gitsync/test", middleware.RequireRole("admin", "devops"), handlers.TestGitSyncConnection)
		api.POST("/gitsync/sync", middleware.RequireRole("admin", "devops"), handlers.TriggerGitSync)
		api.GET("/gitsync/runs", middleware.RequireRole("admin", "devops", "trainee"), handlers.ListGitSyncRuns)
	}

	// ── Additional server management endpoints ────────────────
	api.PATCH("/servers/:id/preferences", middleware.RequireRole("admin", "devops"), handlers.UpdateServerPreferences)
	api.DELETE("/servers/:id/metrics", middleware.RequireRole("admin", "devops"), handlers.ClearServerMetrics)

	// ── WebSocket routes (auth via query param token) ──────────
	ws := r.Group("/ws")
	ws.Use(wsAuthMiddleware())
	{
		ws.GET("/servers/:id/logs", handlers.StreamLogs)
		ws.GET("/servers/:id/metrics", metricsWsHandler)
		ws.GET("/servers/:id/terminal", middleware.RequireRole("admin", "devops"), handlers.SSHTerminal)
		ws.GET("/servers/:id/kubectl/pod-terminal", middleware.RequireRole("admin", "devops"), handlers.RunPodTerminal)
		ws.GET("/servers/:id/kubectl/node-terminal", middleware.RequireRole("admin", "devops"), handlers.RunNodeTerminal)
		ws.GET("/servers/:id/k8s/watch", middleware.RequireRole("admin", "devops", "trainee", "intern"), handlers.WatchKubectl)
		ws.GET("/alerts", alertsWsHandler)
		ws.GET("/agent/runs/:id", middleware.RequireRole("admin", "devops"), handlers.AgentRunWS)
		ws.GET("/metrics/all", allMetricsWsHandler)
	}
}

// wsAuthMiddleware reads token from query param for WebSocket connections
func wsAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Query("token")
		if token == "" {
			// Also try Authorization header (for non-WS use)
			token = c.GetHeader("Authorization")
			if len(token) > 7 {
				token = token[7:] // strip "Bearer "
			}
		}
		if token == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "missing token"})
			return
		}
		c.Request.Header.Set("Authorization", "Bearer "+token)
		middleware.Auth()(c)
	}
}

// metricsWsHandler subscribes a client to the server's metrics room
func metricsWsHandler(c *gin.Context) {
	if handlers.DenyWithoutServerAccess(c) {
		return
	}
	id := c.Param("id")
	var srv models.Server
	if err := db.DB.First(&srv, id).Error; err != nil {
		c.JSON(404, gin.H{"error": "server not found"})
		return
	}
	_ = srv

	conn, err := handlers.UpgradeConn(c.Writer, c.Request)
	if err != nil {
		return
	}

	handlers.MetricsWSHandler(conn, id)
}

// alertsWsHandler subscribes a client to the global alerts room
func alertsWsHandler(c *gin.Context) {
	conn, err := handlers.UpgradeConn(c.Writer, c.Request)
	if err != nil {
		return
	}
	client := wshub.GlobalHub.Register(conn, "alerts")
	client.ReadPump(wshub.GlobalHub, nil)
}

func allMetricsWsHandler(c *gin.Context) {
	conn, err := handlers.UpgradeConn(c.Writer, c.Request)
	if err != nil {
		return
	}
	handlers.AllMetricsWSHandler(conn)
}
