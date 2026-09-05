package audit

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/infra-eye/backend/internal/db"
)

// Tool identifies one external scanner InfraEye can shell out to. None of
// these are bundled — InfraEye is an orchestrator, not a scanner vendor — so
// every audit feature here follows the same "detect on PATH, else explain
// exactly what to install" pattern as kubectl (handlers/kubectl.go) and nmap
// (handlers/topology.go), rather than silently degrading or faking a result.
type Tool struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Purpose       string `json:"purpose"`
	InstallHint   string `json:"install_hint"`
	Available     bool   `json:"available"`
	Path          string `json:"path,omitempty"`
	CustomPath    string `json:"custom_path,omitempty"` // the saved override, if any, whether or not it currently resolves
	UsingOverride bool   `json:"using_override"`
}

// toolPathSettingKey is where an admin-set override for one tool's binary
// path is persisted (same db.Setting store gitsync's repo URL/PAT use) —
// InfraEye runs on very different machines (Linux service, bare macOS,
// inside a container) and these scanners have no one true install
// location, especially CodeQL, which is usually just unzipped somewhere by
// hand rather than installed via a package manager. Detection makes a best
// effort; this override always wins when set, so it never has to be right.
func toolPathSettingKey(id string) string { return "audit.tool_path." + id }

// GetToolPathOverride returns the saved custom path for a tool, if any.
func GetToolPathOverride(id string) string {
	return db.GetSetting(toolPathSettingKey(id))
}

// SetToolPathOverride saves (or, given "", clears) a custom path for a
// tool. The path is validated to exist and be executable before saving —
// a typo here should fail loudly at save time, not silently at scan time.
func SetToolPathOverride(id, path string) error {
	if path != "" {
		st, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("path does not exist: %w", err)
		}
		if st.IsDir() {
			return fmt.Errorf("path is a directory, not an executable")
		}
		if st.Mode()&0111 == 0 {
			return fmt.Errorf("path is not executable")
		}
	}
	return db.SetSetting(toolPathSettingKey(id), path)
}

// extraPathDirs widens exec.LookPath's search the same way sshclient.PosixCommand
// widens a remote SSH session's PATH — these scanners are commonly installed
// via Homebrew/apt/pipx/npm-global/cargo in locations a bare service-manager
// PATH omits, on either macOS or Linux (InfraEye's backend runs on both).
var extraPathDirs = []string{
	"/opt/homebrew/bin", "/opt/homebrew/sbin", // macOS (Apple Silicon Homebrew)
	"/usr/local/bin", "/usr/local/sbin", // macOS (Intel Homebrew) & common Linux
	"/opt/local/bin",   // MacPorts
	"/snap/bin",        // Linux snap packages
	"/usr/bin", "/bin", // in case PATH itself is unusually bare
	os.Getenv("HOME") + "/.local/bin", // pipx, pip --user
	os.Getenv("HOME") + "/go/bin",     // go install
	os.Getenv("HOME") + "/.cargo/bin", // cargo install
}

// toolSpecificCandidates covers tools with no package-manager convention at
// all. CodeQL in particular ships as a zip the CLI bundle README says to
// extract "wherever you like" and add to PATH yourself — most people don't,
// so these are the layouts GitHub's own docs and the most common
// tutorials produce.
var toolSpecificCandidates = map[string][]string{
	"codeql": {
		os.Getenv("HOME") + "/codeql-home/codeql/codeql",
		os.Getenv("HOME") + "/codeql/codeql/codeql",
		os.Getenv("HOME") + "/codeql/codeql",
		os.Getenv("HOME") + "/.codeql/codeql/codeql",
		"/opt/codeql/codeql/codeql",
		"/opt/codeql/codeql",
		"/usr/local/codeql/codeql/codeql",
		"/usr/local/codeql/codeql",
		"/usr/local/lib/codeql/codeql",
	},
}

