package audit

import (
	"strings"
	"time"
)

// HardeningCheck is a single OS/SSH hardening verdict.
type HardeningCheck struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Severity string `json:"severity"` // info | low | medium | high
	Passed   bool   `json:"passed"`
	Detail   string `json:"detail"`
}

// HardeningAuditResult is the full hardening report for one server.
type HardeningAuditResult struct {
	ScannedAt time.Time        `json:"scanned_at"`
	Checks    []HardeningCheck `json:"checks"`
	FailCount int              `json:"fail_count"`
}

// HardeningScanCommand is run over SSH in a single round trip. Every probe is
// best-effort — missing tools or permission errors (e.g. /etc/shadow without
// root) yield an empty section rather than aborting the whole scan.
const HardeningScanCommand = `
echo '@@SSHD@@'; sshd -T 2>/dev/null || cat /etc/ssh/sshd_config 2>/dev/null
echo '@@FW@@'; (ufw status 2>/dev/null; firewall-cmd --state 2>/dev/null; iptables -L -n 2>/dev/null | head -20)
echo '@@PORTS@@'; (ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null)
echo '@@SUDONOPW@@'; grep -rh NOPASSWD /etc/sudoers /etc/sudoers.d 2>/dev/null
echo '@@UID0@@'; awk -F: '$3==0{print $1}' /etc/passwd 2>/dev/null
echo '@@EMPTYPW@@'; awk -F: '($2==""){print $1}' /etc/shadow 2>/dev/null
echo '@@AUTOUPD@@'; (dpkg -l unattended-upgrades 2>/dev/null | grep '^ii'; systemctl is-enabled unattended-upgrades.timer 2>/dev/null; rpm -q dnf-automatic 2>/dev/null; systemctl is-enabled dnf-automatic.timer 2>/dev/null)
echo '@@END@@'
`

var hardeningSectionMarkers = []string{"@@SSHD@@", "@@FW@@", "@@PORTS@@", "@@SUDONOPW@@", "@@UID0@@", "@@EMPTYPW@@", "@@AUTOUPD@@", "@@END@@"}

func parseMarkerSections(output string, markers []string) map[string]string {
	body := make(map[string]string, len(markers))
	remaining := output
	for i, marker := range markers {
		idx := strings.Index(remaining, marker)
		if idx == -1 {
			continue
		}
		afterMarker := remaining[idx+len(marker):]
		end := len(afterMarker)
		if i+1 < len(markers) {
			if nextIdx := strings.Index(afterMarker, markers[i+1]); nextIdx != -1 {
				end = nextIdx
			}
		}
		body[marker] = strings.TrimSpace(afterMarker[:end])
		remaining = afterMarker
	}
	return body
}

// ScanHardening runs HardeningScanCommand's raw SSH output through a set of
// OS/SSH hardening checks.
func ScanHardening(rawOutput string) HardeningAuditResult {
	sec := parseMarkerSections(rawOutput, hardeningSectionMarkers)
	// Checks starts as an empty (non-nil) slice — a nil one marshals to JSON
	// `null`, and the frontend calls .length/.map on it unconditionally once
	// a result exists, which crashes the page on a clean scan.
	result := HardeningAuditResult{ScannedAt: time.Now(), Checks: []HardeningCheck{}}

	sshd := sec["@@SSHD@@"]
	sshdLower := strings.ToLower(sshd)
	rootLoginOK := strings.Contains(sshdLower, "permitrootlogin no")
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "ssh-root-login", Title: "SSH root login disabled", Severity: "high",
		Passed: rootLoginOK,
		Detail: pickDetail(rootLoginOK, "PermitRootLogin is set to no", "PermitRootLogin is not explicitly disabled — root can log in directly over SSH"),
	})

	passwordAuthOK := strings.Contains(sshdLower, "passwordauthentication no")
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "ssh-password-auth", Title: "SSH password authentication disabled", Severity: "medium",
		Passed: passwordAuthOK,
		Detail: pickDetail(passwordAuthOK, "PasswordAuthentication is set to no", "Password authentication is enabled — key-only login is not enforced"),
	})

	fw := sec["@@FW@@"]
	fwLower := strings.ToLower(fw)
	fwActive := strings.Contains(fwLower, "status: active") || strings.Contains(fwLower, "running") || strings.Contains(fw, "Chain INPUT")
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "firewall-active", Title: "Host firewall active", Severity: "medium",
		Passed: fwActive,
		Detail: pickDetail(fwActive, "A firewall (ufw/firewalld/iptables) reports an active ruleset", "No active firewall detected (ufw/firewalld/iptables all unreachable or inactive)"),
	})

	sudoNoPw := strings.TrimSpace(sec["@@SUDONOPW@@"])
	noSudoNoPw := sudoNoPw == ""
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "sudo-nopasswd", Title: "No passwordless sudo entries", Severity: "medium",
		Passed: noSudoNoPw,
		Detail: pickDetail(noSudoNoPw, "No NOPASSWD entries found in sudoers", "NOPASSWD sudo entries found: "+truncate(sudoNoPw, 200)),
	})

	uid0 := strings.Fields(sec["@@UID0@@"])
	extraUID0 := extraEntries(uid0, "root")
	noExtraUID0 := len(extraUID0) == 0
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "uid0-accounts", Title: "Only root has UID 0", Severity: "high",
		Passed: noExtraUID0,
		Detail: pickDetail(noExtraUID0, "root is the only UID 0 account", "Additional UID 0 accounts found: "+strings.Join(extraUID0, ", ")),
	})

	emptyPw := strings.Fields(sec["@@EMPTYPW@@"])
	noEmptyPw := len(emptyPw) == 0
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "empty-password-accounts", Title: "No accounts with an empty password", Severity: "high",
		Passed: noEmptyPw,
		Detail: pickDetail(noEmptyPw, "No accounts with an empty password hash (or /etc/shadow was unreadable)", "Accounts with an empty password hash: "+strings.Join(emptyPw, ", ")),
	})

	autoUpd := strings.TrimSpace(sec["@@AUTOUPD@@"])
	autoUpdOK := autoUpd != "" && !strings.Contains(strings.ToLower(autoUpd), "disabled")
	result.Checks = append(result.Checks, HardeningCheck{
		ID: "auto-security-updates", Title: "Automatic security updates enabled", Severity: "low",
		Passed: autoUpdOK,
		Detail: pickDetail(autoUpdOK, "unattended-upgrades/dnf-automatic is installed and enabled", "No automatic security update mechanism detected or enabled"),
	})

	for _, c := range result.Checks {
		if !c.Passed {
			result.FailCount++
		}
	}
	return result
}

func pickDetail(passed bool, ok, fail string) string {
	if passed {
		return ok
	}
	return fail
}

func extraEntries(entries []string, exclude string) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e != exclude {
			out = append(out, e)
		}
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
