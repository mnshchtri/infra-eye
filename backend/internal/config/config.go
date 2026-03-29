package config

import (
	"log"
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	Port            string
	Env             string
	DBDSN           string
	RedisAddr       string
	JWTSecret       string
	OpenAIKey       string
	GeminiKey       string
	MetricsInterval int
	LogMaxLines     int
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
		DBDSN:           getEnv("DB_DSN", "postgresql://infraeye:infraeye123@localhost:5432/infraeye?sslmode=disable"),
		RedisAddr:       getEnv("REDIS_ADDR", "localhost:6379"),
		JWTSecret:       getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		OpenAIKey:       getEnv("OPENAI_API_KEY", ""),
		GeminiKey:       getEnv("GEMINI_API_KEY", ""),
		MetricsInterval: getEnvInt("METRICS_INTERVAL", 30),
		LogMaxLines:     getEnvInt("LOG_MAX_LINES", 500),
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
