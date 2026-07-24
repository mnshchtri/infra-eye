// Package audit implements read-only security scans that run over a
// server's existing SSH connection — no agent, no binary shipped to the
// target host. The kernel scanner ports the vulnerability database from
// https://github.com/gotr00t0day/kernelpwned (kernelpwned) into Go so it can
// run against InfraEye's pooled SSH clients instead of a compiled tool that
// would need to be cross-compiled and copied onto every managed server.
package audit

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// KernelVulnerability describes one known kernel privilege-escalation issue
// from kernelpwned's built-in database.
type KernelVulnerability struct {
	CVE         string `json:"cve"`
	Name        string `json:"name"`
	Description string `json:"description"`
	PoCURL      string `json:"poc_url"`
}

// KernelFinding is a KernelVulnerability paired with the scan's verdict for
// one server.
type KernelFinding struct {
	KernelVulnerability
	Vulnerable bool   `json:"vulnerable"`
	Detail     string `json:"detail"` // why: matched version range, loaded module, etc.
}

// KernelAuditResult is the full report for one server.
type KernelAuditResult struct {
	KernelVersion  string          `json:"kernel_version"`
	Distro         string          `json:"distro"`
	ScannedAt      time.Time       `json:"scanned_at"`
	Findings       []KernelFinding `json:"findings"`
	VulnerableCVEs int             `json:"vulnerable_count"`
}

// ScanCommand is run over SSH in a single round trip. Each section is
// prefixed with a marker line so the output can be split deterministically;
// every probe is best-effort (errors/missing tools yield an empty section
// rather than a non-zero exit, since kernelVersion is the only hard
// requirement). All probes are read-only: config/proc/sys file reads, module
// listing, and `modprobe -n -v` / `unshare` dry runs that never persist
// state on the target.
const ScanCommand = `
echo '@@KVER@@'; uname -r 2>/dev/null
echo '@@DISTRO@@'; cat /etc/os-release 2>/dev/null
echo '@@ESPMOD@@'; lsmod 2>/dev/null | grep -E '^(esp4|esp6|rxrpc)'
echo '@@ESPLOADABLE@@'; for m in esp4 esp6 rxrpc; do modprobe -n -v "$m" 2>/dev/null; done
echo '@@ESPINTCP@@'; grep -h CONFIG_INET_ESPINTCP "/boot/config-$(uname -r)" 2>/dev/null
echo '@@ALGIFAEAD@@'; lsmod 2>/dev/null | grep algif_aead
echo '@@AUTHENCESN@@'; grep -r authencesn /proc/crypto 2>/dev/null
echo '@@RXGK@@'; grep -h CONFIG_RXGK "/boot/config-$(uname -r)" 2>/dev/null
echo '@@PTRACESCOPE@@'; cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null
echo '@@SUID@@'; for f in /usr/lib/openssh/ssh-keysign /usr/bin/chage; do [ -u "$f" ] && echo "suid:$f"; [ -g "$f" ] && echo "sgid:$f"; done
echo '@@END@@'
`

