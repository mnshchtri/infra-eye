package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"github.com/infra-eye/backend/internal/resources"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
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

	ctx := context.Background()
	var err error
	if strings.EqualFold(resource.Protocol, "http") || strings.EqualFold(resource.Protocol, "https") {
		err = resources.HTTPReachable(ctx, resource.Host, resource.Port, resource.Protocol, resource.UseGateway)
	} else {
		conn, dialErr := resources.DialResource(resource.Host, resource.Port, resource.UseGateway)
		if dialErr != nil {
			err = dialErr
		} else {
			conn.Close()
		}
	}

	status := "online"
	if err != nil {
		status = "offline"
		db.DB.Model(&resource).Update("status", status)
		c.JSON(http.StatusOK, gin.H{"status": status, "error": err.Error()})
		return
	}

	db.DB.Model(&resource).Update("status", status)
	c.JSON(http.StatusOK, gin.H{"status": status, "message": "resource connection verified"})
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

	// Only support Postgres for now
	if !strings.EqualFold(resource.Protocol, "postgres") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only postgres protocol is supported for querying currently"})
		return
	}

	dbName := resource.Database
	if dbName == "" {
		dbName = "postgres"
	}
	// Build DSN
	// If the user is using host.docker.internal, it should work from the container.
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		resource.Username, resource.Password, resource.Host, resource.Port, dbName)

	// Use a temporary GORM instance to execute
	targetDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("connect to target: %v", err)})
		return
	}
	sqlDB, _ := targetDB.DB()
	defer sqlDB.Close()

	// Execute query
	query := strings.TrimSpace(req.SQL)
	isSelect := strings.HasPrefix(strings.ToUpper(query), "SELECT")

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

	logResourceAudit(c, uint(resource.ID), 0, "query_resource", gin.H{"sql": query, "message": "executed sql query"})
}
