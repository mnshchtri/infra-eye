// Package appdata resolves an OS-appropriate local data directory for the
// desktop build (SQLite DB file, persisted JWT secret, MCP kubeconfig).
// Not used by cmd/server, which is configured entirely via env vars/.env.
package appdata

import (
	"os"
	"path/filepath"
)

// Dir returns the InfraEye desktop app-data directory, creating it (0700) if
// it doesn't already exist. On macOS: ~/Library/Application Support/InfraEye.
// On Windows: %AppData%\InfraEye. On Linux: $XDG_CONFIG_HOME or ~/.config/InfraEye.
func Dir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "InfraEye")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}
