package config

import "os"

type Config struct {
	Port        string
	DatabaseURL string
	StoragePath string
	Env         string
}

func Load() Config {
	return Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://nashishei:nashishei@localhost:5432/nashishei?sslmode=disable"),
		StoragePath: getEnv("STORAGE_PATH", "./storage"),
		Env:         getEnv("ENV", "development"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
