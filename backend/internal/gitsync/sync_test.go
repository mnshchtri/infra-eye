package gitsync

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"gorm.io/gorm"
)

// setupTestDB points db.DB at a fresh, file-backed SQLite database (unique
// per test via t.TempDir()) with every model this package touches migrated.
// A real file rather than :memory: avoids any risk of SQLite's shared-cache
// in-memory mode leaking state between tests.
func setupTestDB(t *testing.T) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	gormDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := gormDB.AutoMigrate(&models.Server{}, &models.AlertRule{}, &models.Folder{}, &models.AppSetting{}, &models.GitSyncRun{}); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
	db.DB = gormDB
}

// runGitT runs a git command in dir, failing the test on error.
func runGitT(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

// newTestRepo creates a local git repo at a temp path with the given
// servers.yaml/alert-rules.yaml content and one commit, returning its path
// (usable directly as a "URL" for local clones — no scheme needed).
func newTestRepo(t *testing.T, serversYAML, rulesYAML string) string {
	t.Helper()
	dir := t.TempDir()
	runGitT(t, dir, "init", "-q", "-b", "main")
	runGitT(t, dir, "config", "user.email", "test@example.com")
	runGitT(t, dir, "config", "user.name", "Test")
	writeRepoFiles(t, dir, serversYAML, rulesYAML)
	runGitT(t, dir, "add", "-A")
	runGitT(t, dir, "commit", "-q", "-m", "init")
	return dir
}

func writeRepoFiles(t *testing.T, dir, serversYAML, rulesYAML string) {
	t.Helper()
	if serversYAML != "" {
		if err := os.WriteFile(filepath.Join(dir, serversFileName), []byte(serversYAML), 0644); err != nil {
			t.Fatalf("write servers.yaml: %v", err)
		}
	}
	if rulesYAML != "" {
		if err := os.WriteFile(filepath.Join(dir, alertRulesFileName), []byte(rulesYAML), 0644); err != nil {
			t.Fatalf("write alert-rules.yaml: %v", err)
		}
	}
}

func commit(t *testing.T, dir string) {
	t.Helper()
	runGitT(t, dir, "add", "-A")
	runGitT(t, dir, "commit", "-q", "-m", "update")
}

const sampleServers = `servers:
  - name: web-01
    host: 10.0.1.11
    port: 22
    ssh_user: deploy
    tags: prod,web
  - name: cluster-a
    is_k8s: true
`

const sampleRules = `alert_rules:
  - name: high-cpu-web
    server: web-01
    condition_type: cpu
    condition_op: gt
    condition_value: "85"
    action_type: notify
    enabled: true
  - name: all-servers-disk
    condition_type: disk
    condition_op: gt
    condition_value: "90"
    action_type: notify
    enabled: true
`

// TestRunSync_ConflictsJSONNeverBareNull guards against a real regression:
// a nil []string marshaled via encoding/json produces the JSON literal
// "null", which crashes any frontend doing conflicts.map(...) after
// JSON.parse. A conflict-free run must serialize ConflictsJSON as "[]".
func TestRunSync_ConflictsJSONNeverBareNull(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	run := RunSync("manual")
	if run.ConflictsJSON == "null" {
		t.Fatalf("ConflictsJSON must never be the bare string %q — got exactly that", run.ConflictsJSON)
	}
	if run.ConflictsJSON != "[]" {
		t.Errorf("expected \"[]\" for a conflict-free run, got %q", run.ConflictsJSON)
	}
}

func TestRunSync_CreatesServersAndRules(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	run := RunSync("manual")
	if run.Status != "success" {
		t.Fatalf("expected success, got %q (error: %s)", run.Status, run.ErrorText)
	}
	if run.ServersCreated != 2 {
		t.Errorf("expected 2 servers created, got %d", run.ServersCreated)
	}
	if run.RulesCreated != 2 {
		t.Errorf("expected 2 rules created, got %d", run.RulesCreated)
	}

	var web01 models.Server
	if err := db.DB.Where("name = ?", "web-01").First(&web01).Error; err != nil {
		t.Fatalf("web-01 not created: %v", err)
	}
	if !web01.GitManaged {
		t.Error("expected web-01.GitManaged = true")
	}
	if web01.SSHKeyPath != "" || web01.SSHPassword != "" || web01.KubeConfig != "" {
		t.Error("expected no credential fields to be populated by git sync — schema has no such fields, so this would indicate a leak")
	}
	if web01.Host != "10.0.1.11" || web01.SSHUser != "deploy" {
		t.Errorf("unexpected metadata: %+v", web01)
	}

	var rule models.AlertRule
	if err := db.DB.Where("name = ?", "high-cpu-web").First(&rule).Error; err != nil {
		t.Fatalf("high-cpu-web rule not created: %v", err)
	}
	if rule.ServerID != web01.ID {
		t.Errorf("expected rule.ServerID == web01.ID (%d), got %d", web01.ID, rule.ServerID)
	}

	var allServersRule models.AlertRule
	if err := db.DB.Where("name = ?", "all-servers-disk").First(&allServersRule).Error; err != nil {
		t.Fatalf("all-servers-disk rule not created: %v", err)
	}
	if allServersRule.ServerID != 0 {
		t.Errorf("expected ServerID 0 for a ruleless of a specific server, got %d", allServersRule.ServerID)
	}
}

func TestRunSync_UpdatesInPlace(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	RunSync("manual")
	var before models.Server
	db.DB.Where("name = ?", "web-01").First(&before)

	updatedServers := `servers:
  - name: web-01
    host: 10.0.1.99
    port: 22
    ssh_user: deploy
    tags: prod,web,updated
  - name: cluster-a
    is_k8s: true
`
	writeRepoFiles(t, repo, updatedServers, "")
	commit(t, repo)

	run := RunSync("manual")
	if run.Status != "success" {
		t.Fatalf("expected success, got %q (%s)", run.Status, run.ErrorText)
	}
	if run.ServersUpdated != 1 {
		t.Errorf("expected 1 server updated, got %d", run.ServersUpdated)
	}

	var after models.Server
	db.DB.Where("name = ?", "web-01").First(&after)
	if after.ID != before.ID {
		t.Errorf("expected same row ID across update (update-in-place), got %d -> %d", before.ID, after.ID)
	}
	if after.Host != "10.0.1.99" || after.Tags != "prod,web,updated" {
		t.Errorf("expected updated fields, got %+v", after)
	}
}

func TestRunSync_DeletesRemovedEntries(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	RunSync("manual")

	onlyOneServer := `servers:
  - name: cluster-a
    is_k8s: true
`
	writeRepoFiles(t, repo, onlyOneServer, "")
	commit(t, repo)

	run := RunSync("manual")
	if run.ServersDeleted != 1 {
		t.Errorf("expected 1 server deleted, got %d", run.ServersDeleted)
	}

	var web01 models.Server
	err := db.DB.Where("name = ?", "web-01").First(&web01).Error
	if err == nil {
		t.Error("expected web-01 to be soft-deleted (not findable by default scope)")
	}
	var clusterA models.Server
	if err := db.DB.Where("name = ?", "cluster-a").First(&clusterA).Error; err != nil {
		t.Errorf("expected cluster-a to remain untouched: %v", err)
	}
}

func TestRunSync_NeverTouchesManualRows(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	manual := models.Server{Name: "manually-added", Host: "1.2.3.4", GitManaged: false}
	db.DB.Create(&manual)
	manualUpdatedAt := manual.UpdatedAt

	for i := 0; i < 3; i++ {
		run := RunSync("manual")
		if run.Status != "success" {
			t.Fatalf("run %d: expected success, got %q (%s)", i, run.Status, run.ErrorText)
		}
	}

	var reloaded models.Server
	if err := db.DB.Where("name = ?", "manually-added").First(&reloaded).Error; err != nil {
		t.Fatalf("manually-added server disappeared: %v", err)
	}
	if reloaded.GitManaged {
		t.Error("manually-added server should never become git_managed")
	}
	if !reloaded.UpdatedAt.Equal(manualUpdatedAt) {
		t.Errorf("manually-added server was modified by sync: UpdatedAt changed from %v to %v", manualUpdatedAt, reloaded.UpdatedAt)
	}
}

func TestRunSync_ReportsConflictWithoutOverwriting(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	manual := models.Server{Name: "web-01", Host: "9.9.9.9", GitManaged: false}
	db.DB.Create(&manual)

	run := RunSync("manual")
	if run.Status != "partial" {
		t.Fatalf("expected partial status due to conflict, got %q", run.Status)
	}
	if len(run.ConflictsJSON) == 0 || run.ConflictsJSON == "[]" || run.ConflictsJSON == "null" {
		t.Errorf("expected a non-empty conflicts list, got %q", run.ConflictsJSON)
	}

	var rows []models.Server
	db.DB.Where("name = ?", "web-01").Find(&rows)
	if len(rows) != 1 {
		t.Fatalf("expected exactly 1 row named web-01 (no duplicate created), got %d", len(rows))
	}
	if rows[0].Host != "9.9.9.9" {
		t.Errorf("manual row should be untouched, got Host=%q", rows[0].Host)
	}
}

func TestRunSync_InvalidYAMLSurfacesVerbatim(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")

	writeRepoFiles(t, repo, "servers:\n  - name: [this is not valid: yaml structure\n", "")
	commit(t, repo)

	run := RunSync("manual")
	if run.Status != "failed" {
		t.Fatalf("expected failed status for broken YAML, got %q", run.Status)
	}
	if run.ErrorText == "" {
		t.Error("expected a non-empty raw error message")
	}
}

func TestRunSync_UnreachableRepoSurfacesRawGitError(t *testing.T) {
	setupTestDB(t)
	SetWorkDir(t.TempDir() + "/work")
	db.SetSetting(SettingRepoURL, "/nonexistent/path/does-not-exist")
	db.SetSetting(SettingBranch, "main")

	run := RunSync("manual")
	if run.Status != "failed" {
		t.Fatalf("expected failed status for unreachable repo, got %q", run.Status)
	}
	if run.ErrorText == "" {
		t.Error("expected the raw git error to be surfaced")
	}
}

func TestRunSync_NoRepoConfigured(t *testing.T) {
	setupTestDB(t)
	db.SetSetting(SettingRepoURL, "")

	run := RunSync("manual")
	if run.Status != "failed" || run.ErrorText == "" {
		t.Errorf("expected a clear failure when no repo is configured, got status=%q error=%q", run.Status, run.ErrorText)
	}
}

// TestRunSync_ReusesWorkDirAcrossDifferentBranch is a real-world regression:
// the first sync's `git clone --branch X` creates a single-branch clone with
// a narrow fetch refspec covering only X. Re-pointing at a different branch
// (or repo) on a later sync and fetching that new branch by name can still
// leave refs/remotes/origin/<newBranch> missing, so resetting to that ref
// (rather than FETCH_HEAD) fails with "unknown revision" even though the
// fetch itself succeeded. Reproduced exactly as found: two syncs reusing the
// same WorkDir, second one against a different branch than the first.
func TestRunSync_ReusesWorkDirAcrossDifferentBranch(t *testing.T) {
	setupTestDB(t)
	repo := newTestRepo(t, sampleServers, sampleRules)
	runGitT(t, repo, "checkout", "-q", "-b", "develop")
	// Blank out alert-rules.yaml too — the develop branch's server list no
	// longer includes "web-01", so leaving high-cpu-web's "server: web-01"
	// reference in place would be a self-inconsistent fixture (a legitimate
	// dangling-reference conflict), not the git-mechanics bug under test.
	writeRepoFiles(t, repo, "servers:\n  - name: develop-only-server\n    host: 10.0.2.1\n", "alert_rules: []\n")
	commit(t, repo)
	runGitT(t, repo, "checkout", "-q", "main")

	SetWorkDir(t.TempDir() + "/work")

	db.SetSetting(SettingRepoURL, repo)
	db.SetSetting(SettingBranch, "main")
	firstRun := RunSync("manual")
	if firstRun.Status != "success" {
		t.Fatalf("first sync (main): expected success, got %q (%s)", firstRun.Status, firstRun.ErrorText)
	}

	db.SetSetting(SettingBranch, "develop")
	secondRun := RunSync("manual")
	if secondRun.Status != "success" {
		t.Fatalf("second sync (develop, same WorkDir): expected success, got %q (%s)", secondRun.Status, secondRun.ErrorText)
	}
	if secondRun.ServersCreated != 1 {
		t.Errorf("expected develop-only-server to be created, got ServersCreated=%d", secondRun.ServersCreated)
	}

	var s models.Server
	if err := db.DB.Where("name = ?", "develop-only-server").First(&s).Error; err != nil {
		t.Fatalf("develop-only-server not found after switching branches: %v", err)
	}
}
