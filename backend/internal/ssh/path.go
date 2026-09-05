package ssh

// An SSH exec session (what RunCommand/RunCommandTimeout open) is neither a
// login nor an interactive shell, so it never sources the user's profile and
// runs with sshd's bare built-in PATH. That default is narrow and differs per
// platform — macOS gives /usr/bin:/bin:/usr/sbin:/sbin, Debian gives a
// non-root user /usr/local/bin:/usr/bin:/bin with no sbin at all — which made
// perfectly installed tools look missing: Homebrew's nmap (/opt/homebrew/bin)
// on a Mac target, `ip`/`ss`/`iptables`/`lsmod` (/usr/sbin, /sbin) for a
// non-root Linux user, a snap-installed kubectl (/snap/bin).
//
// PosixCommand fixes that class of false negative for the POSIX scripts
// InfraEye runs itself. It is deliberately *not* applied inside RunCommand:
// Windows targets are driven through PowerShell (see the windows* scripts in
// handlers/), where this prelude is a syntax error, and operator-authored
// commands (healing actions, AI agent exec) are run exactly as written.

// posixPathPrelude appends — never prepends — the usual third-party install
// prefixes, so a tool the caller's own PATH already resolves still wins.
const posixPathPrelude = `PATH="$PATH:/usr/local/bin:/usr/local/sbin:/opt/homebrew/bin:/opt/homebrew/sbin:/opt/local/bin:/opt/local/sbin:/snap/bin:/usr/sbin:/sbin"; export PATH`

// PosixCommand returns cmd with the widened PATH prepended. cmd must be a
// POSIX shell command or script, and must not already be wrapped.
func PosixCommand(cmd string) string {
	return posixPathPrelude + "\n" + cmd
}
