package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/k8s"
	"github.com/infra-eye/backend/internal/logger"
	"github.com/infra-eye/backend/internal/mcp"
	"github.com/infra-eye/backend/internal/metrics"
	"github.com/infra-eye/backend/internal/models"
	sshpool "github.com/infra-eye/backend/internal/ssh"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// HasServerAccess reports whether a user may see the given server.
// Admin and devops bypass grants; other roles need a ServerAccess row.
func HasServerAccess(role string, userID, serverID uint) bool {
	if role == "admin" || role == "devops" {
		return true
	}
	var count int64
	db.DB.Model(&models.ServerAccess{}).Where("server_id = ? AND user_id = ?", serverID, userID).Count(&count)
	return count > 0
}

// DenyWithoutServerAccess aborts the request with 403 unless the requesting
// user (from auth middleware context) has access to the server in the :id
// param. Returns true when the request was aborted.
func DenyWithoutServerAccess(c *gin.Context) bool {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return true
	}
	role := c.GetString("role")
	userID := c.GetUint("user_id")
	if !HasServerAccess(role, userID, uint(id)) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "you have not been granted access to this server"})
		return true
	}
	return false
}

func ListServers(c *gin.Context) {
	role := c.GetString("role")
	userID := c.GetUint("user_id")
	var servers []models.Server
	if role == "admin" || role == "devops" {
		db.DB.Find(&servers)
	} else {
		db.DB.Joins("JOIN server_accesses ON server_accesses.server_id = servers.id AND server_accesses.user_id = ? AND server_accesses.deleted_at IS NULL", userID).
			Find(&servers)
	}
	c.JSON(http.StatusOK, servers)
}

func GetServer(c *gin.Context) {
	if DenyWithoutServerAccess(c) {
		return
	}
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	c.JSON(http.StatusOK, server)
}

// ── Server access grants (per-user RBAC on servers/clusters) ──

type serverAccessRequest struct {
	UserID      uint   `json:"user_id" binding:"required"`
	AccessLevel string `json:"access_level"`
}

func ListServerAccess(c *gin.Context) {
	serverID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}
	var access []models.ServerAccess
	if err := db.DB.Preload("User").Where("server_id = ?", serverID).Find(&access).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load access records"})
		return
	}
	c.JSON(http.StatusOK, access)
}

func CreateServerAccess(c *gin.Context) {
	serverID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}
	var req serverAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.AccessLevel == "" {
		req.AccessLevel = "read"
	}
	var server models.Server
	if err := db.DB.First(&server, serverID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	var user models.User
	if err := db.DB.First(&user, req.UserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	var existing models.ServerAccess
	if err := db.DB.Where("server_id = ? AND user_id = ?", serverID, req.UserID).First(&existing).Error; err == nil {
		existing.AccessLevel = req.AccessLevel
		db.DB.Save(&existing)
		c.JSON(http.StatusOK, existing)
		return
	}
	entry := models.ServerAccess{ServerID: uint(serverID), UserID: req.UserID, AccessLevel: req.AccessLevel}
	if err := db.DB.Create(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create access grant"})
		return
	}
	db.DB.Preload("User").First(&entry, entry.ID)
	c.JSON(http.StatusCreated, entry)
}

func UpdateServerAccess(c *gin.Context) {
	accessID, err := strconv.Atoi(c.Param("accessId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid access id"})
		return
	}
	var req struct {
		AccessLevel string `json:"access_level" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var entry models.ServerAccess
	if err := db.DB.First(&entry, accessID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "access record not found"})
		return
	}
	entry.AccessLevel = req.AccessLevel
	if err := db.DB.Save(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update access"})
		return
	}
	c.JSON(http.StatusOK, entry)
}

func DeleteServerAccess(c *gin.Context) {
	accessID, err := strconv.Atoi(c.Param("accessId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid access id"})
		return
	}
	if err := db.DB.Delete(&models.ServerAccess{}, accessID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke access"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "access revoked"})
}

type serverRequest struct {
	Name        string `json:"name" binding:"required"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	SSHUser     string `json:"ssh_user"`
	SSHKeyPath  string `json:"ssh_key_path"`
	SSHPassword string `json:"ssh_password"`
	AuthType    string `json:"auth_type"`
	Tags        string `json:"tags"`
	Description string `json:"description"`
	KubeConfig  string `json:"kube_config"`
	FolderID    *uint  `json:"folder_id"`
}

func CreateServer(c *gin.Context) {
	var req serverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Port == 0 {
		req.Port = 22
	}
	if req.AuthType == "" {
		req.AuthType = "key"
	}

	server := models.Server{
		Name:        req.Name,
		Host:        req.Host,
		Port:        req.Port,
		SSHUser:     req.SSHUser,
		SSHKeyPath:  req.SSHKeyPath,
		SSHPassword: req.SSHPassword,
		AuthType:    req.AuthType,
		Tags:        req.Tags,
		Description: req.Description,
		KubeConfig:  req.KubeConfig,
		IsK8s:       req.KubeConfig != "",
		Status:      "unknown",
		OS:          "unknown",
		FolderID:    req.FolderID,
	}

	if err := db.DB.Create(&server).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("create server: %v", err)})
		return
	}

	// Start metrics collection in background
	go metrics.StartCollector(server)

	// Sync MCP if it's a K8s cluster
	if server.IsK8s {
		mcp.SyncMasterKubeconfig()
	}

	c.JSON(http.StatusCreated, server)
}

