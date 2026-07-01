package config

import (
	"fmt"
	"os"
	"strings"
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
	AllowedOrigins      []string
	StorageDriver       string
	R2AccountID         string
	R2AccessKeyID       string
	R2SecretAccessKey   string
	R2Bucket            string
	R2PublicURL         string
	SuggestionThreshold float64
}

func Load() Config {
	base := getEnv("BASE_URL", "http://localhost:8080")
	env := getEnv("ENV", "development")
	frontendURL := getEnv("FRONTEND_URL", base)
	return Config{
		Port:                getEnv("PORT", "8080"),
		DatabaseURL:         getEnv("DATABASE_URL", "postgres://nashishei:nashishei@localhost:5432/nashishei?sslmode=disable"),
		StoragePath:         getEnv("STORAGE_PATH", "./storage"),
		Env:                 env,
		SecureCookie:        env == "production",
		JWTSecret:           getEnv("JWT_SECRET", "dev-secret-change-in-prod"),
		BaseURL:             base,
		FrontendURL:         frontendURL,
		AllowedOrigins:      getEnvList("ALLOWED_ORIGINS", []string{frontendURL}),
		StorageDriver:       getEnv("STORAGE_DRIVER", "local"),
		R2AccountID:         getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:       getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:   getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2Bucket:            getEnv("R2_BUCKET", ""),
		R2PublicURL:         getEnv("R2_PUBLIC_URL", ""),
		SuggestionThreshold: getEnvFloat("SUGGESTION_THRESHOLD", 0.35),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvList(key string, fallback []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var out []string
	for _, part := range strings.Split(v, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	if len(out) == 0 {
		return fallback
	}
	return out
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
