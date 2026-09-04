// Package updater implements self-update for the desktop build only:
// checking GitHub Releases for a newer desktop-v* tag and, on request,
// downloading and installing it. cmd/server (the Docker/Kubernetes
// deployment) never imports this package — a shared multi-user server has
// no business self-replacing its own binary from inside itself; redeploys
// handle that there.
//
// Apply() is platform-specific (see apply_darwin.go / apply_linux.go /
// apply_windows.go) since each OS has a completely different install
// location and privilege model for a packaged desktop app.
package updater

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const releasesAPI = "https://api.github.com/repos/mnshchtri/infra-eye/releases"

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type ghRelease struct {
	TagName string    `json:"tag_name"`
	HTMLURL string    `json:"html_url"`
	Assets  []ghAsset `json:"assets"`
}

// CheckResult is returned to the frontend as-is.
type CheckResult struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version,omitempty"`
	Available      bool   `json:"available"`
	DownloadURL    string `json:"download_url,omitempty"`
	ReleaseURL     string `json:"release_url,omitempty"`
	Error          string `json:"error,omitempty"`
}

// assetNameFor returns the release asset filename for this OS/arch, matching
// the artifact_name values in .github/workflows/desktop-release.yml.
func assetNameFor() (string, error) {
	switch runtime.GOOS {
	case "darwin":
		if runtime.GOARCH != "arm64" {
			return "", fmt.Errorf("no published build for macOS %s (only Apple Silicon is published)", runtime.GOARCH)
		}
		return "InfraEye-macOS-arm64.dmg", nil
	case "linux":
		if _, err := exec.LookPath("pacman"); err == nil {
			return "InfraEye-Linux.pkg.tar.zst", nil
		}
		return "InfraEye-Linux.deb", nil
	case "windows":
		return "InfraEye-Windows-amd64.exe", nil
	default:
		return "", fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// Check compares currentVersion against the latest published desktop-v* tag
// and, if newer, resolves the download URL for this platform's asset.
func Check(currentVersion string) CheckResult {
	result := CheckResult{CurrentVersion: currentVersion}

	assetName, err := assetNameFor()
	if err != nil {
		result.Error = err.Error()
		return result
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, releasesAPI, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := client.Do(req)
	if err != nil {
		result.Error = "couldn't reach GitHub: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		result.Error = fmt.Sprintf("GitHub API returned %d", resp.StatusCode)
		return result
	}

	var releases []ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		result.Error = "couldn't parse GitHub response: " + err.Error()
		return result
	}

	var best *ghRelease
	var bestVersion string
	for i := range releases {
		v := strings.TrimPrefix(releases[i].TagName, "desktop-v")
		if v == releases[i].TagName {
			continue // not a desktop-v* tag
		}
		if best == nil || compareSemver(v, bestVersion) > 0 {
			best = &releases[i]
			bestVersion = v
		}
	}

	if best == nil {
		result.Error = "no desktop releases found"
		return result
	}

	result.LatestVersion = bestVersion
	result.ReleaseURL = best.HTMLURL

	for _, a := range best.Assets {
		if a.Name == assetName {
			result.DownloadURL = a.BrowserDownloadURL
			break
		}
	}
	if result.DownloadURL == "" {
		result.Error = fmt.Sprintf("release desktop-v%s has no %s asset yet", bestVersion, assetName)
		return result
	}

	result.Available = compareSemver(bestVersion, currentVersion) > 0
	return result
}

// compareSemver compares two "X.Y.Z" version strings. Returns >0 if a>b, <0
// if a<b, 0 if equal. Not a full semver implementation (no pre-release/build
// metadata) — desktop-v* tags are always plain X.Y.Z.
func compareSemver(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		na, nb := 0, 0
		if i < len(pa) {
			na, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			nb, _ = strconv.Atoi(pb[i])
		}
		if na != nb {
			return na - nb
		}
	}
	return 0
}

// validateAssetURL rejects anything that isn't an https URL on a GitHub
// release-asset host. DownloadURL originates from the GitHub Releases API
// response, so this is defense-in-depth against that API (or a compromised
// path to it) ever pointing us at an internal/arbitrary address.
func validateAssetURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid download URL: %w", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("download URL must use https")
	}
	host := strings.ToLower(u.Hostname())
	if host != "github.com" && host != "api.github.com" && !strings.HasSuffix(host, ".githubusercontent.com") {
		return fmt.Errorf("download URL host %q is not a recognized GitHub release host", host)
	}
	return nil
}

// download fetches rawURL into a fresh temp file matching pattern (see
// os.CreateTemp) and returns its path plus a cleanup func that removes it.
// Callers that want to keep the file (e.g. a Windows installer that's about
// to be launched) can simply not call cleanup.
func download(rawURL, pattern string) (path string, cleanup func(), err error) {
	if err := validateAssetURL(rawURL); err != nil {
		return "", nil, err
	}

	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", nil, fmt.Errorf("create temp file: %w", err)
	}
	cleanup = func() { os.Remove(f.Name()) }

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(rawURL)
	if err != nil {
		f.Close()
		cleanup()
		return "", nil, fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		f.Close()
		cleanup()
		return "", nil, fmt.Errorf("download returned HTTP %d", resp.StatusCode)
	}

	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		cleanup()
		return "", nil, fmt.Errorf("write download: %w", err)
	}
	if err := f.Close(); err != nil {
		cleanup()
		return "", nil, err
	}
	return f.Name(), cleanup, nil
}
