package ssh

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// Host key verification is trust-on-first-use (TOFU): the first time we
// connect to a host we record its key in knownHostsPath, and every
// connection after that is checked against the recorded key. A host that
// suddenly presents a different key — a machine-in-the-middle, or a
// reprovisioned box nobody told us about — is rejected instead of silently
// accepted, which is what InsecureIgnoreHostKey used to do.
//
// knownHostsPath is resolved lazily (on first SSH connection) rather than at
// package-init time, so SetKnownHostsPath can override it first. That
// matters for the desktop build: its working directory is whatever the OS
// launched it with (often "/" for a GUI-launched .app, not the repo
// checkout resolveKnownHostsPath's fallback assumes), and it has no
// /.dockerenv either — the heuristic below has nothing reliable to go on,
// so cmd/desktop calls SetKnownHostsPath with its real per-OS app-data
// directory during startup instead.
var (
	knownHostsPath string
	knownHostsMu   sync.Mutex
)

// SetKnownHostsPath overrides the known_hosts file location. Must be called
// before the first SSH connection — cmd/desktop does this during OnStartup,
// well before a user can trigger an SSH connect.
func SetKnownHostsPath(path string) {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	knownHostsPath = path
	ensureKnownHostsFile(path)
}

func resolveKnownHostsPath() string {
	if v := os.Getenv("SSH_KNOWN_HOSTS_PATH"); v != "" {
		return v
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "/data/ssh_known_hosts"
	}
	// Dev/native: walk up from cwd to the repo root (same convention used by
	// mcp/config_manager.go for shared_mcp) so the file lands in ./data/.
	cwd, _ := os.Getwd()
	for dir := cwd; dir != string(filepath.Separator) && dir != "."; dir = filepath.Dir(dir) {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return filepath.Join(dir, "data", "ssh_known_hosts")
		}
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return filepath.Join(dir, "..", "data", "ssh_known_hosts")
		}
	}
	return filepath.Join(cwd, "ssh_known_hosts")
}

func ensureKnownHostsFile(path string) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "ssh: failed to create known_hosts dir %s: %v\n", filepath.Dir(path), err)
		return
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ssh: failed to create known_hosts file %s: %v\n", path, err)
		return
	}
	f.Close()
}

// pathLocked returns the known_hosts path, resolving and creating it on
// first use if SetKnownHostsPath was never called. Caller must hold
// knownHostsMu.
func pathLocked() string {
	if knownHostsPath == "" {
		knownHostsPath = resolveKnownHostsPath()
		ensureKnownHostsFile(knownHostsPath)
	}
	return knownHostsPath
}

// trustOnFirstUseCallback builds a HostKeyCallback backed by the current
// contents of knownHostsPath. It's rebuilt per connection (the file is tiny)
// so a key recorded by an earlier call is picked up immediately.
func trustOnFirstUseCallback() (gossh.HostKeyCallback, error) {
	knownHostsMu.Lock()
	path := pathLocked()
	knownHostsMu.Unlock()

	verify, err := knownhosts.New(path)
	if err != nil {
		return nil, fmt.Errorf("load known_hosts %s: %w", path, err)
	}

	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		knownHostsMu.Lock()
		defer knownHostsMu.Unlock()

		err := verify(hostname, remote, key)
		if err == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if !errors.As(err, &keyErr) {
			return err
		}
		if len(keyErr.Want) > 0 {
			// Known host, different key: could be a MITM or a silently
			// rotated host key. Either way, don't auto-trust it.
			return fmt.Errorf("SSH host key for %s doesn't match the one on record in %s (possible MITM, or the host was reprovisioned) — remove its entry from that file to re-trust it", hostname, path)
		}

		// Never seen this host before: record its key and accept.
		if appendErr := appendKnownHost(path, hostname, remote, key); appendErr != nil {
			return fmt.Errorf("record SSH host key for %s: %w", hostname, appendErr)
		}
		return nil
	}, nil
}

func appendKnownHost(path, hostname string, remote net.Addr, key gossh.PublicKey) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()

	addresses := []string{knownhosts.Normalize(hostname)}
	if remote != nil {
		if addr := knownhosts.Normalize(remote.String()); addr != addresses[0] {
			addresses = append(addresses, addr)
		}
	}

	_, err = f.WriteString(knownhosts.Line(addresses, key) + "\n")
	return err
}
