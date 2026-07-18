package handlers

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/middleware"
	"github.com/infra-eye/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// OIDC Discovery Document structure
type OIDCDiscovery struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JwksURI               string `json:"jwks_uri"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
}

// OIDC Token Response
type OIDCTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
}

// OIDC User Info
type OIDCUserInfo struct {
	Sub               string   `json:"sub"`
	Email             string   `json:"email"`
	EmailVerified     bool     `json:"email_verified"`
	Name              string   `json:"name"`
	PreferredUsername string   `json:"preferred_username"`
	GivenName         string   `json:"given_name"`
	FamilyName        string   `json:"family_name"`
	Groups            []string `json:"groups"`
	Roles             []string `json:"roles"`
}

var oidcDiscovery *OIDCDiscovery

// Initialize OIDC discovery
func InitOIDC() error {
	if !config.C.OIDCEnabled {
		log.Println("OIDC is disabled")
		return nil
	}

	discoveryURL := strings.TrimSuffix(config.C.OIDCIssuerURL, "/") + "/.well-known/openid-configuration"
	log.Printf("Fetching OIDC discovery document from: %s", discoveryURL)

	resp, err := http.Get(discoveryURL)
	if err != nil {
		return fmt.Errorf("failed to fetch OIDC discovery: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("OIDC discovery returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read OIDC discovery response: %w", err)
	}

	var discovery OIDCDiscovery
	if err := json.Unmarshal(body, &discovery); err != nil {
		return fmt.Errorf("failed to parse OIDC discovery: %w", err)
	}

	oidcDiscovery = &discovery
	log.Printf("OIDC initialized successfully with issuer: %s", discovery.Issuer)
	return nil
}

// Generate random state for OIDC flow
func generateState() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

// OIDCLogin initiates the OIDC login flow
func OIDCLogin(c *gin.Context) {
	if !config.C.OIDCEnabled || oidcDiscovery == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OIDC is not configured"})
		return
	}

	state := generateState()
	
	// Store state in session/cookie for validation (in production, use Redis)
	c.SetCookie("oidc_state", state, 600, "/", "", false, true)

	scopes := strings.Split(config.C.OIDCScopes, " ")
	scopeStr := strings.Join(scopes, " ")

	authURL := fmt.Sprintf("%s?client_id=%s&response_type=code&redirect_uri=%s&scope=%s&state=%s",
		oidcDiscovery.AuthorizationEndpoint,
		url.QueryEscape(config.C.OIDCClientID),
		url.QueryEscape(config.C.OIDCRedirectURL),
		url.QueryEscape(scopeStr),
		url.QueryEscape(state),
	)

	c.JSON(http.StatusOK, gin.H{
		"authorization_url": authURL,
	})
}

// OIDCCallback handles the OIDC callback
func OIDCCallback(c *gin.Context) {
	if !config.C.OIDCEnabled || oidcDiscovery == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OIDC is not configured"})
		return
	}

	code := c.Query("code")
	state := c.Query("state")
	
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "authorization code is missing"})
		return
	}

	// Validate state (in production, compare with stored state)
	storedState, err := c.Cookie("oidc_state")
	if err != nil || storedState != state {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state parameter"})
		return
	}

	// Exchange code for tokens
	tokenResp, err := exchangeCodeForToken(code)
	if err != nil {
		log.Printf("Failed to exchange code for token: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token exchange failed"})
		return
	}

	// Get user info
	userInfo, err := fetchUserInfo(tokenResp.AccessToken)
	if err != nil {
		log.Printf("Failed to fetch user info: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch user info"})
		return
	}

	// Create or update user in database
	user, err := syncOIDCUser(userInfo)
	if err != nil {
		log.Printf("Failed to sync OIDC user: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user sync failed"})
		return
	}

	// Generate internal JWT token
	claims := &middleware.Claims{
		UserID:   user.ID,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(config.C.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token signing failed"})
		return
	}

	// Clear state cookie
	c.SetCookie("oidc_state", "", -1, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{
		"token": signed,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"role":     user.Role,
			"email":    user.Email,
		},
	})
}

// Exchange authorization code for access token
func exchangeCodeForToken(code string) (*OIDCTokenResponse, error) {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", config.C.OIDCRedirectURL)
	data.Set("client_id", config.C.OIDCClientID)
	data.Set("client_secret", config.C.OIDCClientSecret)

	req, err := http.NewRequest("POST", oidcDiscovery.TokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token endpoint returned status %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp OIDCTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, err
	}

	return &tokenResp, nil
}

// Fetch user info from OIDC provider
func fetchUserInfo(accessToken string) (*OIDCUserInfo, error) {
	req, err := http.NewRequest("GET", oidcDiscovery.UserinfoEndpoint, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("userinfo endpoint returned status %d", resp.StatusCode)
	}

	var userInfo OIDCUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}

	return &userInfo, nil
}

// Sync OIDC user with local database
func syncOIDCUser(userInfo *OIDCUserInfo) (*models.User, error) {
	var user models.User
	
	// Try to find user by email or username
	username := userInfo.PreferredUsername
	if username == "" {
		username = userInfo.Email
	}

	err := db.DB.Where("email = ? OR username = ?", userInfo.Email, username).First(&user).Error
	
	if err != nil {
		// User doesn't exist, create new one
		role := mapOIDCRoleToInfraEye(userInfo)
		
		// Generate a random password (won't be used for OIDC users)
		randomPassword := make([]byte, 32)
		rand.Read(randomPassword)
		passwordHash, _ := bcrypt.GenerateFromPassword(randomPassword, bcrypt.DefaultCost)

		user = models.User{
			Username:     username,
			Email:        userInfo.Email,
			PasswordHash: string(passwordHash),
			Role:         role,
			IsActive:     true,
		}

		if err := db.DB.Create(&user).Error; err != nil {
			return nil, fmt.Errorf("failed to create user: %w", err)
		}

		log.Printf("Created new OIDC user: %s (email: %s, role: %s)", username, userInfo.Email, role)
	} else {
		// User exists, update role if needed
		newRole := mapOIDCRoleToInfraEye(userInfo)
		if user.Role != newRole {
			user.Role = newRole
			db.DB.Save(&user)
			log.Printf("Updated role for user %s: %s -> %s", username, user.Role, newRole)
		}
	}

	return &user, nil
}

// Map OIDC roles/groups to InfraEye roles
func mapOIDCRoleToInfraEye(userInfo *OIDCUserInfo) string {
	// Check groups first (common in Keycloak)
	for _, group := range userInfo.Groups {
		groupLower := strings.ToLower(group)
		if strings.Contains(groupLower, "admin") || strings.Contains(groupLower, "infraeye-admin") {
			return "admin"
		}
		if strings.Contains(groupLower, "devops") || strings.Contains(groupLower, "infraeye-devops") {
			return "devops"
		}
		if strings.Contains(groupLower, "trainee") || strings.Contains(groupLower, "infraeye-trainee") {
			return "trainee"
		}
	}

	// Check roles
	for _, role := range userInfo.Roles {
		roleLower := strings.ToLower(role)
		if strings.Contains(roleLower, "admin") {
			return "admin"
		}
		if strings.Contains(roleLower, "devops") {
			return "devops"
		}
		if strings.Contains(roleLower, "trainee") {
			return "trainee"
		}
	}

	// Default to intern
	return "intern"
}

// GetOIDCConfig returns OIDC configuration for frontend
func GetOIDCConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"enabled":    config.C.OIDCEnabled,
		"issuer_url": config.C.OIDCIssuerURL,
		"client_id":  config.C.OIDCClientID,
	})
}
