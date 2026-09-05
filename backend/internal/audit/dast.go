package audit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// DastFinding is one alert from a dynamic (running-application) scan.
type DastFinding struct {
	PluginID    string `json:"plugin_id"`
	Name        string `json:"name"`
	Risk        string `json:"risk"` // critical | high | medium | low | info
	Confidence  string `json:"confidence"`
	Description string `json:"description,omitempty"`
	Solution    string `json:"solution,omitempty"`
	URL         string `json:"url,omitempty"`
	Evidence    string `json:"evidence,omitempty"`
	CWEID       string `json:"cwe_id,omitempty"`
}

type DastScanResult struct {
	ScannedAt     time.Time     `json:"scanned_at"`
	TargetURL     string        `json:"target_url"`
	Mode          string        `json:"mode"` // baseline | full
	Findings      []DastFinding `json:"findings"`
	FindingCount  int           `json:"finding_count"`
	CriticalCount int           `json:"critical_count"`
	HighCount     int           `json:"high_count"`
	MediumCount   int           `json:"medium_count"`
	LowCount      int           `json:"low_count"`
}

// validateTargetURL rejects anything that isn't a well-formed http(s) URL —
// same reasoning as gitsync's validateRepoURL: this string reaches an exec
// argv (docker run ... zap-baseline.py -t <url>) or an HTTP client, and must
// not be usable to smuggle a flag or a non-HTTP scheme.
func validateTargetURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid target URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("target URL must be http:// or https://, not %q", u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("target URL is missing a host")
	}
	return nil
}