var kernelVulnDB = []KernelVulnerability{
	{
		CVE:         "CVE-2016-5195",
		Name:        "Dirty COW",
		Description: "Race condition in the copy-on-write mechanism allows local privilege escalation to root.",
		PoCURL:      "https://github.com/firefart/dirtycow",
	},
	{
		CVE:         "CVE-2022-0847",
		Name:        "Dirty Pipe",
		Description: "Improper pipe buffer initialization allows overwriting arbitrary read-only files, leading to privilege escalation.",
		PoCURL:      "https://github.com/Al1ex/CVE-2022-0847",
	},
	{
		CVE:         "CVE-2023-32629",
		Name:        "GameOver(lay)",
		Description: "Overlay filesystem vulnerability on affected Ubuntu kernels allows privilege escalation to root.",
		PoCURL:      "https://github.com/g1vi/CVE-2023-2640-CVE-2023-32629",
	},
	{
		CVE:         "CVE-2024-1086",
		Name:        "Netfilter UAF",
		Description: "Use-after-free in the netfilter subsystem (nf_tables) allows local privilege escalation to root.",
		PoCURL:      "https://github.com/Notselwyn/CVE-2024-1086",
	},
	{
		CVE:         "CVE-2026-46300",
		Name:        "Fragnesia",
		Description: "Kernels built with CONFIG_INET_ESPINTCP enabled expose an ESP-over-TCP path that lets an unprivileged local attacker corrupt the page cache of read-only files.",
		PoCURL:      "https://github.com/v12-security/pocs/tree/main/fragnesia",
	},
	{
		CVE:         "CVE-2026-46300-2",
		Name:        "Fragnesia 2",
		Description: "Bypasses the Fragnesia fix (commit f84eca581739) via a separate esp4/esp6/rxrpc code path with the same page-cache corruption outcome.",
		PoCURL:      "https://github.com/v12-security/pocs/tree/main/fragnesia-5db89c99566fc",
	},
	{
		CVE:         "CVE-2026-43284",
		Name:        "Dirty Frag",
		Description: "Vulnerable kernel networking and memory-fragment handling reachable via the esp4/esp6/rxrpc modules allows privilege escalation to root.",
		PoCURL:      "https://github.com/V4bel/dirtyfrag",
	},
	{
		CVE:         "CVE-2026-31431",
		Name:        "Copy Fail",
		Description: "Logic flaw in the kernel crypto path (AF_ALG AEAD + authencesn) allows privilege escalation to root.",
		PoCURL:      "https://xint.io/blog/copy-fail-linux-distributions",
	},
	{
		CVE:         "CVE-2026-46333",
		Name:        "SSH Keysign Pwn",
		Description: "A ptrace exit-race skips the dumpable check when a process's mm is already NULL during teardown, enabling local privilege escalation and credential disclosure via a SUID target like ssh-keysign.",
		PoCURL:      "https://github.com/0xdeadbeefnetwork/ssh-keysign-pwn/",
	},
	{
		CVE:         "CVE-2026-39364",
		Name:        "Dirty Decrypt",
		Description: "A missing copy-on-write guard in the rxgk subsystem lets an unprivileged local attacker abuse a page-cache write primitive to gain root.",
		PoCURL:      "https://thehackernews.com/2026/05/dirtydecrypt-poc-released-for-linux.html",
	},
}

// version is a parsed major.minor.patch kernel release. Comparisons ignore
// any distro flavor suffix (e.g. "-91-generic", "+", "-arch1-1").
type version struct {
	major, minor, patch int
}

var versionPrefixRe = regexp.MustCompile(`^(\d+)\.(\d+)(?:\.(\d+))?`)

func parseVersion(s string) (version, bool) {
	m := versionPrefixRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return version{}, false
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch := 0
	if m[3] != "" {
		patch, _ = strconv.Atoi(m[3])
	}
	return version{major, minor, patch}, true
}

// compare returns -1, 0, or 1 as v is less than, equal to, or greater than other.
func (v version) compare(other version) int {
	if v.major != other.major {
		return sign(v.major - other.major)
	}
	if v.minor != other.minor {
		return sign(v.minor - other.minor)
	}
	return sign(v.patch - other.patch)
}

func sign(n int) int {
	switch {
	case n < 0:
		return -1
	case n > 0:
		return 1
	default:
		return 0
	}
}

func (v version) inRange(min, max version) bool {
	return v.compare(min) >= 0 && v.compare(max) <= 0
}

// versionRangesVulnerable reports whether v falls in any of the given
// inclusive [min, max] ranges.
func versionInRanges(v version, ranges [][2]string) bool {
	for _, r := range ranges {
		min, okMin := parseVersion(r[0])
		max, okMax := parseVersion(r[1])
		if !okMin || !okMax {
			continue
		}
		if v.inRange(min, max) {
			return true
		}
	}
	return false
}

// rawSections holds the parsed, marker-delimited output of ScanCommand.
type rawSections struct {
	kernelVersion string
	distro        string
	espModules    string
	espLoadable   string
	espIntcp      string
	algifAead     string
	authencesn    string
	rxgk          string
	ptraceScope   string
	suid          string
}

var sectionMarkers = []string{
	"@@KVER@@", "@@DISTRO@@", "@@ESPMOD@@", "@@ESPLOADABLE@@", "@@ESPINTCP@@",
	"@@ALGIFAEAD@@", "@@AUTHENCESN@@", "@@RXGK@@", "@@PTRACESCOPE@@", "@@SUID@@", "@@END@@",
}