func UpdateServer(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	var req serverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	server.Name = req.Name
	server.Host = req.Host
	server.Port = req.Port
	server.SSHUser = req.SSHUser
	server.Tags = req.Tags
	server.Description = req.Description
	if req.SSHKeyPath != "" {
		server.SSHKeyPath = req.SSHKeyPath
	}
	if req.AuthType != "" {
		server.AuthType = req.AuthType
	}
	server.KubeConfig = req.KubeConfig
	server.IsK8s = req.KubeConfig != ""
	server.FolderID = req.FolderID

	// Remove stale SSH connection
	sshpool.Remove(uint(id))

	db.DB.Save(&server)
	go metrics.StartCollector(server)

	// Sync MCP if K8s related
	if server.IsK8s {
		mcp.SyncMasterKubeconfig()
	}

	c.JSON(http.StatusOK, server)
}

func DeleteServer(c *gin.Context) {
	idStr := c.Param("id")
	id, _ := strconv.Atoi(idStr)

	sshpool.Remove(uint(id))

	// Hard delete the server and all related data (cascading cleanup)
	tx := db.DB.Begin()

	// Delete associatied metrics
	if err := tx.Where("server_id = ?", id).Delete(&models.Metric{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete metrics"})
		return
	}

	// Delete associated logs
	if err := tx.Where("server_id = ?", id).Delete(&models.LogEntry{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete logs"})
		return
	}

	// Delete associated alert rules (Hard Delete)
	if err := tx.Unscoped().Where("server_id = ?", id).Delete(&models.AlertRule{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete alert rules"})
		return
	}

	// Delete associated healing actions
	if err := tx.Where("server_id = ?", id).Delete(&models.HealingAction{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete healing actions"})
		return
	}

	// Finally, Hard Delete the server itself
	if err := tx.Unscoped().Delete(&models.Server{}, id).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete server"})
		return
	}

	tx.Commit()

	// Sync MCP as a cluster might have been removed
	mcp.SyncMasterKubeconfig()

	c.JSON(http.StatusOK, gin.H{"message": "server and all associated data permanently deleted"})
}

func TestServerConnection(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	// Handle Direct K8s API Clusters (Hostless)
	if server.Host == "" {
		clientset, err := k8s.GetK8sClient(server.KubeConfig)
		if err != nil {
			db.DB.Model(&server).Update("status", "offline")
			c.JSON(http.StatusOK, gin.H{"status": "offline", "error": fmt.Sprintf("k8s api unreachable: %v", err)})
			return
		}

		// Try to fetch nodes to verify connectivity and get OS
		nodes, err := clientset.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
		if err != nil {
			db.DB.Model(&server).Update("status", "offline")
			c.JSON(http.StatusOK, gin.H{"status": "offline", "error": fmt.Sprintf("k8s node fetch failed: %v", err)})
			return
		}

		osType := "linux"
		if len(nodes.Items) > 0 {
			osType = strings.ToLower(nodes.Items[0].Status.NodeInfo.OperatingSystem)
		}

		db.DB.Model(&server).Updates(map[string]interface{}{"status": "online", "os": osType})

		// Start metrics collector
		go metrics.StartCollector(server)

		c.JSON(http.StatusOK, gin.H{"status": "online", "output": fmt.Sprintf("k8s api online (%d nodes detected)", len(nodes.Items)), "os": osType})
		return
	}

	// Standard SSH Server logic
	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		db.DB.Model(&server).Update("status", "offline")
		c.JSON(http.StatusOK, gin.H{"status": "offline", "error": err.Error()})
		return
	}

	out, stderr, err := client.RunCommand("uname -s && hostname && uptime")
	if err != nil {
		log.Printf("⚠️ SSH command failed for server %d (%s): %v, stderr: %s", server.ID, server.Host, err, stderr)
	}

	osType := "linux"
	outLower := strings.ToLower(out)
	if strings.Contains(outLower, "darwin") {
		osType = "darwin"
	}
	log.Printf("🔍 Detected OS for server %d: %s (Raw: %q)", server.ID, osType, out)

	db.DB.Model(&server).Updates(map[string]interface{}{"status": "online", "os": osType})

	// Restart the metrics collector so data flows immediately
	go metrics.StartCollector(server)

	c.JSON(http.StatusOK, gin.H{"status": "online", "output": out, "os": osType})
}
func DisconnectServer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		log.Printf("❌ Invalid server ID for disconnect: %q", idStr)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	log.Printf("🔌 Disconnecting server %d...", id)

	// Remove from SSH pool (closes connection)
	sshpool.Remove(uint(id))

	// Stop the metrics collector for this server
	metrics.StopCollector(uint(id))

	// Update DB status to offline
	if err := db.DB.Model(&models.Server{}).Where("id = ?", id).Update("status", "offline").Error; err != nil {
		log.Printf("❌ Failed to update server %d status to offline in DB: %v", id, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update status in database"})
		return
	}

	log.Printf("✅ Server %d disconnected successfully", id)
	c.JSON(http.StatusOK, gin.H{"message": "server disconnected", "status": "offline"})
}

func RebootServer(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid server id"})
		return
	}

	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to connect to server"})
		return
	}

	session, err := client.NewSession()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create ssh session"})
		return
	}
	defer session.Close()

	cmd := "sudo reboot || reboot"
	if server.OS == "darwin" {
		cmd = "sudo shutdown -r now || sudo reboot"
	} else if server.OS == "windows" {
		cmd = "shutdown /r /t 0"
	}

	if server.AuthType == "password" && server.SSHPassword != "" && server.SSHUser != "root" && server.OS != "windows" {
		cmd = fmt.Sprintf("echo '%s' | sudo -S %s", server.SSHPassword, cmd)
	}

	// Trigger reboot async to avoid hang since connection drops
	go func() {
		_ = session.Run(cmd)
	}()

	log.Printf("🔄 Reboot command issued to server %d", server.ID)

	sshpool.Remove(server.ID)
	metrics.StopCollector(server.ID)
	db.DB.Model(&server).Update("status", "offline")

	c.JSON(http.StatusOK, gin.H{"message": "Reboot command issued successfully", "status": "offline"})
}
func DiagnoseServer(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	go func() {
		sid := server.ID
		logger.RecordLog(sid, "diagnostic", "info", "🔍 Starting diagnostic suite...")

		client, err := sshpool.GetOrCreate(sid, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
		if err != nil {
			logger.RecordLog(sid, "diagnostic", "error", fmt.Sprintf("❌ SSH Connection failed: %v", err))
			return
		}
		logger.RecordLog(sid, "diagnostic", "info", "✅ SSH Connectivity verified.")

		// Disk Check
		logger.RecordLog(sid, "diagnostic", "info", "💾 Checking disk usage...")
		diskOut, _, err := client.RunCommand("df -h / | tail -1 | awk '{print $5}' | tr -d '%'")
		if err == nil {
			usage, _ := strconv.Atoi(strings.TrimSpace(diskOut))
			if usage > 90 {
				logger.RecordLog(sid, "diagnostic", "error", fmt.Sprintf("🚨 CRITICAL: Root partition is %d%% full!", usage))
			} else if usage > 75 {
				logger.RecordLog(sid, "diagnostic", "warn", fmt.Sprintf("⚠️ WARNING: Root partition is %d%% full.", usage))
			} else {
				logger.RecordLog(sid, "diagnostic", "info", fmt.Sprintf("✅ Disk space OK (%d%% used).", usage))
			}
		}

		// Memory Check
		logger.RecordLog(sid, "diagnostic", "info", "🧠 Checking memory pressure...")
		if server.OS != "darwin" {
			memOut, _, err := client.RunCommand("free -m | grep Mem | awk '{print $3/$2*100}'")
			if err == nil {
				usage, _ := strconv.ParseFloat(strings.TrimSpace(memOut), 64)
				if usage > 90 {
					logger.RecordLog(sid, "diagnostic", "error", fmt.Sprintf("🚨 CRITICAL: Memory usage is %.1f%%!", usage))
				} else {
					logger.RecordLog(sid, "diagnostic", "info", fmt.Sprintf("✅ Memory pressure OK (%.1f%% used).", usage))
				}
			}
		}

		// Network Check
		logger.RecordLog(sid, "diagnostic", "info", "🌐 Testing network reachability (google.com)...")
		_, _, err = client.RunCommand("ping -c 1 google.com")
		if err != nil {
			logger.RecordLog(sid, "diagnostic", "error", "❌ Outside world unreachable (ping google.com failed).")
		} else {
			logger.RecordLog(sid, "diagnostic", "info", "✅ Outside world is reachable.")
		}

		// OS Specific Checks
		if server.OS == "linux" {
			logger.RecordLog(sid, "diagnostic", "info", "🐧 Checking critical services (Linux)...")
			services := []string{"docker", "kubelet", "sshd"}
			for _, s := range services {
				status, _, _ := client.RunCommand(fmt.Sprintf("systemctl is-active %s", s))
				if strings.TrimSpace(status) == "active" {
					logger.RecordLog(sid, "diagnostic", "info", fmt.Sprintf("✅ Service %s is running.", s))
				} else {
					logger.RecordLog(sid, "diagnostic", "warn", fmt.Sprintf("⚠️ Service %s is NOT active (%s).", s, strings.TrimSpace(status)))
				}
			}
		}

		logger.RecordLog(sid, "diagnostic", "info", "🏁 Diagnostic suite completed.")
	}()

	c.JSON(http.StatusAccepted, gin.H{"message": "Diagnostic sequence initiated"})
}

// UpdateServerPreferences — PATCH /api/servers/:id/preferences
// Updates display-only fields (name, tags, description) without touching SSH credentials.
func UpdateServerPreferences(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	var req struct {
		Name        string `json:"name"`
		Tags        string `json:"tags"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	updates["tags"] = req.Tags
	updates["description"] = req.Description

	if err := db.DB.Model(&server).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update preferences"})
		return
	}
	// Reload and return
	db.DB.First(&server, id)
	c.JSON(http.StatusOK, server)
}

// ClearServerMetrics — DELETE /api/servers/:id/metrics
// Permanently purges all metric history for a server.
func ClearServerMetrics(c *gin.Context) {
	id := c.Param("id")
	if err := db.DB.Where("server_id = ?", id).Delete(&models.Metric{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to purge metrics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "metric history purged"})
}

// MoveServerFolder — PATCH /api/servers/:id/folder
// Reassigns a server (or cluster, since clusters are servers with is_k8s=true)
// to a different folder without touching any other field. folder_id: null clears it.
func MoveServerFolder(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	var req struct {
		FolderID *uint `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.FolderID != nil {
		if err := db.DB.First(&models.Folder{}, *req.FolderID).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
			return
		}
	}
	if err := db.DB.Model(&server).Updates(map[string]interface{}{"folder_id": req.FolderID}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to move server"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "moved", "folder_id": req.FolderID})
}
