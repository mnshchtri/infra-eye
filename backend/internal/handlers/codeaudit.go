package handlers

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/audit"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/gitsync"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/ws"
)

// ansiEscape strips terminal color/cursor codes: gitleaks and trivy both
// colorize their console output on the assumption of a TTY, which a
// browser-rendered log line has no use for and would otherwise show as
// garbled escape sequences.
var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

// spinnerFrame matches gitleaks' animated ASCII-art logo/spinner frames —
// meaningless without a redrawing terminal, so a line made up of nothing
// but those glyphs is dropped rather than shown as console noise.
var spinnerFrame = regexp.MustCompile(`^[\s○│╲╱─░╭╮╰╯]*$`)

// codeScanRoom and dastScanRoom name the WS hub room a running scan's
// console output is broadcast to — see CodeScanLogWS/DastScanLogWS below.
// A client should open that socket before POSTing the scan so it doesn't
// miss the opening lines (cloning/session-start), since this is a live
// broadcast, not a buffered replay.
func codeScanRoom(repoID uint) string   { return fmt.Sprintf("code-scan:%d", repoID) }
func dastScanRoom(targetID uint) string { return fmt.Sprintf("dast-scan:%d", targetID) }

// scanProgressLogger returns an audit.ScanLog that broadcasts each line to
// room as a "log" message, for a Jenkins-console-style live view of a scan
// in progress instead of a spinner that says nothing for however long
// CodeQL or a Docker ZAP pull takes.
func scanProgressLogger(room string) audit.ScanLog {
	return func(line string) {
		clean := ansiEscape.ReplaceAllString(line, "")
		if strings.TrimSpace(clean) == "" || spinnerFrame.MatchString(clean) {
			return
		}
		ws.GlobalHub.Broadcast(room, "log", gin.H{"line": clean, "at": time.Now()})
	}
}

// codeScanTimeout bounds one code-security scan run. CodeQL's database
// create+analyze step in particular can take several minutes even on a
// small repo, so this is far more generous than the SSH-probe audits.
const codeScanTimeout = 15 * time.Minute

// GetAuditTools reports which external scanners (gitleaks/semgrep/trivy/
// codeql for code security, Docker/ZAP for DAST) InfraEye can currently find
// on this backend host, so the frontend can grey out what isn't installed
// instead of letting a scan request fail confusingly.
func GetAuditTools(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"code_scan_tools":  audit.CodeScanTools(),
		"dast_environment": audit.GetDastEnvironment(),
	})
}

type setToolPathRequest struct {
	Path string `json:"path"` // "" clears the override and falls back to auto-detection
}

// SetAuditToolPath saves (or clears) a manual path override for one
// scanner. InfraEye runs on very different hosts and several of these tools
// (CodeQL especially) have no standard package-manager install location, so
// auto-detection is a best effort, not a guarantee — this is the escape
// hatch when it guesses wrong. The path is validated to exist and be
// executable before saving, so a typo fails immediately here rather than
// silently at the next scan.
func SetAuditToolPath(c *gin.Context) {
	id := c.Param("id")
	if _, known := audit.ToolByID(id); !known {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown tool " + id})
		return
	}
	var req setToolPathRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := audit.SetToolPathOverride(id, strings.TrimSpace(req.Path)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updated, _ := audit.ToolByID(id)
	c.JSON(http.StatusOK, updated)
}

// ── Code repos (SAST / secrets / SCA / CodeQL targets) ──

func ListCodeRepos(c *gin.Context) {
	var repos []models.CodeRepo
	db.DB.Order("name").Find(&repos)
	out := make([]gin.H, 0, len(repos))
	for _, r := range repos {
		out = append(out, codeRepoJSON(r))
	}
	c.JSON(http.StatusOK, out)
}

// codeRepoJSON never includes the PAT — same discipline as gitsync's
// settings endpoint — just whether one is set.
func codeRepoJSON(r models.CodeRepo) gin.H {
	return gin.H{
		"id": r.ID, "name": r.Name, "repo_url": r.RepoURL, "branch": r.Branch,
		"pat_set": r.PAT != "", "created_at": r.CreatedAt, "updated_at": r.UpdatedAt,
	}
}

type codeRepoRequest struct {
	Name    string  `json:"name" binding:"required"`
	RepoURL string  `json:"repo_url" binding:"required"`
	Branch  string  `json:"branch"`
	PAT     *string `json:"pat"`
}

func CreateCodeRepo(c *gin.Context) {
	var req codeRepoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	repo := models.CodeRepo{
		Name: strings.TrimSpace(req.Name), RepoURL: strings.TrimSpace(req.RepoURL),
		Branch: firstNonEmptyStr(strings.TrimSpace(req.Branch), "main"),
	}
	if req.PAT != nil {
		repo.PAT = *req.PAT
	}
	if err := db.DB.Create(&repo).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, codeRepoJSON(repo))
}

