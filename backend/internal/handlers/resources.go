package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
)

type queryRequest struct {
	SQL string `json:"sql" binding:"required"`
}

type resourceRequest struct {
	Name         string `json:"name" binding:"required"`
	Description  string `json:"description"`
	Tags         string `json:"tags"`
	ResourceType string `json:"resource_type"`
	Protocol     string `json:"protocol"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	Username     string `json:"username"`
	Password     string `json:"password"`
	Secret       string `json:"secret"`
	AuthType     string `json:"auth_type"`
	UseGateway   *bool  `json:"use_gateway"`
	Database     string `json:"database"`
	FolderID     *uint  `json:"folder_id"`
}

type resourceAccessRequest struct {
	UserID      uint   `json:"user_id" binding:"required"`
	AccessLevel string `json:"access_level" binding:"required,oneof=read write admin"`
}

func ListResources(c *gin.Context) {
	var resourcesList []models.Resource
	db.DB.Find(&resourcesList)
	c.JSON(http.StatusOK, resourcesList)
}

func GetResource(c *gin.Context) {
	id := c.Param("id")
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}
	c.JSON(http.StatusOK, resource)
}

func CreateResource(c *gin.Context) {
	var req resourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Protocol == "" {
		req.Protocol = "tcp"
	}
	if req.AuthType == "" {
		req.AuthType = "none"
	}
	useGateway := true
	if req.UseGateway != nil {
		useGateway = *req.UseGateway
	}

	resource := models.Resource{
		Name:         req.Name,
		Description:  req.Description,
		Tags:         req.Tags,
		ResourceType: req.ResourceType,
		Protocol:     req.Protocol,
		Host:         req.Host,
		Port:         req.Port,
		Username:     req.Username,
		Password:     req.Password,
		Secret:       req.Secret,
		AuthType:     req.AuthType,
		UseGateway:   useGateway,
		Status:       "unknown",
		Database:     req.Database,
		FolderID:     req.FolderID,
	}

	if err := db.DB.Create(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("create resource: %v", err)})
		return
	}

	c.JSON(http.StatusCreated, resource)
}

func UpdateResource(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}

	var req resourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resource.Name = req.Name
	resource.Description = req.Description
	resource.Tags = req.Tags
	resource.ResourceType = req.ResourceType
	resource.Protocol = req.Protocol
	resource.Host = req.Host
	resource.Port = req.Port
	resource.Username = req.Username
	if req.Password != "" {
		resource.Password = req.Password
	}
	if req.Secret != "" {
		resource.Secret = req.Secret
	}
	if req.AuthType != "" {
		resource.AuthType = req.AuthType
	}
	if req.UseGateway != nil {
		resource.UseGateway = *req.UseGateway
	}
	resource.Database = req.Database
	resource.FolderID = req.FolderID

	if err := db.DB.Save(&resource).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("update resource: %v", err)})
		return
	}

	c.JSON(http.StatusOK, resource)
}

func DeleteResource(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}

	if err := db.DB.Where("resource_id = ?", id).Delete(&models.ResourceAccess{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove resource access records"})
		return
	}
	if err := db.DB.Where("resource_id = ?", id).Delete(&models.ResourceAudit{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove resource audit records"})
		return
	}
	if err := db.DB.Delete(&models.Resource{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete resource"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "resource deleted"})
}

func ListResourceAccess(c *gin.Context) {
	resourceID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}

	if err := ensureResourceTables(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to ensure resource tables: %v", err)})
		return
	}

	var access []models.ResourceAccess
	if err := db.DB.Preload("User").Where("resource_id = ?", resourceID).Find(&access).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to load access records: %v", err)})
		return
	}

	c.JSON(http.StatusOK, access)
}

func CreateResourceAccess(c *gin.Context) {
	resourceID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}

	var req resourceAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var resource models.Resource
	if err := db.DB.First(&resource, resourceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}

	var user models.User
	if err := db.DB.First(&user, req.UserID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var existing models.ResourceAccess
	if err := db.DB.Where("resource_id = ? AND user_id = ?", resourceID, req.UserID).First(&existing).Error; err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "user already has access to this resource"})
		return
	}

	entry := models.ResourceAccess{
		ResourceID:  uint(resourceID),
		UserID:      req.UserID,
		AccessLevel: req.AccessLevel,
	}
	if err := db.DB.Create(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to assign access"})
		return
	}

	logResourceAudit(c, uint(resourceID), req.UserID, "grant_access", gin.H{"access_level": req.AccessLevel, "message": "granted access level"})
	c.JSON(http.StatusCreated, entry)
}

func UpdateResourceAccess(c *gin.Context) {
	accessID, err := strconv.Atoi(c.Param("accessId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid access id"})
		return
	}

	var req resourceAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var entry models.ResourceAccess
	if err := db.DB.First(&entry, accessID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "access record not found"})
		return
	}

	entry.AccessLevel = req.AccessLevel
	if err := db.DB.Save(&entry).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update access"})
		return
	}

	logResourceAudit(c, entry.ResourceID, entry.UserID, "update_access", gin.H{"access_level": req.AccessLevel, "message": "updated access level"})
	c.JSON(http.StatusOK, entry)
}

func DeleteResourceAccess(c *gin.Context) {
	accessID, err := strconv.Atoi(c.Param("accessId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid access id"})
		return
	}

	var entry models.ResourceAccess
	if err := db.DB.First(&entry, accessID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "access record not found"})
		return
	}

	if err := db.DB.Delete(&models.ResourceAccess{}, accessID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke access"})
		return
	}

	logResourceAudit(c, entry.ResourceID, entry.UserID, "revoke_access", gin.H{"status": "revoked", "message": "revoked user access"})
	c.JSON(http.StatusOK, gin.H{"message": "access revoked"})
}

func ListResourceAudit(c *gin.Context) {
	resourceID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}

	if err := ensureResourceTables(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to ensure resource tables: %v", err)})
		return
	}

	limitStr := c.DefaultQuery("limit", "200")
	limit, _ := strconv.Atoi(limitStr)
	since := c.Query("since")
	until := c.Query("until")

	query := db.DB.Where("resource_id = ?", resourceID)

	if since != "" {
		query = query.Where("created_at >= ?", since)
	}
	if until != "" {
		query = query.Where("created_at <= ?", until)
	}

	var audits []models.ResourceAudit
	if err := query.Order("created_at desc").Limit(limit).Find(&audits).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to load audit logs: %v", err)})
		return
	}

	c.JSON(http.StatusOK, audits)
}

func ensureResourceTables() error {
	return db.DB.AutoMigrate(&models.ResourceAccess{}, &models.ResourceAudit{})
}

func logResourceAudit(c *gin.Context, resourceID, userID uint, action string, details interface{}) {
	detailsJSON, _ := json.Marshal(details)
	username, _ := c.Get("username")
	performedBy, _ := username.(string)
	audit := models.ResourceAudit{
		ResourceID:  resourceID,
		UserID:      userID,
		Action:      action,
		Details:     string(detailsJSON),
		PerformedBy: performedBy,
	}
	db.DB.Create(&audit)
}

func TestResourceConnection(c *gin.Context) {
	id := c.Param("id")
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}

	if resource.Host == "" || resource.Port == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resource host and port are required"})
		return
	}

	// A test is a full observability probe: it records a history sample, updates
	// the live status, and returns the type-specific metrics it gathered.
	res := resources.CollectOne(resource)
	payload := gin.H{
		"status":     res.Status,
		"latency_ms": res.LatencyMs,
		"metrics":    res.Metrics,
	}
	if res.Error != "" {
		payload["error"] = res.Error
	} else {
		payload["message"] = "resource connection verified"
	}
	c.JSON(http.StatusOK, payload)
}

// ObserveResource forces a fresh probe and returns the live snapshot. Used by the
// detail page's Observability tab for an immediate reading.
func ObserveResource(c *gin.Context) {
	id := c.Param("id")
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}
	if resource.Host == "" || resource.Port == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resource host and port are required"})
		return
	}
	res := resources.CollectOne(resource)
	c.JSON(http.StatusOK, res)
}

// ListResourceMetrics returns the health/observability history for a resource
// within the requested window (default 60 minutes), oldest-first for charting.
func ListResourceMetrics(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resource id"})
		return
	}
	minutes, _ := strconv.Atoi(c.DefaultQuery("minutes", "60"))
	if minutes <= 0 {
		minutes = 60
	}
	since := time.Now().Add(-time.Duration(minutes) * time.Minute)

	var rows []models.ResourceMetric
	if err := db.DB.Where("resource_id = ? AND timestamp >= ?", id, since).
		Order("timestamp asc").Limit(2000).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to load metrics: %v", err)})
		return
	}
	c.JSON(http.StatusOK, rows)
}

// resolveEffectiveAccess returns the caller's effective access level
// ("read"|"write"|"admin") for a resource. The admin/devops role already
// gates every resource route today (see routes.go), so those callers always
// resolve to "admin" here — this doesn't change behavior for them, it's
// forward-compatible plumbing for the day a less-privileged role (trainee)
// is allowed onto these routes with real per-resource grants, at which point
// this already does the right thing: fall back to their ResourceAccess row,
// or "read" if none exists.
func resolveEffectiveAccess(c *gin.Context, resourceID uint) string {
	if role, _ := c.Get("role"); role == "admin" || role == "devops" {
		return "admin"
	}
	userID, _ := c.Get("user_id")
	uid, ok := userID.(uint)
	if !ok {
		return "read"
	}
	var access models.ResourceAccess
	if err := db.DB.Where("resource_id = ? AND user_id = ?", resourceID, uid).First(&access).Error; err != nil {
		return "read"
	}
	return access.AccessLevel
}

func requireWriteAccess(c *gin.Context, resourceID uint) bool {
	level := resolveEffectiveAccess(c, resourceID)
	if level != "write" && level != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "read-only access to this resource"})
		return false
	}
	return true
}

func currentUserID(c *gin.Context) uint {
	userID, _ := c.Get("user_id")
	uid, _ := userID.(uint)
	return uid
}

func QueryResource(c *gin.Context) {
	id := c.Param("id")
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
		return
	}

	var req queryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !resources.IsPostgres(resource.Protocol) && !resources.IsMySQL(resource.Protocol) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only postgres and mysql are supported for querying currently"})
		return
	}

	query := strings.TrimSpace(req.SQL)
	isSelect := strings.HasPrefix(strings.ToUpper(query), "SELECT")
	if !isSelect && !requireWriteAccess(c, uint(resource.ID)) {
		return
	}

	sqlDB, err := resources.OpenSQL(c.Request.Context(), resource)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	defer sqlDB.Close()

	if isSelect {
		rows, err := sqlDB.Query(query)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("query failed: %v", err)})
			return
		}
		defer rows.Close()

		columns, _ := rows.Columns()
		var result []map[string]interface{}

		for rows.Next() {
			values := make([]interface{}, len(columns))
			valuePtrs := make([]interface{}, len(columns))
			for i := range columns {
				valuePtrs[i] = &values[i]
			}

			if err := rows.Scan(valuePtrs...); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("scan failed: %v", err)})
				return
			}

			row := make(map[string]interface{})
			for i, col := range columns {
				val := values[i]
				b, ok := val.([]byte)
				if ok {
					row[col] = string(b)
				} else {
					row[col] = val
				}
			}
			result = append(result, row)
		}
		c.JSON(http.StatusOK, gin.H{"type": "select", "columns": columns, "rows": result})
	} else {
		res, err := sqlDB.Exec(query)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("execution failed: %v", err)})
			return
		}
		affected, _ := res.RowsAffected()
		c.JSON(http.StatusOK, gin.H{"type": "exec", "rows_affected": affected})
	}

	logResourceAudit(c, uint(resource.ID), currentUserID(c), "query_resource", gin.H{"sql": query, "message": "executed sql query"})
}

// MoveResourceFolder — PATCH /api/resources/:id/folder
// Reassigns a resource to a different folder without touching any other field.
// folder_id: null clears it.
func MoveResourceFolder(c *gin.Context) {
	id := c.Param("id")
	var resource models.Resource
	if err := db.DB.First(&resource, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "resource not found"})
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
	if err := db.DB.Model(&resource).Updates(map[string]interface{}{"folder_id": req.FolderID}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to move resource"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "moved", "folder_id": req.FolderID})
}