func parseSections(output string) rawSections {
	body := make(map[string]string, len(sectionMarkers))
	remaining := output
	for i, marker := range sectionMarkers {
		idx := strings.Index(remaining, marker)
		if idx == -1 {
			continue
		}
		afterMarker := remaining[idx+len(marker):]
		end := len(afterMarker)
		if i+1 < len(sectionMarkers) {
			if nextIdx := strings.Index(afterMarker, sectionMarkers[i+1]); nextIdx != -1 {
				end = nextIdx
			}
		}
		body[marker] = strings.TrimSpace(afterMarker[:end])
		remaining = afterMarker
	}

	return rawSections{
		kernelVersion: body["@@KVER@@"],
		distro:        body["@@DISTRO@@"],
		espModules:    body["@@ESPMOD@@"],
		espLoadable:   body["@@ESPLOADABLE@@"],
		espIntcp:      body["@@ESPINTCP@@"],
		algifAead:     body["@@ALGIFAEAD@@"],
		authencesn:    body["@@AUTHENCESN@@"],
		rxgk:          body["@@RXGK@@"],
		ptraceScope:   body["@@PTRACESCOPE@@"],
		suid:          body["@@SUID@@"],
	}
}

func parseDistroName(osRelease string) string {
	for _, line := range strings.Split(osRelease, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "NAME="), `"`)
		}
	}
	return "Unknown"
}

// espModuleSignal reports whether esp4/esp6/rxrpc is loaded (preferred, more
// certain) or auto-loadable via modprobe, and a human-readable reason.
func espModuleSignal(loadedRaw, loadableRaw string) (bool, string) {
	if fields := strings.Fields(loadedRaw); len(fields) > 0 {
		return true, fmt.Sprintf("module %s is currently loaded", fields[0])
	}
	for _, line := range strings.Split(loadableRaw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "insmod") {
			return true, "esp4/esp6/rxrpc is not loaded but can be auto-loaded via modprobe"
		}
	}
	return false, ""
}

func espLoadableContains(loadableRaw, module string) bool {
	for _, line := range strings.Split(loadableRaw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "insmod") && strings.Contains(line, module) {
			return true
		}
	}
	return false
}

// configEnabled reports whether a `grep CONFIG_X /boot/config-...` line
// shows the symbol built in (=y) or as a module (=m).
func configEnabled(grepOutput, key string) bool {
	prefix := key + "="
	for _, line := range strings.Split(grepOutput, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		if val := strings.TrimPrefix(line, prefix); val == "y" || val == "m" {
			return true
		}
	}
	return false
}

func ptraceScopeExploitable(s string) bool {
	scope, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return false
	}
	return scope <= 1
}

// suidTargetPresent returns the first suid:/sgid: line the SUID probe
// reported (SUID ssh-keysign or SUID/SGID chage), if any.
func suidTargetPresent(s string) (bool, string) {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return true, line
		}
	}
	return false, ""
}

// copyFailVulnerable checks the Copy Fail / Dirty Frag family's shared
// affected range (4.14 – 6.18.21 / 6.19.11, plus 7.0-rc1) using range
// checks rather than kernelpwned's brute-force per-patch enumeration —
// equivalent coverage, no need to materialize hundreds of version strings.
func copyFailVulnerable(v version, kernelVersion string) bool {
	if strings.HasPrefix(strings.TrimSpace(kernelVersion), "7.0-rc1") {
		return true
	}
	return versionInRanges(v, [][2]string{
		{"4.14.0", "4.19.255"},
		{"5.0.0", "5.19.255"},
		{"6.0.0", "6.17.255"},
		{"6.18.0", "6.18.21"},
		{"6.19.0", "6.19.11"},
	})
}