func UpdateCodeRepo(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var repo models.CodeRepo
	if err := db.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repo not found"})
		return
	}
	var req codeRepoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != "" {
		repo.Name = strings.TrimSpace(req.Name)
	}
	if req.RepoURL != "" {
		repo.RepoURL = strings.TrimSpace(req.RepoURL)
	}
	if req.Branch != "" {
		repo.Branch = strings.TrimSpace(req.Branch)
	}
	if req.PAT != nil {
		repo.PAT = *req.PAT
	}
	db.DB.Save(&repo)
	c.JSON(http.StatusOK, codeRepoJSON(repo))
}

func DeleteCodeRepo(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	db.DB.Delete(&models.CodeRepo{}, id)
	db.DB.Where("target_type = ? AND target_id = ?", "code_repo", id).Delete(&models.SecurityScan{})
	c.JSON(http.StatusOK, gin.H{"success": true})
}

type codeScanRequest struct {
	Tools         []string `json:"tools"`
	SemgrepConfig string   `json:"semgrep_config"`
}

// ScanCodeRepo shallow-clones the repo into an isolated temp checkout (never
// the IaC-sync mirror), runs whichever requested scanners are installed
// against it, and always cleans the checkout up afterward — a scan leaves
// nothing behind but its findings. Cloning error text goes through
// gitsync.RedactCredentials before it ever reaches the response, matching
// the IaC-sync error-handling discipline for the exact same PAT-in-URL risk.
func ScanCodeRepo(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var repo models.CodeRepo
	if err := db.DB.First(&repo, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "repo not found"})
		return
	}

	var req codeScanRequest
	_ = c.ShouldBindJSON(&req)
	if len(req.Tools) == 0 {
		req.Tools = []string{"gitleaks", "semgrep", "trivy"} // CodeQL opts in explicitly — it's the slowest by far
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), codeScanTimeout)
	defer cancel()

	room := codeScanRoom(repo.ID)
	progress := scanProgressLogger(room)
	progress.Logf("Starting code security scan of %s (tools: %s)", repo.RepoURL, strings.Join(req.Tools, ", "))

	progress.Logf("Cloning %s@%s...", repo.RepoURL, repo.Branch)
	dir, cleanup, err := gitsync.CloneShallowToTemp(ctx, repo.RepoURL, repo.Branch, repo.PAT)
	if err != nil {
		msg := gitsync.RedactCredentials(err.Error())
		progress.Logf("✖ Clone failed: %s", msg)
		ws.GlobalHub.Broadcast(room, "error", gin.H{"error": msg})
		c.JSON(http.StatusOK, gin.H{"success": false, "error": msg})
		return
	}
	defer cleanup()
	progress.Logf("Clone complete")

	result := audit.RunCodeScan(ctx, dir, audit.CodeScanRequest{Tools: req.Tools, SemgrepConfig: req.SemgrepConfig}, progress)
	saveSecurityScan(c, "code_repo", repo.ID, "code", result, result.FindingCount, result.CriticalCount+result.HighCount)
	ws.GlobalHub.Broadcast(room, "done", gin.H{"result": result})

	c.JSON(http.StatusOK, gin.H{
		"success": true, "repo_id": repo.ID, "repo_name": repo.Name, "result": result,
	})
}

func firstNonEmptyStr(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ── DAST targets ──

func ListDastTargets(c *gin.Context) {
	var targets []models.DastTarget
	db.DB.Order("name").Find(&targets)
	c.JSON(http.StatusOK, targets)
}

type dastTargetRequest struct {
	Name      string `json:"name" binding:"required"`
	TargetURL string `json:"target_url" binding:"required"`
	Notes     string `json:"notes"`
}

func CreateDastTarget(c *gin.Context) {
	var req dastTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	target := models.DastTarget{
		Name: strings.TrimSpace(req.Name), TargetURL: strings.TrimSpace(req.TargetURL), Notes: req.Notes,
	}
	if err := db.DB.Create(&target).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, target)
}

