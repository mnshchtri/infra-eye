package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
)

func ListAlertRules(c *gin.Context) {
	var rules []models.AlertRule
	serverID := c.Query("server_id")
	query := db.DB
	if serverID != "" {
		query = query.Where("server_id = ? OR server_id = 0", serverID)
	}
	query.Find(&rules)
	c.JSON(http.StatusOK, rules)
}

func GetAlertRule(c *gin.Context) {
	id := c.Param("id")
	var rule models.AlertRule
	if err := db.DB.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

type alertRuleRequest struct {
	Name            string `json:"name" binding:"required"`
	ServerID        uint   `json:"server_id"`
	ConditionType   string `json:"condition_type" binding:"required"`
	ConditionOp     string `json:"condition_op" binding:"required"`
	ConditionValue  string `json:"condition_value" binding:"required"`
	Severity        string `json:"severity"`
	ActionType      string `json:"action_type" binding:"required"`
	ActionCommand   string `json:"action_command"`
	CooldownMinutes int    `json:"cooldown_minutes"`
	Enabled         bool   `json:"enabled"`
	Description     string `json:"description"`
}

func CreateAlertRule(c *gin.Context) {
	var req alertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Severity == "" {
		req.Severity = "warning"
	}
	if req.CooldownMinutes == 0 {
		req.CooldownMinutes = 5
	}

	rule := models.AlertRule{
		Name:            req.Name,
		ServerID:        req.ServerID,
		ConditionType:   req.ConditionType,
		ConditionOp:     req.ConditionOp,
		ConditionValue:  req.ConditionValue,
		Severity:        req.Severity,
		ActionType:      req.ActionType,
		ActionCommand:   req.ActionCommand,
		CooldownMinutes: req.CooldownMinutes,
		Enabled:         req.Enabled,
		Description:     req.Description,
	}

	if err := db.DB.Create(&rule).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rule)
}

func UpdateAlertRule(c *gin.Context) {
	id := c.Param("id")
	var rule models.AlertRule
	if err := db.DB.First(&rule, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	var req alertRuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.Name = req.Name
	rule.ServerID = req.ServerID
	rule.ConditionType = req.ConditionType
	rule.ConditionOp = req.ConditionOp
	rule.ConditionValue = req.ConditionValue
	rule.Severity = req.Severity
	rule.ActionType = req.ActionType
	rule.ActionCommand = req.ActionCommand
	rule.CooldownMinutes = req.CooldownMinutes
	rule.Enabled = req.Enabled
	rule.Description = req.Description

	db.DB.Save(&rule)
	c.JSON(http.StatusOK, rule)
}

func DeleteAlertRule(c *gin.Context) {
	id := c.Param("id")
	if err := db.DB.Unscoped().Delete(&models.AlertRule{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete rule"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "rule permanently deleted"})
}

func ListHealingActions(c *gin.Context) {
	var actions []models.HealingAction
	serverID := c.Query("server_id")
	query := db.DB.Order("created_at DESC")
	if serverID != "" {
		query = query.Where("server_id = ?", serverID)
	}
	query.Limit(100).Find(&actions)
	c.JSON(http.StatusOK, actions)
}

func ClearHealingHistory(c *gin.Context) {
	serverID := c.Query("server_id")
	query := db.DB
	if serverID != "" {
		query = query.Where("server_id = ?", serverID)
	}
	if err := query.Exec("DELETE FROM healing_actions").Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear history"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "history cleared"})
}