// ScanKernel runs ScanCommand's raw SSH output through the kernelpwned
// vulnerability database and returns a per-CVE verdict.
func ScanKernel(rawOutput string) KernelAuditResult {
	sec := parseSections(rawOutput)
	kernelVersion := strings.TrimSpace(sec.kernelVersion)
	distro := parseDistroName(sec.distro)

	result := KernelAuditResult{
		KernelVersion: kernelVersion,
		Distro:        distro,
		ScannedAt:     time.Now(),
	}

	v, ok := parseVersion(kernelVersion)

	for _, vuln := range kernelVulnDB {
		finding := KernelFinding{KernelVulnerability: vuln}

		switch vuln.CVE {
		case "CVE-2016-5195": // Dirty COW: 2.0.0 - 4.8.3
			if ok && versionInRanges(v, [][2]string{{"2.0.0", "4.8.3"}}) {
				finding.Vulnerable = true
				finding.Detail = fmt.Sprintf("kernel %s is within the affected range 2.0.0 - 4.8.3", kernelVersion)
			}
		case "CVE-2022-0847": // Dirty Pipe: 5.8 - 5.16.10, excluding the point fixes
			if ok && versionInRanges(v, [][2]string{
				{"5.8.0", "5.10.101"},
				{"5.11.0", "5.15.24"},
				{"5.16.0", "5.16.10"},
			}) {
				finding.Vulnerable = true
				finding.Detail = fmt.Sprintf("kernel %s predates the fix shipped in 5.10.102 / 5.15.25 / 5.16.11", kernelVersion)
			}
		case "CVE-2023-32629": // GameOver(lay): Ubuntu-specific base kernels
			if ok && strings.EqualFold(distro, "ubuntu") && versionInRanges(v, [][2]string{
				{"5.4.0", "5.4.0"},
				{"5.19.0", "5.19.0"},
				{"6.2.0", "6.2.0"},
			}) {
				finding.Vulnerable = true
				finding.Detail = fmt.Sprintf("Ubuntu base kernel %s matches a known-affected overlayfs build", kernelVersion)
			}
		case "CVE-2024-1086": // netfilter UAF: 3.15 - 6.8, fixed in 6.6.15/6.7.3+
			if ok && versionInRanges(v, [][2]string{{"3.15.0", "6.8.0"}}) {
				finding.Vulnerable = true
				finding.Detail = fmt.Sprintf("kernel %s is within the affected range 3.15.0 - 6.8.0", kernelVersion)
			}
		case "CVE-2026-46300": // Fragnesia: CONFIG_INET_ESPINTCP enabled
			if configEnabled(sec.espIntcp, "CONFIG_INET_ESPINTCP") {
				finding.Vulnerable = true
				finding.Detail = "Kernel is built with CONFIG_INET_ESPINTCP enabled"
			}
		case "CVE-2026-46300-2", "CVE-2026-43284": // Fragnesia 2 / Dirty Frag: esp4/esp6/rxrpc loaded or loadable
			if reachable, why := espModuleSignal(sec.espModules, sec.espLoadable); reachable {
				finding.Vulnerable = true
				finding.Detail = why
			}
		case "CVE-2026-31431": // Copy Fail: version range + algif_aead + authencesn crypto available
			if ok && copyFailVulnerable(v, kernelVersion) && strings.TrimSpace(sec.algifAead) != "" && strings.TrimSpace(sec.authencesn) != "" {
				finding.Vulnerable = true
				finding.Detail = fmt.Sprintf("kernel %s is in the affected range and algif_aead + authencesn crypto are available", kernelVersion)
			}
		case "CVE-2026-46333": // SSH Keysign Pwn: kernel >=5.6, permissive ptrace_scope, SUID target present
			if ok && v.compare(version{5, 6, 0}) >= 0 && ptraceScopeExploitable(sec.ptraceScope) {
				if hasSuid, target := suidTargetPresent(sec.suid); hasSuid {
					finding.Vulnerable = true
					finding.Detail = fmt.Sprintf("kernel %s, ptrace_scope permits PTRACE_ATTACH, and %s is present", kernelVersion, target)
				}
			}
		case "CVE-2026-39364": // Dirty Decrypt: CONFIG_RXGK enabled + rxrpc module loadable
			if configEnabled(sec.rxgk, "CONFIG_RXGK") && espLoadableContains(sec.espLoadable, "rxrpc") {
				finding.Vulnerable = true
				finding.Detail = "CONFIG_RXGK is enabled and the rxrpc module is loadable"
			}
		}

		result.Findings = append(result.Findings, finding)
		if finding.Vulnerable {
			result.VulnerableCVEs++
		}
	}

	return result
}
