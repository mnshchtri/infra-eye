package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/audit"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
)

// auditCmdTimeout bounds an SSH-based audit probe's round trip.
const auditCmdTimeout = 20 * time.Second

// saveSecurityScan upserts the latest result for one (targetType, targetID,
// scanType) so audit pages can show current posture without forcing a live
// re-scan on every page load. The scan itself always runs live on request —
// this only caches its most recent outcome, per docs/DESIGN_PRINCIPLES.md's
// no-state-caching rule being a deliberate, scoped exception here.
func saveSecurityScan(c *gin.Context, targetType string, targetID uint, scanType string, result interface{}, findingCount, highCount int) {
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return
	}
	userID, _ := c.Get("user_id")
	var scannedBy uint
	if id, ok := userID.(uint); ok {
		scannedBy = id
	}

	var existing models.SecurityScan
	err = db.DB.Where("target_type = ? AND target_id = ? AND scan_type = ?", targetType, targetID, scanType).First(&existing).Error
	if err != nil {
		db.DB.Create(&models.SecurityScan{
			TargetType: targetType, TargetID: targetID, ScanType: scanType,
			FindingCount: findingCount, HighCount: highCount,
			ResultJSON: string(resultJSON), ScannedBy: scannedBy, ScannedAt: time.Now(),
		})
		return
	}
	existing.FindingCount = findingCount
	existing.HighCount = highCount
	existing.ResultJSON = string(resultJSON)
	existing.ScannedBy = scannedBy
	existing.ScannedAt = time.Now()
	db.DB.Save(&existing)
}

// ScanServerKernel runs the kernelpwned-derived vulnerability database
// against a server's live `uname -r` (and a few supporting probes) over its
// existing SSH connection. The scan always runs live on request; only the
// latest result is cached (see saveSecurityScan) so the audit list can show
// last-known posture without forcing a scan on load.
func ScanServerKernel(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	if server.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kernel audit requires an SSH-connected server"})
		return
	}
	if server.OS == "darwin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kernel audit only applies to Linux servers"})
		return
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("SSH connection failed: %v", err)})
		return
	}

	out, _, err := client.RunCommandTimeout(audit.ScanCommand, auditCmdTimeout)
	if err != nil && out == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("kernel scan failed: %v", err)})
		return
	}

	result := audit.ScanKernel(out)
	if result.KernelVersion == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not determine kernel version from server"})
		return
	}

	saveSecurityScan(c, "server", server.ID, "kernel", result, len(result.Findings), result.VulnerableCVEs)

	c.JSON(http.StatusOK, gin.H{
		"server_id":   server.ID,
		"server_name": server.Name,
		"result":      result,
	})
}

// ScanServerHardening runs a set of OS/SSH hardening checks over the
// server's existing SSH connection. Same live-scan / cached-latest-result
// pattern as ScanServerKernel.
func ScanServerHardening(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	if server.Host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hardening audit requires an SSH-connected server"})
		return
	}
	if server.OS == "darwin" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hardening audit only applies to Linux servers"})
		return
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("SSH connection failed: %v", err)})
		return
	}

	out, _, err := client.RunCommandTimeout(audit.HardeningScanCommand, auditCmdTimeout)
	if err != nil && out == "" {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("hardening scan failed: %v", err)})
		return
	}

	result := audit.ScanHardening(out)
	saveSecurityScan(c, "server", server.ID, "hardening", result, len(result.Checks), result.FailCount)

	c.JSON(http.StatusOK, gin.H{
		"server_id":   server.ID,
		"server_name": server.Name,
		"result":      result,
	})
}

// ScanCluster runs a set of read-only Kubernetes API calls (workload,
// RBAC, and network-exposure checks) against a server's connected cluster.
func ScanCluster(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	if !server.IsK8s || server.KubeConfig == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cluster audit requires a Kubernetes-connected server"})
		return
	}

	clientset, err := k8s.GetK8sClient(server.KubeConfig)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to cluster: " + err.Error()})
		return
	}

	result, err := audit.ScanCluster(clientset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("cluster scan failed: %v", err)})
		return
	}

	saveSecurityScan(c, "server", server.ID, "cluster", result, result.FindingCount, result.HighCount)

	c.JSON(http.StatusOK, gin.H{
		"server_id":   server.ID,
		"server_name": server.Name,
		"result":      result,
	})
}

// ScanResourceSecurity probes a Resource's live reachability, auth posture,
// and (for TLS-capable protocols) certificate health.
func ScanResourceSecurity(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}

	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}

	result, err := audit.ScanResource(resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("resource scan failed: %v", err)})
		return
	}

	saveSecurityScan(c, "resource", resource.ID, "resource", result, len(result.Findings), result.FailCount)

	c.JSON(http.StatusOK, gin.H{
		"resource_id":   resource.ID,
		"resource_name": resource.Name,
		"result":        result,
	})
}

// SecurityScanSummary is the lightweight, per-target metadata returned by
// GetSecurityScanSummary — no ResultJSON, just enough to paint a "last
// scanned" badge in a target list.
type SecurityScanSummary struct {
	TargetType   string    `json:"target_type"`
	TargetID     uint      `json:"target_id"`
	ScanType     string    `json:"scan_type"`
	FindingCount int       `json:"finding_count"`
	HighCount    int       `json:"high_count"`
	ScannedAt    time.Time `json:"scanned_at"`
}

// GetSecurityScanSummary returns the latest scan metadata for every target
// so audit pages can show current posture on load without a forced re-scan.
// Access control for *which* targets a user may act on is already enforced
// by the servers/resources list endpoints each page calls separately; this
// endpoint just returns scan metadata (never the underlying ResultJSON) for
// the caller to cross-reference by target_id.
func GetSecurityScanSummary(c *gin.Context) {
	var scans []models.SecurityScan
	db.DB.Find(&scans)

	out := make([]SecurityScanSummary, 0, len(scans))
	for _, s := range scans {
		out = append(out, SecurityScanSummary{
			TargetType: s.TargetType, TargetID: s.TargetID, ScanType: s.ScanType,
			FindingCount: s.FindingCount, HighCount: s.HighCount, ScannedAt: s.ScannedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}
