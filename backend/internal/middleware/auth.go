package middleware

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/infra-eye/backend/internal/config"
	"github.com/infra-eye/backend/internal/db"
	"github.com/infra-eye/backend/internal/models"
	"gorm.io/gorm"
)

type Claims struct {
	UserID   uint   `json:"user_id"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func Auth() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenRaw := ""
		header := c.GetHeader("Authorization")
		if header != "" {
			parts := strings.SplitN(header, " ", 2)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				tokenRaw = parts[1]
			}
		}

		// Fallback to query parameter (required for WebSockets)
		if tokenRaw == "" {
			tokenRaw = c.Query("token")
		}

		if tokenRaw == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization token"})
			return
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenRaw, claims, func(t *jwt.Token) (interface{}, error) {
			return []byte(config.C.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired token"})
			return
		}

		// Tokens live 24h, so trusting the JWT alone would leave a deactivated
		// account — or a demoted one — with its old access for up to a day.
		// Re-read the account on each request instead.
		//
		// This covers HTTP requests only. A WebSocket authenticates once at the
		// upgrade handshake and then runs its own read loop, so an already-open
		// terminal or log stream survives until the socket closes.
		var user models.User
		if err := db.DB.Select("id", "role", "is_active").First(&user, claims.UserID).Error; err != nil {
			// Only a genuinely missing row means the account is gone. Every other
			// error here is a database problem (connection reset, timeout, pool
			// exhaustion), and answering those with 401 would be actively harmful:
			// the frontend clears the token and redirects to /login on any 401, so
			// one transient blip would sign out every operator at once — precisely
			// when they need to be signed in. Fail with 500 and keep the session.
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "account no longer exists"})
				return
			}
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "failed to verify account: " + err.Error()})
			return
		}
		if !user.IsActive {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "account is deactivated"})
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		// The stored role, not the one baked into the token, so a promotion or
		// demotion applies on the very next request rather than at next login.
		c.Set("role", user.Role)
		c.Next()
	}
}

// RequireRole blocks requests whose role is not in the allowed list.
// Usage: middleware.RequireRole("admin", "devops")
func RequireRole(allowed ...string) gin.HandlerFunc {
	set := make(map[string]struct{}, len(allowed))
	for _, r := range allowed {
		set[r] = struct{}{}
	}
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		roleStr, _ := role.(string)
		if _, ok := set[roleStr]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":           "access denied: insufficient role",
				"required_one_of": allowed,
				"your_role":       roleStr,
			})
			return
		}
		c.Next()
	}
}

// AdminOnly is a convenience wrapper around RequireRole("admin").
func AdminOnly() gin.HandlerFunc {
	return RequireRole("admin")
}
