//go:build linux

package updater

import (
	"fmt"
	"os/exec"
	"strings"
)

// Apply downloads the release asset at downloadURL and installs it via
// pkexec, which shows the desktop's native polkit authentication dialog —
// there's no way to install a system package without root, and this is the
// standard GUI-friendly way to ask for it on Linux. The asset is either a
// .deb (dpkg-based distros) or a .pkg.tar.zst (pacman-based distros, e.g.
// Arch/Omarchy) — see assetNameFor, which already picked the one matching
// this machine, so the extension alone tells us which installer to run.
// Returns the installed binary's path for the caller to relaunch.
func Apply(downloadURL string) (relaunchPath string, err error) {
	if _, err := exec.LookPath("pkexec"); err != nil {
		return "", fmt.Errorf("pkexec not found (needs polkit) — download and install manually instead: %s", downloadURL)
	}

	var pattern, pkgManager string
	var installArgs []string
	if strings.HasSuffix(downloadURL, ".pkg.tar.zst") {
		pattern, pkgManager = "infraeye-update-*.pkg.tar.zst", "pacman"
	} else {
		pattern, pkgManager = "infraeye-update-*.deb", "dpkg"
	}

	pkgPath, cleanup, err := download(downloadURL, pattern)
	if err != nil {
		return "", err
	}
	defer cleanup()

	if pkgManager == "pacman" {
		installArgs = []string{"pacman", "-U", "--noconfirm", pkgPath}
	} else {
		installArgs = []string{"dpkg", "-i", pkgPath}
	}

	install := exec.Command("pkexec", installArgs...)
	if out, err := install.CombinedOutput(); err != nil {
		return "", fmt.Errorf("%s install failed: %v: %s", pkgManager, err, strings.TrimSpace(string(out)))
	}

	// Both package formats install to this fixed path (see the CI packaging
	// step / Makefile's desktop-package target) — no need to guess.
	return "/usr/bin/infraeye-desktop", nil
}
