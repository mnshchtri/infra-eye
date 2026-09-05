package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Finding is the shape every code-scan tool's output is normalized into, so
// the frontend renders one table regardless of which scanners ran. Severity
// is always one of: critical, high, medium, low, info.
type Finding struct {
	Tool        string `json:"tool"`     // gitleaks | semgrep | trivy | codeql
	Category    string `json:"category"` // secret | sast | dependency | iac
	Severity    string `json:"severity"`
	RuleID      string `json:"rule_id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	File        string `json:"file,omitempty"`
	Line        int    `json:"line,omitempty"`
	Package     string `json:"package,omitempty"`  // dependency findings only
	FixedIn     string `json:"fixed_in,omitempty"` // dependency findings only
	Reference   string `json:"reference,omitempty"`
}

// CodeScanResult is one run of the code-security audit across whichever
// tools were requested and available. ToolErrors carries a tool's raw
// stderr/exit error verbatim when it fails, per docs/DESIGN_PRINCIPLES.md —
// a scan is never silently partial without saying so.
type CodeScanResult struct {
	ScannedAt     time.Time         `json:"scanned_at"`
	ToolsRun      []string          `json:"tools_run"`
	ToolErrors    map[string]string `json:"tool_errors,omitempty"`
	Findings      []Finding         `json:"findings"`
	FindingCount  int               `json:"finding_count"`
	CriticalCount int               `json:"critical_count"`
	HighCount     int               `json:"high_count"`
	MediumCount   int               `json:"medium_count"`
	LowCount      int               `json:"low_count"`
}

// CodeScanRequest selects which tools to run and lets the caller override
// Semgrep's ruleset — "auto" (Semgrep's registry-matched default) needs
// outbound network access to app.semgrep.dev; a fully offline install should
// pass a local ruleset path or a bundled pack name like "p/ci" instead.
type CodeScanRequest struct {
	Tools         []string `json:"tools"`
	SemgrepConfig string   `json:"semgrep_config"`
}

// RunCodeScan runs every requested, available tool against dir (a plain
// working tree — see gitsync.CloneShallowToTemp) and merges their findings.
// A tool that isn't installed is skipped with a note in ToolErrors rather
// than failing the whole scan; a tool that IS installed but errors out
// reports its verbatim failure the same way. progress (nil is fine) is
// called with each console line as tools run — see ScanLog.
func RunCodeScan(ctx context.Context, dir string, req CodeScanRequest, progress ScanLog) CodeScanResult {
	// Findings/ToolsRun start as empty (non-nil) slices, not zero-value nil
	// ones — an append to a nil slice that never runs (e.g. every tool finds
	// nothing) leaves it nil, which encoding/json renders as `null`, not
	// `[]`. The frontend always calls .map()/.length on these unconditionally
	// once a result exists, so a clean scan would otherwise crash the page.
	result := CodeScanResult{
		ScannedAt: time.Now(), ToolErrors: map[string]string{},
		Findings: []Finding{}, ToolsRun: []string{},
	}
	available := map[string]Tool{}
	for _, t := range CodeScanTools() {
		available[t.ID] = t
	}

	for _, id := range req.Tools {
		t, known := available[id]
		if !known {
			result.ToolErrors[id] = fmt.Sprintf("unknown scanner %q", id)
			progress.Logf("✖ Unknown scanner %q", id)
			continue
		}
		if !t.Available {
			result.ToolErrors[id] = fmt.Sprintf("%s is not installed — %s", t.Name, t.InstallHint)
			progress.Logf("⚠ Skipping %s — not installed", t.Name)
			continue
		}

		progress.Logf("▶ Running %s...", t.Name)
		var findings []Finding
		var err error
		switch id {
		case "gitleaks":
			findings, err = runGitleaks(ctx, t.Path, dir, progress)
		case "semgrep":
			cfg := req.SemgrepConfig
			if cfg == "" {
				cfg = "auto"
			}
			findings, err = runSemgrep(ctx, t.Path, dir, cfg, progress)
		case "trivy":
			findings, err = runTrivyFS(ctx, t.Path, dir, progress)
		case "codeql":
			findings, err = runCodeQL(ctx, t.Path, dir, progress)
		}

		result.ToolsRun = append(result.ToolsRun, id)
		if err != nil {
			result.ToolErrors[id] = err.Error()
			progress.Logf("✖ %s failed: %v", t.Name, err)
		} else {
			progress.Logf("✔ %s complete — %d finding(s)", t.Name, len(findings))
		}
		result.Findings = append(result.Findings, findings...)
	}

	sort.Slice(result.Findings, func(i, j int) bool {
		return severityRank(result.Findings[i].Severity) > severityRank(result.Findings[j].Severity)
	})
	for _, f := range result.Findings {
		switch f.Severity {
		case "critical":
			result.CriticalCount++
		case "high":
			result.HighCount++
		case "medium":
			result.MediumCount++
		default:
			result.LowCount++
		}
	}
	result.FindingCount = len(result.Findings)
	progress.Logf("Scan complete: %d finding(s) (%d critical, %d high, %d medium, %d low)",
		result.FindingCount, result.CriticalCount, result.HighCount, result.MediumCount, result.LowCount)
	return result
}

func severityRank(s string) int {
	switch s {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

// runTool executes bin with args and returns combined stdout — a nonzero
// exit is not itself an error for these scanners (all four use it to mean
// "findings were reported"), so callers distinguish "ran but flagged things"
// from "couldn't run at all" by whether stdout parses as valid output.
//
// progress, if non-nil, receives every line these tools print as they run —
// stderr always (that's where all four put human progress output), stdout
// too when streamStdout is true (safe only for tools whose stdout isn't the
// JSON/report payload being parsed here).
func runTool(ctx context.Context, bin string, dir string, progress ScanLog, streamStdout bool, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = dir
	stdoutTee := &lineTee{buf: &bytes.Buffer{}}
	stderrTee := &lineTee{buf: &bytes.Buffer{}, onLine: progress}
	if streamStdout {
		stdoutTee.onLine = progress
	}
	cmd.Stdout = stdoutTee
	cmd.Stderr = stderrTee
	runErr := cmd.Run()
	stdoutTee.Flush()
	stderrTee.Flush()
	out := stdoutTee.buf.Bytes()
	if len(out) == 0 && runErr != nil {
		msg := strings.TrimSpace(stderrTee.buf.String())
		if msg == "" {
			msg = runErr.Error()
		}
		return nil, fmt.Errorf("%s: %s", bin, msg)
	}
	return out, nil
}

// ── Gitleaks (secrets) ──

type gitleaksFinding struct {
	RuleID      string `json:"RuleID"`
	Description string `json:"Description"`
	File        string `json:"File"`
	StartLine   int    `json:"StartLine"`
	Match       string `json:"Match"`
	Secret      string `json:"Secret"`
}

func runGitleaks(ctx context.Context, bin, dir string, progress ScanLog) ([]Finding, error) {
	reportPath := filepath.Join(os.TempDir(), fmt.Sprintf("gitleaks-%d.json", time.Now().UnixNano()))
	defer os.Remove(reportPath)

	// Neither stdout nor stderr is the parse target here (findings come from
	// --report-path), so both are safe to stream live.
	_, err := runTool(ctx, bin, dir, progress, true, "detect", "--source", ".", "--no-git",
		"--report-format", "json", "--report-path", reportPath, "--exit-code", "0")
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(reportPath)
	if err != nil {
		// No leaks found: gitleaks doesn't always write an empty-array report.
		return nil, nil
	}
	var raw []gitleaksFinding
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("gitleaks: parse report: %w", err)
	}

	findings := make([]Finding, 0, len(raw))
	for _, g := range raw {
		findings = append(findings, Finding{
			Tool: "gitleaks", Category: "secret", Severity: "high",
			RuleID: g.RuleID, Title: g.Description,
			Description: redactSecret(g.Match, g.Secret),
			File:        g.File, Line: g.StartLine,
		})
	}
	return findings, nil
}

// redactSecret keeps the surrounding match context (variable name, prefix)
// but never echoes the live secret value into a finding that ends up stored
// in the database and rendered in the UI.
func redactSecret(match, secret string) string {
	if secret == "" {
		return match
	}
	if idx := strings.Index(match, secret); idx >= 0 {
		return match[:idx] + "«redacted»" + match[idx+len(secret):]
	}
	return "«redacted»"
}

// flexStringList tolerates Semgrep's inconsistent metadata shapes: a rule's
// `references` (and similar list-ish metadata fields across different rule
// sources) can be a JSON array, a single string, or absent entirely,
// depending on who wrote the rule. Unmarshaling straight into []string
// breaks the whole scan the moment one rule uses the singular form; this
// normalizes all three into a []string instead of failing.
type flexStringList []string

func (f *flexStringList) UnmarshalJSON(data []byte) error {
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*f = arr
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		if s != "" {
			*f = []string{s}
		}
		return nil
	}
	// Some other shape (null, object, number) — ignore rather than fail
	// the whole scan over one cosmetic metadata field.
	return nil
}

// ── Semgrep (SAST) ──

type semgrepOutput struct {
	Results []struct {
		CheckID string `json:"check_id"`
		Path    string `json:"path"`
		Start   struct {
			Line int `json:"line"`
		} `json:"start"`
		Extra struct {
			Message  string `json:"message"`
			Severity string `json:"severity"`
			Lines    string `json:"lines"`
			Metadata struct {
				CWE        json.RawMessage `json:"cwe"`
				OWASP      json.RawMessage `json:"owasp"`
				References flexStringList  `json:"references"`
			} `json:"metadata"`
		} `json:"extra"`
	} `json:"results"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

func runSemgrep(ctx context.Context, bin, dir, config string, progress ScanLog) ([]Finding, error) {
	// stdout carries the --json payload this function parses below, so only
	// stderr (where Semgrep's own progress goes) is streamed live.
	out, err := runTool(ctx, bin, dir, progress, false, "--config", config, "--json", ".")
	if err != nil {
		return nil, err
	}
	var parsed semgrepOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("semgrep: parse output: %w", err)
	}

	findings := make([]Finding, 0, len(parsed.Results))
	for _, r := range parsed.Results {
		sev := "medium"
		switch strings.ToUpper(r.Extra.Severity) {
		case "ERROR":
			sev = "high"
		case "WARNING":
			sev = "medium"
		case "INFO":
			sev = "low"
		}
		findings = append(findings, Finding{
			Tool: "semgrep", Category: "sast", Severity: sev,
			RuleID: r.CheckID, Title: r.CheckID, Description: r.Extra.Message,
			File: r.Path, Line: r.Start.Line, Reference: strings.Join(r.Extra.Metadata.References, ", "),
		})
	}
	if len(findings) == 0 && len(parsed.Errors) > 0 {
		msgs := make([]string, 0, len(parsed.Errors))
		for _, e := range parsed.Errors {
			msgs = append(msgs, e.Message)
		}
		return nil, fmt.Errorf("semgrep: %s", strings.Join(msgs, "; "))
	}
	return findings, nil
}

