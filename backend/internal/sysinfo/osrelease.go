// Package sysinfo parses OS/distro identification output collected over SSH.
package sysinfo

import "strings"

// DetectCommand is run over SSH to gather kernel name, kernel release, and
// the OS's version metadata in one round trip: /etc/os-release on Linux,
// falling back to `sw_vers` on macOS (which has no /etc/os-release).
const DetectCommand = `uname -s && uname -r && (cat /etc/os-release 2>/dev/null || sw_vers 2>/dev/null || true)`

// Info holds the parsed identity of a remote host's operating system.
type Info struct {
	OS            string // linux, darwin, unknown
	KernelVersion string // e.g. 5.15.0-91-generic, 23.5.0
	Distro        string // devicon-compatible id, e.g. ubuntu, debian, fedora (Linux only)
	DistroVersion string // e.g. 22.04, or macOS product version e.g. 14.5
	PrettyName    string // e.g. "Ubuntu 22.04.3 LTS" or "macOS 14.5"
}

// ParseDetectOutput parses the combined output of DetectCommand.
func ParseDetectOutput(output string) Info {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	info := Info{OS: "unknown"}

	if len(lines) > 0 {
		kernelName := strings.ToLower(strings.TrimSpace(lines[0]))
		switch {
		case strings.Contains(kernelName, "darwin"):
			info.OS = "darwin"
		case kernelName != "":
			info.OS = "linux"
		}
	}
	if len(lines) > 1 {
		info.KernelVersion = strings.TrimSpace(lines[1])
	}

	if len(lines) <= 2 {
		return info
	}

	switch info.OS {
	case "linux":
		osRelease := parseOSReleaseFields(lines[2:])
		info.Distro = osRelease["ID"]
		info.DistroVersion = osRelease["VERSION_ID"]
		info.PrettyName = osRelease["PRETTY_NAME"]
	case "darwin":
		swVers := parseSwVersFields(lines[2:])
		info.DistroVersion = swVers["ProductVersion"]
		name := swVers["ProductName"]
		if name == "" {
			name = "macOS"
		}
		if info.DistroVersion != "" {
			info.PrettyName = name + " " + info.DistroVersion
		} else {
			info.PrettyName = name
		}
	}
	return info
}

// distroKeywords maps substrings found in a free-form OS description (such as
// a Kubernetes NodeInfo.OSImage, e.g. "Ubuntu 22.04.3 LTS") to the
// devicon-compatible distro id used by DISTRO_ICON_CLASSES on the frontend.
// Longer/more specific keywords are listed first since matching is first-hit.
var distroKeywords = []struct {
	keyword string
	id      string
}{
	{"ubuntu", "ubuntu"},
	{"debian", "debian"},
	{"centos", "centos"},
	{"fedora", "fedora"},
	{"red hat", "rhel"},
	{"rhel", "rhel"},
	{"rocky", "rocky"},
	{"alma", "almalinux"},
	{"amazon linux", "amzn"},
	{"alpine", "alpine"},
	{"arch linux", "archlinux"},
	{"opensuse", "opensuse"},
	{"suse", "sles"},
	{"gentoo", "gentoo"},
	{"raspbian", "raspbian"},
}

// GuessDistroID best-effort maps a free-form OS description (e.g. a
// Kubernetes node's OSImage string) to a devicon-compatible distro id.
// Returns "" if nothing recognizable is found.
func GuessDistroID(osImage string) string {
	lower := strings.ToLower(osImage)
	for _, dk := range distroKeywords {
		if strings.Contains(lower, dk.keyword) {
			return dk.id
		}
	}
	return ""
}

// parseOSReleaseFields parses /etc/os-release-style KEY=VALUE lines,
// stripping surrounding quotes from values.
func parseOSReleaseFields(lines []string) map[string]string {
	fields := make(map[string]string)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		key, value, found := strings.Cut(line, "=")
		if !found || key == "" {
			continue
		}
		value = strings.Trim(value, `"'`)
		fields[key] = value
	}
	return fields
}

// parseSwVersFields parses macOS `sw_vers` output, e.g.
// "ProductName:\tmacOS\nProductVersion:\t14.5\nBuildVersion:\t23F79".
func parseSwVersFields(lines []string) map[string]string {
	fields := make(map[string]string)
	for _, line := range lines {
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" {
			continue
		}
		fields[key] = value
	}
	return fields
}
