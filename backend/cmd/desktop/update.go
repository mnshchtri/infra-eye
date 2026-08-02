package main

import (
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/updater"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// appVersion is set at build time via -ldflags "-X main.appVersion=X.Y.Z"
// (see the Makefile's desktop-build target and
// .github/workflows/desktop-release.yml) — there's no other way for a
// compiled Go binary to know its own release version. Left as "dev" for
// plain `go run`/local builds, which disables update checks entirely (see
// registerUpdateRoutes).
var appVersion = "dev"

// registerUpdateRoutes wires the desktop-only self-update check/apply
// endpoints onto the same Gin engine as the rest of the API. Never called
// from cmd/server — a shared multi-user server has no business
// self-replacing its own binary from inside itself.
func (a *App) registerUpdateRoutes(r *gin.Engine) {
	grp := r.Group("/api/desktop/update")

	grp.GET("/check", func(c *gin.Context) {
		if appVersion == "dev" {
			c.JSON(http.StatusOK, updater.CheckResult{CurrentVersion: appVersion, Error: "update checks are disabled for local/dev builds"})
			return
		}
		c.JSON(http.StatusOK, updater.Check(appVersion))
	})

	grp.POST("/apply", func(c *gin.Context) {
		var req struct {
			DownloadURL string `json:"download_url" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		relaunchPath, err := updater.Apply(req.DownloadURL)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"success": true})

		// Relaunch and quit after the response above has had a chance to
		// reach the frontend — a plain return here would race the HTTP
		// response against the process exiting.
		go func() {
			time.Sleep(500 * time.Millisecond)

			if relaunchPath != "" {
				var cmd *exec.Cmd
				if runtime.GOOS == "darwin" {
					cmd = exec.Command("open", "-n", relaunchPath)
				} else {
					cmd = exec.Command(relaunchPath)
				}
				if err := cmd.Start(); err != nil {
					log.Printf("⚠️  update: failed to relaunch at %s: %v", relaunchPath, err)
				}
			}

			wailsruntime.Quit(a.ctx)
		}()
	})
}