// findTool resolves one tool's binary: a saved manual override always wins
// (and is reported even if it no longer resolves, so the UI can show
// exactly what's misconfigured); otherwise PATH, then the generic extra
// directories, then any tool-specific known layouts.
func findTool(id, bin string) (path string, available bool, customPath string, usingOverride bool) {
	if override := GetToolPathOverride(id); override != "" {
		if st, err := os.Stat(override); err == nil && !st.IsDir() && st.Mode()&0111 != 0 {
			return override, true, override, true
		}
		return "", false, override, true
	}
	if p, err := exec.LookPath(bin); err == nil {
		return p, true, "", false
	}
	for _, dir := range extraPathDirs {
		p := dir + "/" + bin
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0111 != 0 {
			return p, true, "", false
		}
	}
	for _, p := range toolSpecificCandidates[id] {
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0111 != 0 {
			return p, true, "", false
		}
	}
	return "", false, "", false
}

func tool(id, bin, name, purpose, installHint string) Tool {
	path, ok, customPath, usingOverride := findTool(id, bin)
	return Tool{
		ID: id, Name: name, Purpose: purpose, InstallHint: installHint,
		Available: ok, Path: path, CustomPath: customPath, UsingOverride: usingOverride,
	}
}

// CodeScanTools reports availability of every scanner the code-security
// audit (SAST/secrets/SCA/IaC + CodeQL) can use. The caller decides which of
// the available ones to actually run per request — nothing here is required.
func CodeScanTools() []Tool {
	return []Tool{
		tool("gitleaks", "gitleaks", "Gitleaks", "Hardcoded secrets & credentials in source",
			"brew install gitleaks  (or: go install github.com/gitleaks/gitleaks/v8@latest)"),
		tool("semgrep", "semgrep", "Semgrep", "Static analysis (SAST) across most languages",
			"brew install semgrep  (or: pipx install semgrep)"),
		tool("trivy", "trivy", "Trivy", "Dependency vulnerabilities (SCA), IaC misconfig, embedded secrets",
			"brew install trivy  (or: see https://aquasecurity.github.io/trivy/latest/getting-started/installation/)"),
		tool("codeql", "codeql", "CodeQL", "GitHub's semantic SAST engine (JS/TS, Python, Ruby, Go — no separate build step)",
			"Download the CodeQL CLI bundle from https://github.com/github/codeql-action/releases, unzip it anywhere, and either add it to PATH or set a custom path below"),
	}
}

// ToolByID looks up one code-scan tool's current status by ID, for the
// path-override endpoint's response after a save.
func ToolByID(id string) (Tool, bool) {
	for _, t := range CodeScanTools() {
		if t.ID == id {
			return t, true
		}
	}
	if id == "docker" {
		path, ok, customPath, usingOverride := findTool("docker", "docker")
		return Tool{
			ID: "docker", Name: "Docker", Purpose: "Runs OWASP ZAP on demand for DAST scans",
			InstallHint: "https://docs.docker.com/get-docker/",
			Available:   ok, Path: path, CustomPath: customPath, UsingOverride: usingOverride,
		}, true
	}
	return Tool{}, false
}

// DastEnvironment reports what InfraEye can use to run OWASP ZAP against a
// target URL: an external ZAP daemon it's configured to talk to (fastest,
// no local container spin-up), or a local Docker install to run one of
// ZAP's official scan images on demand.
type DastEnvironment struct {
	ZAPAPIConfigured bool   `json:"zap_api_configured"`
	ZAPAPIURL        string `json:"zap_api_url,omitempty"`
	Docker           Tool   `json:"docker"`
	Ready            bool   `json:"ready"`
}

func GetDastEnvironment() DastEnvironment {
	zapURL := os.Getenv("ZAP_API_URL")
	docker, _ := ToolByID("docker")
	return DastEnvironment{
		ZAPAPIConfigured: zapURL != "",
		ZAPAPIURL:        zapURL,
		Docker:           docker,
		Ready:            zapURL != "" || docker.Available,
	}
}
