package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

const devJWTSecret = "dev-secret-change-in-production"

type Config struct {
	Port                  string
	Env                   string
	DBDriver              string
	DBDSN                 string
	RedisAddr             string
	JWTSecret             string
	OpenAIKey             string
	GeminiKey             string
	DeepSeekKey           string
	OpenRouterKey         string
	MistralKey            string
	LocalLLMURL           string
	LocalLLMModel         string
	ResourceGatewayURL    string
	ResourceGatewayToken  string
	MetricsInterval       int
	LogMaxLines           int
	GoogleChatWebhookURL  string
	SlackWebhookURL       string
	MCPServerURL          string
	
	// OIDC Configuration
	OIDCEnabled       bool
	OIDCIssuerURL     string
	OIDCClientID      string
	OIDCClientSecret  string
	OIDCRedirectURL   string
	OIDCScopes        string
}

var C Config

func Load() {
	// Load .env if present (dev convenience)
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	C = Config{
		Port:            getEnv("PORT", "8080"),
		Env:             getEnv("ENV", "development"),
		DBDriver:        getEnv("DB_DRIVER", "postgres"),
		DBDSN:           getEnv("DB_DSN", "postgresql://infraeye:infraeye123@localhost:5432/infraeye?sslmode=disable"),
		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		JWTSecret:       getEnv("JWT_SECRET", devJWTSecret),
		OpenAIKey:       getEnv("OPENAI_API_KEY", ""),
		GeminiKey:       getEnv("GEMINI_API_KEY", ""),
		DeepSeekKey:     getEnv("DEEPSEEK_API_KEY", ""),
		OpenRouterKey:   getEnv("OPENROUTER_API_KEY", ""),
		MistralKey:      getEnv("MISTRAL_API_KEY", ""),
		LocalLLMURL:     getEnv("LOCAL_LLM_URL", ""),
		LocalLLMModel:   getEnv("LOCAL_LLM_MODEL", "llama3.2"),
		MetricsInterval: getEnvInt("METRICS_INTERVAL", 30),
		LogMaxLines:            getEnvInt("LOG_MAX_LINES", 500),
		GoogleChatWebhookURL:   getEnv("GOOGLE_CHAT_WEBHOOK_URL", ""),
		SlackWebhookURL:        getEnv("SLACK_WEBHOOK_URL", ""),
		ResourceGatewayURL:    getEnv("RESOURCE_GATEWAY_URL", ""),
		ResourceGatewayToken:  getEnv("RESOURCE_GATEWAY_TOKEN", ""),
		MCPServerURL:          getEnv("MCP_SERVER_URL", "http://localhost:8090"),
		
		// OIDC Configuration
		OIDCEnabled:      getEnv("OIDC_ENABLED", "false") == "true",
		OIDCIssuerURL:    getEnv("OIDC_ISSUER_URL", ""),
		OIDCClientID:     getEnv("OIDC_CLIENT_ID", ""),
		OIDCClientSecret: getEnv("OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURL:  getEnv("OIDC_REDIRECT_URL", "http://localhost:8080/api/auth/oidc/callback"),
		OIDCScopes:       getEnv("OIDC_SCOPES", "openid profile email"),
	}

	// A guessable JWT secret lets anyone forge a valid admin session. The dev
	// fallback is fine for local work but must never reach a production deploy.
	if C.Env == "production" && C.JWTSecret == devJWTSecret {
		log.Fatal("JWT_SECRET must be set to a unique value when ENV=production (refusing to start with the default dev secret)")
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		i, err := strconv.Atoi(v)
		if err == nil {
			return i
		}
	}
	return fallback
}