// ── Trivy (dependency / IaC / secret) ──

type trivyOutput struct {
	Results []struct {
		Target          string `json:"Target"`
		Class           string `json:"Class"`
		Vulnerabilities []struct {
			VulnerabilityID  string `json:"VulnerabilityID"`
			PkgName          string `json:"PkgName"`
			InstalledVersion string `json:"InstalledVersion"`
			FixedVersion     string `json:"FixedVersion"`
			Severity         string `json:"Severity"`
			Title            string `json:"Title"`
			Description      string `json:"Description"`
			PrimaryURL       string `json:"PrimaryURL"`
		} `json:"Vulnerabilities"`
		Misconfigurations []struct {
			ID          string `json:"ID"`
			Title       string `json:"Title"`
			Description string `json:"Description"`
			Message     string `json:"Message"`
			Severity    string `json:"Severity"`
			Resolution  string `json:"Resolution"`
		} `json:"Misconfigurations"`
		Secrets []struct {
			RuleID    string `json:"RuleID"`
			Title     string `json:"Title"`
			Severity  string `json:"Severity"`
			StartLine int    `json:"StartLine"`
			Match     string `json:"Match"`
		} `json:"Secrets"`
	} `json:"Results"`
}

func runTrivyFS(ctx context.Context, bin, dir string, progress ScanLog) ([]Finding, error) {
	// Same split as Semgrep: stdout is the --format json payload parsed
	// below, stderr is Trivy's own progress (DB downloads, scan phases).
	out, err := runTool(ctx, bin, dir, progress, false, "fs", "--format", "json",
		"--scanners", "vuln,misconfig,secret", ".")
	if err != nil {
		return nil, err
	}
	var parsed trivyOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, fmt.Errorf("trivy: parse output: %w", err)
	}

	var findings []Finding
	for _, res := range parsed.Results {
		for _, v := range res.Vulnerabilities {
			findings = append(findings, Finding{
				Tool: "trivy", Category: "dependency", Severity: strings.ToLower(v.Severity),
				RuleID: v.VulnerabilityID, Title: v.Title, Description: v.Description,
				File: res.Target, Package: v.PkgName, FixedIn: v.FixedVersion,
				Reference: v.PrimaryURL,
			})
		}
		for _, m := range res.Misconfigurations {
			findings = append(findings, Finding{
				Tool: "trivy", Category: "iac", Severity: strings.ToLower(m.Severity),
				RuleID: m.ID, Title: m.Title, Description: firstNonEmpty(m.Message, m.Description),
				File: res.Target, Reference: m.Resolution,
			})
		}
		for _, s := range res.Secrets {
			findings = append(findings, Finding{
				Tool: "trivy", Category: "secret", Severity: strings.ToLower(s.Severity),
				RuleID: s.RuleID, Title: s.Title, Description: redactSecret(s.Match, ""),
				File: res.Target, Line: s.StartLine,
			})
		}
	}
	for i := range findings {
		if findings[i].Severity == "" || findings[i].Severity == "unknown" {
			findings[i].Severity = "low"
		}
	}
	return findings, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ── CodeQL (semantic SAST) ──

