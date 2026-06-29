package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port                string
	DatabaseURL         string
	StoragePath         string
	Env                 string
	SecureCookie        bool
	JWTSecret           string
	BaseURL             string
	FrontendURL         string
	MLSidecarURL        string
	SuggestionThreshold float64
}

func Load() Config {
	base := getEnv("BASE_URL", "http://localhost:8080")
	env := getEnv("ENV", "development")
	return Config{
		Port:                getEnv("PORT", "8080"),
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://nashishei:nashishei@localhost:5432/nashishei?sslmode=disable"),
		StoragePath:         getEnv("STORAGE_PATH", "./storage"),
		Env:                 env,
		SecureCookie:        env == "production",
		JWTSecret:           getEnv("JWT_SECRET", "dev-secret-change-in-prod"),
		BaseURL:             base,
		FrontendURL:         getEnv("FRONTEND_URL", base),
		MLSidecarURL:        getEnv("ML_SIDECAR_URL", "http://localhost:8000"),
		SuggestionThreshold: getEnvFloat("SUGGESTION_THRESHOLD", 0.35),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
			return f
		}
	}
	return fallback
}
