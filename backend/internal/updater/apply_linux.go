//go:build linux

package updater

import (
	"fmt"
	"os/exec"
	"strings"
)

// Apply downloads the .deb at downloadURL and installs it via pkexec, which
// shows the desktop's native polkit authentication dialog — there's no way
// to install a system package without root, and this is the standard
// GUI-friendly way to ask for it on Linux. Returns the installed binary's
// path for the caller to relaunch.
func Apply(downloadURL string) (relaunchPath string, err error) {
	if _, err := exec.LookPath("pkexec"); err != nil {
		return "", fmt.Errorf("pkexec not found (needs polkit) — download and install manually instead: %s", downloadURL)
	}

	debPath, cleanup, err := download(downloadURL, "infraeye-update-*.deb")
	if err != nil {
		return "", err
	}
	defer cleanup()

	install := exec.Command("pkexec", "dpkg", "-i", debPath)
	if out, err := install.CombinedOutput(); err != nil {
		return "", fmt.Errorf("dpkg install failed: %v: %s", err, strings.TrimSpace(string(out)))
	}

	// The .deb always installs to this fixed path (see the CI packaging
	// step / Makefile's desktop-package target) — no need to guess.
	return "/usr/bin/infraeye-desktop", nil
}