// codeqlLanguageByExt maps source extensions to a CodeQL language identifier
// for the languages the CLI can build without a project-specific build
// command (interpreted/no-compile-step languages). Compiled languages
// (Java, C#, C/C++) need --command and a working build environment InfraEye
// has no way to guess, so they're intentionally not offered here — running
// codeql on one of those repos returns a clear "unsupported" error instead
// of a silent, confusing autobuild failure.
var codeqlLanguageByExt = map[string]string{
	".js": "javascript", ".jsx": "javascript", ".ts": "javascript", ".tsx": "javascript", ".mjs": "javascript",
	".py": "python",
	".rb": "ruby",
	".go": "go",
}

func detectCodeqlLanguage(dir string) (string, error) {
	counts := map[string]int{}
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if lang, ok := codeqlLanguageByExt[strings.ToLower(filepath.Ext(path))]; ok {
			counts[lang]++
		}
		return nil
	})
	best, bestCount := "", 0
	for lang, n := range counts {
		if n > bestCount {
			best, bestCount = lang, n
		}
	}
	if best == "" {
		return "", fmt.Errorf("no CodeQL-supported source files found (javascript/typescript, python, ruby, go)")
	}
	return best, nil
}

type sarifOutput struct {
	Runs []struct {
		Tool struct {
			Driver struct {
				Rules []struct {
					ID         string `json:"id"`
					Properties struct {
						SecuritySeverity string `json:"security-severity"`
					} `json:"properties"`
					ShortDescription struct {
						Text string `json:"text"`
					} `json:"shortDescription"`
				} `json:"rules"`
			} `json:"driver"`
		} `json:"tool"`
		Results []struct {
			RuleID  string `json:"ruleId"`
			Level   string `json:"level"`
			Message struct {
				Text string `json:"text"`
			} `json:"message"`
			Locations []struct {
				PhysicalLocation struct {
					ArtifactLocation struct {
						URI string `json:"uri"`
					} `json:"artifactLocation"`
					Region struct {
						StartLine int `json:"startLine"`
					} `json:"region"`
				} `json:"physicalLocation"`
			} `json:"locations"`
		} `json:"results"`
	} `json:"runs"`
}