// RunDastScan runs an OWASP ZAP scan against targetURL and returns the
// normalized alert list. mode "baseline" is passive-only (spiders the site,
// never sends attack payloads) and is safe to run without extra
// authorization beyond having access to the target; mode "full" performs an
// active scan — it sends real attack payloads (SQLi, XSS, etc.) at the
// target and must only ever be run against infrastructure the caller is
// authorized to test. The handler is responsible for gating "full" behind
// explicit confirmation; this function does not re-check authorization.
func RunDastScan(ctx context.Context, targetURL, mode string, progress ScanLog) (DastScanResult, error) {
	// Findings starts as an empty (non-nil) slice — see the identical
	// comment in RunCodeScan for why a nil one would break the frontend on
	// a clean scan.
	result := DastScanResult{ScannedAt: time.Now(), TargetURL: targetURL, Mode: mode, Findings: []DastFinding{}}
	if mode != "baseline" && mode != "full" {
		return result, fmt.Errorf("unknown scan mode %q (expected baseline or full)", mode)
	}
	if err := validateTargetURL(targetURL); err != nil {
		return result, err
	}
	progress.Logf("Target: %s (mode: %s)", targetURL, mode)

	env := GetDastEnvironment()
	var alerts []zapAlert
	var err error
	switch {
	case env.ZAPAPIConfigured:
		progress.Logf("Using external ZAP daemon at %s", env.ZAPAPIURL)
		alerts, err = runZAPViaAPI(ctx, env.ZAPAPIURL, targetURL, mode, progress)
	case env.Docker.Available:
		progress.Logf("Starting OWASP ZAP via Docker (%s)...", env.Docker.Path)
		alerts, err = runZAPViaDocker(ctx, env.Docker.Path, targetURL, mode, progress)
	default:
		return result, fmt.Errorf("no DAST engine available — install Docker (to run OWASP ZAP on demand) or set ZAP_API_URL to point at a running ZAP daemon")
	}
	if err != nil {
		return result, err
	}

	for _, a := range alerts {
		result.Findings = append(result.Findings, DastFinding{
			PluginID: a.PluginID, Name: a.Alert, Risk: normalizeZapRisk(a.Risk),
			Confidence: a.Confidence, Description: stripHTML(a.Description),
			Solution: stripHTML(a.Solution), URL: a.URL, Evidence: a.Evidence, CWEID: a.CWEID,
		})
	}
	for _, f := range result.Findings {
		switch f.Risk {
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
	progress.Logf("Scan complete: %d alert(s) (%d critical, %d high, %d medium, %d low)",
		result.FindingCount, result.CriticalCount, result.HighCount, result.MediumCount, result.LowCount)
	return result, nil
}

// zapAlert is ZAP's alert shape, shared by both the JSON report the Docker
// scripts write and the REST API's core/view/alerts response.
type zapAlert struct {
	PluginID    string `json:"pluginid"`
	Alert       string `json:"alert"`
	Name        string `json:"name"`
	Risk        string `json:"risk"`
	Confidence  string `json:"confidence"`
	Description string `json:"description"`
	Solution    string `json:"solution"`
	URL         string `json:"url"`
	Evidence    string `json:"evidence"`
	CWEID       string `json:"cweid"`
}

func normalizeZapRisk(risk string) string {
	switch strings.ToLower(risk) {
	case "high":
		return "high"
	case "medium":
		return "medium"
	case "low":
		return "low"
	default:
		return "info"
	}
}

func stripHTML(s string) string {
	s = strings.ReplaceAll(s, "<p>", "\n")
	s = strings.ReplaceAll(s, "</p>", "")
	return strings.TrimSpace(s)
}

// ── Docker-driven ZAP (no daemon required) ──

// zapDockerImage is the official OWASP ZAP scanning image. Baseline scans
// only ever passively observe traffic; full scans additionally run ZAP's
// active scanner, which sends real exploit-shaped payloads at the target.
const zapDockerImage = "ghcr.io/zaproxy/zaproxy:stable"

func runZAPViaDocker(ctx context.Context, dockerPath, targetURL, mode string, progress ScanLog) ([]zapAlert, error) {
	work, err := os.MkdirTemp("", "infraeye-zap-*")
	if err != nil {
		return nil, fmt.Errorf("create scan directory: %w", err)
	}
	defer os.RemoveAll(work)
	if err := os.Chmod(work, 0777); err != nil { // the container runs as a non-root, different uid
		return nil, fmt.Errorf("prepare scan directory: %w", err)
	}

	script := "zap-baseline.py"
	if mode == "full" {
		script = "zap-full-scan.py"
	}

	args := []string{
		"run", "--rm", "-v", work + ":/zap/wrk/:rw",
		zapDockerImage, script,
		"-t", targetURL,
		"-J", "report.json", // JSON report; exit code is nonzero when alerts are found, which is expected
		"-I", // don't fail the container run just because alerts were found
	}
	if script == "zap-baseline.py" {
		// zap-baseline.py (unlike zap-full-scan.py) routes through ZAP's
		// newer Automation Framework by default, which has a known flaky
		// failure mode: "Failed to access summary file /home/zap/zap_out.json"
		// — an internal completion-marker file the framework writes,
		// unrelated to our -J report path, that intermittently fails for
		// reasons upstream hasn't nailed down (see
		// https://groups.google.com/g/zaproxy-users/c/rUzC7sS9NaA). --autooff
		// reverts to the older direct-invocation path that doesn't have this
		// marker file at all, at no cost to the scan itself.
		args = append(args, "--autooff")
	}
	cmd := exec.CommandContext(ctx, dockerPath, args...)
	// Neither stream is a parse target (the report comes from -J's file), so
	// both stream live — this is also where a slow/first-time image pull
	// shows real progress instead of a spinner that says nothing for minutes.
	stdoutTee := &lineTee{buf: &bytes.Buffer{}, onLine: progress}
	stderrTee := &lineTee{buf: &bytes.Buffer{}, onLine: progress}
	cmd.Stdout = stdoutTee
	cmd.Stderr = stderrTee
	_ = cmd.Run() // ignore exit status: both scripts exit non-zero on findings by design
	stdoutTee.Flush()
	stderrTee.Flush()

	data, readErr := os.ReadFile(filepath.Join(work, "report.json"))
	if readErr != nil {
		msg := strings.TrimSpace(stderrTee.buf.String())
		if msg == "" {
			msg = readErr.Error()
		}
		return nil, fmt.Errorf("zap scan produced no report: %s", msg)
	}

	var report struct {
		Site []struct {
			Alerts []zapAlert `json:"alerts"`
		} `json:"site"`
	}
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("zap: parse report: %w", err)
	}
	var alerts []zapAlert
	for _, site := range report.Site {
		alerts = append(alerts, site.Alerts...)
	}
	return alerts, nil
}

// ── External ZAP daemon (bring-your-own, via ZAP_API_URL) ──

// runZAPViaAPI drives a already-running ZAP instance (any deployment: a
// long-lived container, a dedicated scan host) over its REST API — the same
// "point us at your own endpoint" shape as RESOURCE_GATEWAY_URL. Spidering +
// (for full mode) active scan are triggered synchronously via ascan/spider's
// blocking status polling, then alerts are read back for targetURL.
func runZAPViaAPI(ctx context.Context, apiURL, targetURL, mode string, progress ScanLog) ([]zapAlert, error) {
	base := strings.TrimRight(apiURL, "/")
	apiKey := os.Getenv("ZAP_API_KEY")

	progress.Logf("zap: starting session...")
	if _, err := zapAPICall(ctx, base, "/JSON/core/action/newSession/", apiKey, url.Values{"overwrite": {"true"}}); err != nil {
		return nil, fmt.Errorf("zap: start session: %w", err)
	}

	progress.Logf("zap: spidering %s...", targetURL)
	spiderResp, err := zapAPICall(ctx, base, "/JSON/spider/action/scan/", apiKey, url.Values{"url": {targetURL}})
	if err != nil {
		return nil, fmt.Errorf("zap: start spider: %w", err)
	}
	spiderID, _ := spiderResp["scan"].(string)
	if err := pollZAPProgress(ctx, base, apiKey, "/JSON/spider/view/status/", "status", spiderID, "zap: spidering", progress); err != nil {
		return nil, fmt.Errorf("zap: spider: %w", err)
	}
	progress.Logf("zap: spider complete")

	if mode == "full" {
		progress.Logf("zap: starting active scan (this sends attack payloads at the target)...")
		ascanResp, err := zapAPICall(ctx, base, "/JSON/ascan/action/scan/", apiKey, url.Values{"url": {targetURL}})
		if err != nil {
			return nil, fmt.Errorf("zap: start active scan: %w", err)
		}
		ascanID, _ := ascanResp["scan"].(string)
		if err := pollZAPProgress(ctx, base, apiKey, "/JSON/ascan/view/status/", "status", ascanID, "zap: active scan", progress); err != nil {
			return nil, fmt.Errorf("zap: active scan: %w", err)
		}
		progress.Logf("zap: active scan complete")
	} else {
		// Baseline: give the passive scanner a moment to finish processing
		// everything the spider already fetched.
		progress.Logf("zap: waiting for passive scan queue to drain...")
		if err := pollZAPPassiveQueue(ctx, base, apiKey, progress); err != nil {
			return nil, fmt.Errorf("zap: passive scan: %w", err)
		}
	}

	progress.Logf("zap: fetching alerts...")
	alertsResp, err := zapAPICall(ctx, base, "/JSON/core/view/alerts/", apiKey, url.Values{"baseurl": {targetURL}})
	if err != nil {
		return nil, fmt.Errorf("zap: fetch alerts: %w", err)
	}
	raw, _ := json.Marshal(alertsResp["alerts"])
	var alerts []zapAlert
	if err := json.Unmarshal(raw, &alerts); err != nil {
		return nil, fmt.Errorf("zap: parse alerts: %w", err)
	}
	return alerts, nil
}

func zapAPICall(ctx context.Context, base, path, apiKey string, params url.Values) (map[string]interface{}, error) {
	if apiKey != "" {
		params.Set("apikey", apiKey)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("unexpected response (status %d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d: %v", resp.StatusCode, out)
	}
	return out, nil
}

func pollZAPProgress(ctx context.Context, base, apiKey, path, field, scanID, label string, progress ScanLog) error {
	lastPct := ""
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
		resp, err := zapAPICall(ctx, base, path, apiKey, url.Values{"scanId": {scanID}})
		if err != nil {
			return err
		}
		pct, _ := resp[field].(string)
		if pct != lastPct {
			progress.Logf("%s: %s%%", label, pct)
			lastPct = pct
		}
		if pct == "100" {
			return nil
		}
	}
}

func pollZAPPassiveQueue(ctx context.Context, base, apiKey string, progress ScanLog) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
		resp, err := zapAPICall(ctx, base, "/JSON/pscan/view/recordsToScan/", apiKey, url.Values{})
		if err != nil {
			return err
		}
		remaining, _ := resp["recordsToScan"].(string)
		progress.Logf("zap: %s record(s) left to passively scan", remaining)
		if remaining == "0" {
			return nil
		}
	}
}
