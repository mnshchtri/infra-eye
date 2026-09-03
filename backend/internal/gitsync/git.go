package gitsync

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

var (
	// WorkDir is where the mirrored repo is cloned. Defaults to the Docker
	// shared-volume path but can be overridden — mirrors mcp.MasterConfigPath's
	// pattern, including the same reason for SetWorkDir(): this package's
	// init() resolves the default before any caller's main()/OnStartup code
	// runs, so an env var alone can't be overridden at runtime by cmd/desktop.
	WorkDir = "/shared_gitsync/repo"
)

func init() {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return // Docker default above is correct
	}
	if path := os.Getenv("GITSYNC_WORKDIR"); path != "" {
		WorkDir = path
		return
	}
	// Not in Docker: use a project-relative path, same upward-walk trick as
	// mcp/config_manager.go, so the working copy lands in ./shared_gitsync/.
	cwd, _ := os.Getwd()
	for cwd != "/" {
		if _, err := os.Stat(filepath.Join(cwd, "backend", "go.mod")); err == nil {
			WorkDir = filepath.Join(cwd, "shared_gitsync", "repo")
			return
		}
		if _, err := os.Stat(filepath.Join(cwd, "go.mod")); err == nil {
			WorkDir = filepath.Join(cwd, "..", "shared_gitsync", "repo")
			return
		}
		cwd = filepath.Dir(cwd)
	}
}

// SetWorkDir overrides WorkDir at runtime. Needed by cmd/desktop for the same
// reason mcp.SetMasterConfigPath exists: this package's init() runs before
// OnStartup, so it must be called explicitly before any sync.
func SetWorkDir(path string) {
	WorkDir = path
}

var branchPattern = regexp.MustCompile(`^[A-Za-z0-9._/-]+$`)

func validateBranch(branch string) error {
	if branch == "" || !branchPattern.MatchString(branch) || branch[0] == '-' {
		return fmt.Errorf("invalid branch name %q", branch)
	}
	return nil
}

// validateRepoURL rejects anything that isn't a well-formed http(s)/ssh/git
// URL. In particular this blocks a URL starting with "-", which would
// otherwise be passed as a positional exec.Command argument and could be
// interpreted by git as a flag (e.g. "--upload-pack=...") — argument
// injection rather than shell injection, but exec.Command's lack of a shell
// doesn't protect against it on its own.
func validateRepoURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid repo URL: %w", err)
	}
	switch u.Scheme {
	case "http", "https", "ssh", "git":
	default:
		return fmt.Errorf("unsupported repo URL scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("repo URL is missing a host")
	}
	return nil
}

// authenticatedURL splices a PAT into the URL in-memory only, immediately
// before exec — never stored or logged in this form. The working directory's
// .git/config will contain it (normal git HTTPS-credential behavior), which
// is why WorkDir always lives in a non-served, 0700 app-data-style location.
func authenticatedURL(rawURL, pat string) (string, error) {
	if err := validateRepoURL(rawURL); err != nil {
		return "", err
	}
	if pat == "" {
		return rawURL, nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	u.User = url.UserPassword("x-access-token", pat)
	return u.String(), nil
}

// credInURL matches the "user:password@" userinfo of a URL; credUserOnlyInURL
// matches the "token@" form some providers accept. Both are applied to every
// string that leaves this package.
var (
	credInURL         = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://)([^/@\s:]*):([^/@\s]*)@`)
	credUserOnlyInURL = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://)([^/@\s:]+)@`)
)

// RedactCredentials strips the secret half of any URL userinfo it finds.
// authenticatedURL splices the PAT into the remote URL, so that URL reaches
// git's argv and, on failure, git's own output — both of which end up in error
// strings this app shows to devops (via /api/gitsync/test) and trainees (via
// GitSyncRun.ErrorText). Only the password is replaced, so the host, path,
// username, and git's verbatim message all survive for diagnosis, per
// docs/DESIGN_PRINCIPLES.md.
func RedactCredentials(s string) string {
	s = credInURL.ReplaceAllString(s, "${1}${2}:***@")
	return credUserOnlyInURL.ReplaceAllString(s, "${1}***@")
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		// Both the args (which carry the authenticated remote URL) and git's own
		// output must be redacted — git echoes the remote back in several of its
		// failure messages.
		return RedactCredentials(string(out)),
			fmt.Errorf("git %v: %w: %s", RedactCredentials(fmt.Sprint(args)), err, RedactCredentials(string(out)))
	}
	return string(out), nil
}

// cloneOrPull ensures WorkDir contains an up-to-date checkout of branch,
// cloning if absent or fetch+reset --hard if present. Using fetch+reset
// instead of pull avoids merge-conflict states entirely — this working copy
// is a read-only mirror, never expected to have local commits.
func cloneOrPull(ctx context.Context, rawURL, branch, pat string) error {
	if err := validateBranch(branch); err != nil {
		return err
	}
	authURL, err := authenticatedURL(rawURL, pat)
	if err != nil {
		return fmt.Errorf("invalid repo URL: %w", err)
	}

	if _, err := os.Stat(filepath.Join(WorkDir, ".git")); os.IsNotExist(err) {
		if err := os.MkdirAll(filepath.Dir(WorkDir), 0700); err != nil {
			return fmt.Errorf("create working directory: %w", err)
		}
		_ = os.RemoveAll(WorkDir) // clear any partial/non-git leftovers
		if _, err := runGit(ctx, "", "clone", "--branch", branch, "--depth", "1", authURL, WorkDir); err != nil {
			return err
		}
		return nil
	}

	// Re-point origin in case the URL/PAT changed since the last sync.
	if _, err := runGit(ctx, WorkDir, "remote", "set-url", "origin", authURL); err != nil {
		return err
	}
	if _, err := runGit(ctx, WorkDir, "fetch", "--depth", "1", "origin", branch); err != nil {
		return err
	}
	// Reset to FETCH_HEAD rather than origin/<branch>: the original clone may
	// have used --branch on a different branch/repo (single-branch clones set
	// a narrow fetch refspec), which can leave refs/remotes/origin/<branch>
	// missing even after a successful fetch of that branch. FETCH_HEAD always
	// points at what was just fetched, regardless of refspec configuration.
	if _, err := runGit(ctx, WorkDir, "reset", "--hard", "FETCH_HEAD"); err != nil {
		return err
	}
	return nil
}

// testConnection confirms the repo/branch is reachable without cloning —
// git ls-remote just talks to the remote and checks the ref exists.
func testConnection(ctx context.Context, rawURL, branch, pat string) error {
	if err := validateBranch(branch); err != nil {
		return err
	}
	authURL, err := authenticatedURL(rawURL, pat)
	if err != nil {
		return fmt.Errorf("invalid repo URL: %w", err)
	}
	out, err := runGit(ctx, "", "ls-remote", "--exit-code", authURL, branch)
	if err != nil {
		return err
	}
	if out == "" {
		return fmt.Errorf("branch %q not found in remote", branch)
	}
	return nil
}
