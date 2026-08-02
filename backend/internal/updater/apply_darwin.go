//go:build darwin

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Apply downloads the .dmg at downloadURL, mounts it, and swaps the
// currently-running app bundle for the new one. A running process keeps its
// executable mapped in memory even after the file underneath it is
// replaced, so this is safe to do without quitting first — the caller
// relaunches (spawn the new app, then quit this process) once Apply
// returns. Returns the app bundle path to relaunch.
func Apply(downloadURL string) (relaunchPath string, err error) {
	appPath, err := currentAppBundle()
	if err != nil {
		return "", err
	}

	dmgPath, cleanup, err := download(downloadURL, "infraeye-update-*.dmg")
	if err != nil {
		return "", err
	}
	defer cleanup()

	mountPoint, err := os.MkdirTemp("", "infraeye-update-mount-*")
	if err != nil {
		return "", fmt.Errorf("create mount point: %w", err)
	}
	defer os.RemoveAll(mountPoint)

	attach := exec.Command("hdiutil", "attach", dmgPath, "-nobrowse", "-mountpoint", mountPoint)
	if out, err := attach.CombinedOutput(); err != nil {
		return "", fmt.Errorf("mount update image: %v: %s", err, strings.TrimSpace(string(out)))
	}
	defer exec.Command("hdiutil", "detach", mountPoint, "-quiet").Run()

	newApp := filepath.Join(mountPoint, "InfraEye.app")
	if _, err := os.Stat(newApp); err != nil {
		return "", fmt.Errorf("update image doesn't contain InfraEye.app: %w", err)
	}

	// Move the old bundle aside rather than deleting it outright, so a
	// failed copy below can be rolled back instead of leaving no app at all.
	backupPath := appPath + ".update-backup"
	os.RemoveAll(backupPath)
	if err := os.Rename(appPath, backupPath); err != nil {
		return "", fmt.Errorf("move aside old app bundle (permissions?): %w", err)
	}

	if out, err := exec.Command("cp", "-R", newApp, appPath).CombinedOutput(); err != nil {
		os.RemoveAll(appPath)
		os.Rename(backupPath, appPath) // best-effort rollback
		return "", fmt.Errorf("copy new app bundle into place: %v: %s", err, strings.TrimSpace(string(out)))
	}
	os.RemoveAll(backupPath)

	return appPath, nil
}

// currentAppBundle derives .../InfraEye.app from the running executable's
// path (.../InfraEye.app/Contents/MacOS/infraeye-desktop).
func currentAppBundle() (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	idx := strings.Index(exePath, ".app/")
	if idx == -1 {
		return "", fmt.Errorf("not running from an .app bundle (got %s) — self-update only works for the packaged app", exePath)
	}
	return exePath[:idx+4], nil
}