func UpdateDastTarget(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var target models.DastTarget
	if err := db.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target not found"})
		return
	}
	var req dastTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != "" {
		target.Name = strings.TrimSpace(req.Name)
	}
	if req.TargetURL != "" {
		target.TargetURL = strings.TrimSpace(req.TargetURL)
	}
	target.Notes = req.Notes
	db.DB.Save(&target)
	c.JSON(http.StatusOK, target)
}

func DeleteDastTarget(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	db.DB.Delete(&models.DastTarget{}, id)
	db.DB.Where("target_type = ? AND target_id = ?", "dast_target", id).Delete(&models.SecurityScan{})
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// dastScanTimeout: a ZAP baseline scan is usually done in well under a
// minute for a small site; a full active scan against anything nontrivial
// can run long, since it walks every discovered parameter with every attack
// payload in the active scanner's ruleset.
const dastScanTimeout = 45 * time.Minute

type dastScanRequest struct {
	Mode    string `json:"mode"`    // baseline (default) | full
	Confirm bool   `json:"confirm"` // required for mode=full — see below
}

// ScanDastTarget runs OWASP ZAP against the saved target. "full" performs an
// active scan — it sends real attack payloads (SQLi, XSS, path traversal,
// etc.) at the target, which can trigger WAFs/rate limits or, against a
// fragile app, cause real disruption — so it's refused unless the caller
// explicitly sets confirm:true, verifying at the point of use (not just at
// target-creation time) that they're authorized to actively test this URL.
func ScanDastTarget(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var target models.DastTarget
	if err := db.DB.First(&target, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target not found"})
		return
	}

	var req dastScanRequest
	_ = c.ShouldBindJSON(&req)
	mode := firstNonEmptyStr(req.Mode, "baseline")
	if mode == "full" && !req.Confirm {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "a full active scan sends real attack payloads at the target — resend with confirm:true once you've verified you're authorized to actively test it",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), dastScanTimeout)
	defer cancel()

	room := dastScanRoom(target.ID)
	progress := scanProgressLogger(room)

	result, err := audit.RunDastScan(ctx, target.TargetURL, mode, progress)
	if err != nil {
		progress.Logf("✖ Scan failed: %v", err)
		ws.GlobalHub.Broadcast(room, "error", gin.H{"error": err.Error()})
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}

	saveSecurityScan(c, "dast_target", target.ID, "dast", result, result.FindingCount, result.CriticalCount+result.HighCount)
	ws.GlobalHub.Broadcast(room, "done", gin.H{"result": result})

	c.JSON(http.StatusOK, gin.H{
		"success": true, "target_id": target.ID, "target_name": target.Name, "result": result,
	})
}

// CodeScanLogWS subscribes a WebSocket connection to one repo's live scan
// console — every line RunCodeScan reports while a scan triggered via
// ScanCodeRepo is in flight. Purely a live view: the POST response remains
// the authoritative result, so a client that misses lines (or never
// connects) loses nothing but the show.
func CodeScanLogWS(c *gin.Context) {
	id := c.Param("id")
	conn, release, err := UpgradeTracked(c)
	if err != nil {
		return
	}
	defer release()
	client := ws.GlobalHub.Register(conn, codeScanRoom(uintFromParam(id)))
	client.ReadPump(ws.GlobalHub, nil)
}

// DastScanLogWS is CodeScanLogWS's counterpart for a DAST target's scan
// console (ScanDastTarget).
func DastScanLogWS(c *gin.Context) {
	id := c.Param("id")
	conn, release, err := UpgradeTracked(c)
	if err != nil {
		return
	}
	defer release()
	client := ws.GlobalHub.Register(conn, dastScanRoom(uintFromParam(id)))
	client.ReadPump(ws.GlobalHub, nil)
}

func uintFromParam(s string) uint {
	// Bound the parse to uint's actual bit width (32 on a 32-bit platform)
	// rather than always 64, so the uint(n) conversion below can never
	// silently truncate a value ParseUint accepted as valid.
	n, _ := strconv.ParseUint(s, 10, strconv.IntSize)
	return uint(n)
}
