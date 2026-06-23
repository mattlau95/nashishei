package config

import "os"

type Config struct {
	Port        string
	DatabaseURL string
	StoragePath string
	Env         string
	JWTSecret   string
	BaseURL     string
}

func Load() Config {
	return Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://nashishei:nashishei@localhost:5432/nashishei?sslmode=disable"),
		StoragePath: getEnv("STORAGE_PATH", "./storage"),
		Env:         getEnv("ENV", "development"),
		JWTSecret:   getEnv("JWT_SECRET", "dev-secret-change-in-prod"),
		BaseURL:     getEnv("BASE_URL", "http://localhost:8080"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
