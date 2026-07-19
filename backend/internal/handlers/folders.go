package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
)

func ListFolders(c *gin.Context) {
	var folders []models.Folder
	db.DB.Order("name asc").Find(&folders)
	c.JSON(http.StatusOK, folders)
}

type folderRequest struct {
	Name  string `json:"name" binding:"required"`
	Color string `json:"color"`
}

func CreateFolder(c *gin.Context) {
	var req folderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Color == "" {
		req.Color = "#2b9af3"
	}
	folder := models.Folder{Name: req.Name, Color: req.Color}
	if err := db.DB.Create(&folder).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create folder"})
		return
	}
	c.JSON(http.StatusCreated, folder)
}

func UpdateFolder(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder id"})
		return
	}
	var folder models.Folder
	if err := db.DB.First(&folder, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		return
	}
	var req folderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	folder.Name = req.Name
	if req.Color != "" {
		folder.Color = req.Color
	}
	db.DB.Save(&folder)
	c.JSON(http.StatusOK, folder)
}

// DeleteFolder removes a folder. Servers and resources filed under it are not
// deleted — they simply become unassigned (folder_id set to NULL).
func DeleteFolder(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid folder id"})
		return
	}
	if err := db.DB.First(&models.Folder{}, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "folder not found"})
		return
	}
	db.DB.Model(&models.Server{}).Where("folder_id = ?", id).Update("folder_id", nil)
	db.DB.Model(&models.Resource{}).Where("folder_id = ?", id).Update("folder_id", nil)
	if err := db.DB.Delete(&models.Folder{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete folder"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "folder deleted, contents unassigned"})
}
