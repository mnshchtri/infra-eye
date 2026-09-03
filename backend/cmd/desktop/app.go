package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/appdata"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/gitsync"
	"github.com/infra-eye/backend/internal/handlers"
	"github.com/infra-eye/backend/internal/healing"
	"github.com/infra-eye/backend/internal/httpapi"
	"github.com/infra-eye/backend/internal/mcp"
	"github.com/infra-eye/backend/internal/metrics"
	"github.com/infra-eye/backend/internal/resources"
	"github.com/infra-eye/backend/internal/seed"
	sshclient "github.com/infra-eye/backend/internal/ssh"
)

// backendPort is fixed for v1 (baked into the frontend build via VITE_API_URL
// at compile time — see Makefile's desktop-build target). Chosen to avoid
// colliding with the 8080 default used by the Docker/dev backend.
const backendPort = "8073"

// App holds the desktop app's runtime state across Wails lifecycle hooks.
type App struct {
	ctx        context.Context
	httpServer *http.Server
	mcpCmd     *exec.Cmd
}

func NewApp() *App {
	return &App{}
}

// OnStartup replicates cmd/server/main.go's init sequence, but with local
// app-data paths instead of Docker/.env-provided config, and a real
// *http.Server (rather than r.Run) so it can be shut down cleanly.
func (a *App) OnStartup(ctx context.Context) {
	a.ctx = ctx

	appDir, err := appdata.Dir()
	if err != nil {
		log.Fatalf("failed to resolve app-data directory: %v", err)
	}

	// internal/ssh's default known_hosts path guess (Docker vs. repo
	// checkout) doesn't apply to a packaged app with an unpredictable
	// working directory — point it at the same per-OS app-data dir as the DB.
	sshclient.SetKnownHostsPath(filepath.Join(appDir, "ssh_known_hosts"))

	// These must be set before config.Load() reads them.
	os.Setenv("DB_DRIVER", "sqlite")
	os.Setenv("DB_DSN", "file:"+filepath.Join(appDir, "infraeye.db")+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	os.Setenv("JWT_SECRET", loadOrCreateJWTSecret(appDir))
	os.Setenv("PORT", backendPort)

	config.Load()
	db.Connect()

	if config.C.OIDCEnabled {
		if err := handlers.InitOIDC(); err != nil {
			// Non-fatal here (unlike cmd/server): a desktop app shouldn't hard-crash
			// on OIDC misconfiguration, since OIDC is opt-in and off by default.
			log.Printf("⚠️  OIDC init failed, continuing without it: %v", err)
		}
	}

	mcpDir := filepath.Join(appDir, "mcp")
	if err := os.MkdirAll(mcpDir, 0700); err != nil {
		log.Fatalf("failed to create MCP config directory: %v", err)
	}
	kubeconfigPath := filepath.Join(mcpDir, "kubeconfig")
	mcp.SetMasterConfigPath(kubeconfigPath)
	mcp.SyncMasterKubeconfig()

	seed.Run()
	mcp.SyncMasterKubeconfig()

	go metrics.StartAllExisting()
	healing.StartEngine()
	resources.StartCollector()

	gitsync.SetWorkDir(filepath.Join(appDir, "gitsync", "repo"))
	gitsync.StartEngine()
	handlers.StartWSSessionSweeper()

	a.mcpCmd = startMCPSidecar(kubeconfigPath, appDir)

	if config.C.Env == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()
	r.Use(cors.New(cors.Config{
		AllowOriginFunc:  func(origin string) bool { return true },
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	httpapi.RegisterRoutes(r)
	a.registerUpdateRoutes(r)
	registerStaticAssets(r)

	a.httpServer = &http.Server{Addr: "127.0.0.1:" + backendPort, Handler: r}
	go func() {
		log.Printf("🚀 InfraEye desktop backend running on http://127.0.0.1:%s", backendPort)
		if err := a.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("backend server error: %v", err)
		}
	}()
}

// OnShutdown stops every background goroutine and child process before the
// window closes, so nothing keeps writing to the DB file after it's closed.
func (a *App) OnShutdown(ctx context.Context) {
	healing.StopEngine()
	resources.StopCollector()
	metrics.StopAll()
	gitsync.StopEngine()

	if a.httpServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = a.httpServer.Shutdown(shutdownCtx)
	}

	stopMCPSidecar(a.mcpCmd)

	if db.DB != nil {
		if sqlDB, err := db.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
	}
}

// loadOrCreateJWTSecret persists a random JWT signing secret under appDir so
// sessions survive restarts, replacing config.go's insecure hardcoded
// default (which is left untouched for the Docker/dev deployment path).
func loadOrCreateJWTSecret(appDir string) string {
	path := filepath.Join(appDir, "jwt.secret")
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		return string(data)
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("failed to generate JWT secret: %v", err)
	}
	secret := base64.StdEncoding.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(secret), 0600); err != nil {
		log.Fatalf("failed to persist JWT secret: %v", err)
	}
	return secret
}