func runCodeQL(ctx context.Context, bin, dir string, progress ScanLog) ([]Finding, error) {
	lang, err := detectCodeqlLanguage(dir)
	if err != nil {
		return nil, err
	}
	progress.Logf("codeql: detected language %s", lang)

	work, err := os.MkdirTemp("", "infraeye-codeql-*")
	if err != nil {
		return nil, fmt.Errorf("codeql: create work dir: %w", err)
	}
	defer os.RemoveAll(work)
	dbDir := filepath.Join(work, "db")
	sarifPath := filepath.Join(work, "results.sarif")

	// Neither step's stdout is a payload this function reads (the SARIF
	// comes from --output), so both streams are safe to stream live —
	// CodeQL's own extraction/compile/analysis progress goes here, which is
	// the most useful console output of any of these four tools by far.
	progress.Logf("codeql: creating database (this can take a few minutes)...")
	if _, err := runTool(ctx, bin, dir, progress, true, "database", "create", dbDir,
		"--language="+lang, "--source-root=.", "--overwrite"); err != nil {
		return nil, fmt.Errorf("codeql database create: %w", err)
	}

	// The standalone CodeQL CLI (e.g. the Homebrew Cask install) ships with no
	// query packs at all — only the CodeQL Bundle bundles them. `pack download`
	// is safe to run unconditionally: it's a no-op (fast cache hit) once the
	// pack is already present, so this doesn't slow down bundle-based installs.
	queryPack := fmt.Sprintf("codeql/%s-queries", lang)
	progress.Logf("codeql: ensuring %s query pack is available...", queryPack)
	if _, err := runTool(ctx, bin, dir, progress, true, "pack", "download", queryPack); err != nil {
		return nil, fmt.Errorf("codeql pack download: %w", err)
	}

	suite := fmt.Sprintf("%s:codeql-suites/%s-security-extended.qls", queryPack, lang)
	progress.Logf("codeql: database created, running %s analysis...", suite)
	if _, err := runTool(ctx, bin, dir, progress, true, "database", "analyze", dbDir,
		"--format=sarifv2.1.0", "--output="+sarifPath, "--", suite); err != nil {
		return nil, fmt.Errorf("codeql database analyze: %w", err)
	}
	progress.Logf("codeql: analysis complete, parsing results...")

	data, err := os.ReadFile(sarifPath)
	if err != nil {
		return nil, fmt.Errorf("codeql: read SARIF output: %w", err)
	}
	var parsed sarifOutput
	if err := json.Unmarshal(data, &parsed); err != nil {
		return nil, fmt.Errorf("codeql: parse SARIF: %w", err)
	}

	var findings []Finding
	for _, run := range parsed.Runs {
		ruleSeverity := map[string]string{}
		ruleTitle := map[string]string{}
		for _, r := range run.Tool.Driver.Rules {
			ruleTitle[r.ID] = r.ShortDescription.Text
			if r.Properties.SecuritySeverity != "" {
				ruleSeverity[r.ID] = sarifSecuritySeverityToLevel(r.Properties.SecuritySeverity)
			}
		}
		for _, res := range run.Results {
			sev, ok := ruleSeverity[res.RuleID]
			if !ok {
				sev = sarifLevelToSeverity(res.Level)
			}
			f := Finding{
				Tool: "codeql", Category: "sast", Severity: sev,
				RuleID: res.RuleID, Title: firstNonEmpty(ruleTitle[res.RuleID], res.RuleID),
				Description: res.Message.Text,
			}
			if len(res.Locations) > 0 {
				loc := res.Locations[0].PhysicalLocation
				f.File = loc.ArtifactLocation.URI
				f.Line = loc.Region.StartLine
			}
			findings = append(findings, f)
		}
	}
	return findings, nil
}

func sarifLevelToSeverity(level string) string {
	switch level {
	case "error":
		return "high"
	case "warning":
		return "medium"
	default:
		return "low"
	}
}

func sarifSecuritySeverityToLevel(score string) string {
	f, err := strconv.ParseFloat(score, 64)
	if err != nil {
		return "medium"
	}
	switch {
	case f >= 9:
		return "critical"
	case f >= 7:
		return "high"
	case f >= 4:
		return "medium"
	default:
		return "low"
	}
}
