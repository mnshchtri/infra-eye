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
	"github.com/infra-eye/backend/internal/httpapi"
	"github.com/infra-eye/backend/internal/mcp"
	"github.com/infra-eye/backend/internal/metrics"
	"github.com/infra-eye/backend/internal/resources"
	"github.com/infra-eye/backend/internal/seed"
)

func main() {
	// Load config
	config.Load()

	// Connect DB & migrate
	db.Connect()

	// Initialize OIDC if enabled
	if config.C.OIDCEnabled {
		if err := handlers.InitOIDC(); err != nil {
			log.Fatalf("Failed to initialize OIDC: %v", err)
		}
	}

	// MCP Master Config Sync
	mcp.SyncMasterKubeconfig()

	// Seed default data
	seed.Run()

	// Re-sync after seeding ensures any default clusters are patched
	mcp.SyncMasterKubeconfig()

	// Start metrics collection for existing servers
	go metrics.StartAllExisting()

	// Start self-healing engine
	healing.StartEngine()

	// Start resource observability collector (polls DBs/caches/brokers)
	resources.StartCollector()

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

	httpapi.RegisterRoutes(r)

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
