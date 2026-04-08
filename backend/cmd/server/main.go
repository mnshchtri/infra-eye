package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/handlers"
	"github.com/infra-eye/backend/internal/healing"
	"github.com/infra-eye/backend/internal/mcp"
	"github.com/infra-eye/backend/internal/metrics"
	"github.com/infra-eye/backend/internal/middleware"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/seed"
	wshub "github.com/infra-eye/backend/internal/ws"
)

func main() {
	// Load config
	config.Load()

	// Connect DB & migrate
	db.Connect()

	// MCP Master Config Sync
	mcp.SyncMasterKubeconfig()

	// Seed default data
	seed.Run()

	// Re-sync after seeding ensures any default clusters are patched
	mcp.SyncMasterKubeconfig()

	// Start metrics collection for existing servers
	go startMetricsForExistingServers()

	// Start self-healing engine
	healing.StartEngine()

	// Setup Gin
	if config.C.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()

	// CORS — allow frontend dev server
	r.Use(cors.New(cors.Config{
		AllowOriginFunc:  func(origin string) bool { return true },
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// ── Public routes ──────────────────────────────────────────
	r.POST("/api/auth/login", handlers.Login)
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "version": "1.0.0", "time": time.Now()})
	})

	// ── Protected routes ───────────────────────────────────────
	api := r.Group("/api", middleware.Auth())
	{
		// Auth
		api.GET("/auth/me", handlers.GetMe)
		api.PUT("/auth/me", handlers.UpdateProfile)

		// ── User Management (admin only) ──────────────────────────
		api.GET("/users", middleware.RequireRole("admin"), handlers.ListUsers)
		api.POST("/users", middleware.RequireRole("admin"), handlers.CreateUser)
		api.PUT("/users/:id", middleware.RequireRole("admin"), handlers.UpdateUser)
		api.DELETE("/users/:id", middleware.RequireRole("admin"), handlers.DeleteUser)

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

		// ── Metrics ───────────────────────────────────────────────
		api.GET("/servers/:id/metrics", handlers.GetMetrics)
		api.GET("/servers/:id/metrics/latest", handlers.GetLatestMetric)

		// ── Logs ──────────────────────────────────────────────────
		api.GET("/servers/:id/logs", handlers.GetLogs)
		api.DELETE("/servers/:id/logs", middleware.RequireRole("admin", "devops"), handlers.ClearLogs)

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
		ws.GET("/servers/:id/k8s/watch", middleware.RequireRole("admin", "devops", "trainee", "intern"), handlers.WatchKubectl)
		ws.GET("/alerts", alertsWsHandler)
		ws.GET("/metrics/all", allMetricsWsHandler)
	}

	// ── Static Frontend ────────────────────────────────────────
	// Serve static files from the build directory
	r.Static("/assets", "/usr/share/nginx/html/assets")
	r.StaticFile("/favicon.ico", "/usr/share/nginx/html/favicon.ico")
	r.StaticFile("/robots.txt", "/usr/share/nginx/html/robots.txt")

	// NoRoute serves index.html for SPA (React Router) support
	r.NoRoute(func(c *gin.Context) {
		c.File("/usr/share/nginx/html/index.html")
	})

	addr := fmt.Sprintf(":%s", config.C.Port)
	log.Printf("🚀 InfraEye API running on http://localhost%s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Server failed: %v", err)
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

func startMetricsForExistingServers() {
	var servers []models.Server
	db.DB.Find(&servers)
	for _, srv := range servers {
		go metrics.StartCollector(srv)
	}
	log.Printf("✅ Started metrics collection for %d existing servers", len(servers))
}
