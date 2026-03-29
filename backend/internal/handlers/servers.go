package handlers

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/metrics"
	sshpool "github.com/infra-eye/backend/internal/ssh"
)

func ListServers(c *gin.Context) {
	var servers []models.Server
	db.DB.Find(&servers)
	c.JSON(http.StatusOK, servers)
}

func GetServer(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}
	c.JSON(http.StatusOK, server)
}

type serverRequest struct {
	Name        string `json:"name" binding:"required"`
	Host        string `json:"host" binding:"required"`
	Port        int    `json:"port"`
	SSHUser     string `json:"ssh_user" binding:"required"`
	SSHKeyPath  string `json:"ssh_key_path"`
	SSHPassword string `json:"ssh_password"`
	AuthType    string `json:"auth_type"`
	Tags        string `json:"tags"`
	Description string `json:"description"`
	KubeConfig  string `json:"kube_config"`
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
		Status:      "unknown",
	}

	if err := db.DB.Create(&server).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("create server: %v", err)})
		return
	}

	// Start metrics collection in background
	go metrics.StartCollector(server)

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

	// Remove stale SSH connection
	sshpool.Remove(uint(id))

	db.DB.Save(&server)
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
	c.JSON(http.StatusOK, gin.H{"message": "server and all associated data permanently deleted"})
}

func TestServerConnection(c *gin.Context) {
	id := c.Param("id")
	var server models.Server
	if err := db.DB.First(&server, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "server not found"})
		return
	}

	client, err := sshpool.GetOrCreate(server.ID, server.Host, server.Port, server.SSHUser, server.SSHKeyPath, server.SSHPassword, server.AuthType)
	if err != nil {
		db.DB.Model(&server).Update("status", "offline")
		c.JSON(http.StatusOK, gin.H{"status": "offline", "error": err.Error()})
		return
	}

	out, _ := client.RunCommand("hostname && uptime")
	db.DB.Model(&server).Update("status", "online")
	c.JSON(http.StatusOK, gin.H{"status": "online", "output": out})
}
