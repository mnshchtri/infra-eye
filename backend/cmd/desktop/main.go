package main

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

// frontenddist is a build-time copy of frontend/dist (see the Makefile's
// desktop-build target). go:embed can't reach outside this package's
// directory, so the real frontend source under ../../../frontend can't be
// embedded directly — it has to be copied here first.
//
//go:embed all:frontenddist
var assets embed.FS

// registerStaticAssets makes the desktop backend's own Gin server able to
// serve the SPA standalone at http://127.0.0.1:8073, in addition to the
// native Wails window — useful for support/debugging in a plain browser.
func registerStaticAssets(r *gin.Engine) {
	sub, err := fs.Sub(assets, "frontenddist")
	if err != nil {
		return
	}
	httpFS := http.FS(sub)
	fileServer := http.FileServer(httpFS)

	r.NoRoute(func(c *gin.Context) {
		if _, err := sub.Open(c.Request.URL.Path[1:]); err != nil {
			// Not a real static file — fall back to index.html for SPA routing.
			c.FileFromFS("/", httpFS)
			return
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "InfraEye",
		Width:  1400,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 15, G: 18, B: 25, A: 1},
		OnStartup:        app.OnStartup,
		OnShutdown:       app.OnShutdown,
		// Mac must be non-nil for the native green zoom/maximize button to be
		// enabled at all — Wails' darwin window code disables that button
		// whenever frontendOptions.Mac is nil, since DisableZoom then reads as
		// its Go zero value (false) *without* the "zoomable" flag it drives
		// ever being set true. See wailsapp/wails window.go / WailsContext.m.
		Mac: &mac.Options{},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
