package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/db"
	"github.com/mattlau95/nashishei/api/internal/handler"
	"github.com/mattlau95/nashishei/api/internal/middleware"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("database connected")

	store, err := storage.NewLocal(cfg.StoragePath, cfg.BaseURL)
	if err != nil {
		slog.Error("storage init failed", "err", err)
		os.Exit(1)
	}

	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.RequestID)
	r.Use(corsMiddleware(cfg.FrontendURL))

	// Public routes
	r.Get("/health", handler.Health(pool))
	r.Post("/auth/register", handler.Register(pool, cfg))
	r.Post("/auth/login", handler.Login(pool, cfg))
	r.Post("/auth/logout", handler.Logout(cfg))
	r.Get("/share/{token}", handler.GetSharedImage(pool, store))
	r.Post("/share/{token}/name", handler.NameDetectionViaShare(pool))
	r.Put("/share/{token}/name", handler.RenameViaShare(pool))
	r.Get("/s/{token}", handler.ShareOGPage(pool, store, cfg))

	// Serve uploaded files — CORS header allows canvas toDataURL from any frontend origin
	r.Get("/files/*", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		rctx := chi.RouteContext(r.Context())
		prefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
		http.StripPrefix(prefix, http.FileServer(http.Dir(cfg.StoragePath))).ServeHTTP(w, r)
	})

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg.JWTSecret))

		r.Get("/images", handler.ListImages(pool, store))
		r.Post("/images", handler.UploadImage(pool, store))
		r.Get("/images/{id}", handler.GetImage(pool, store))
		r.Post("/images/{id}/detect", handler.DetectImage(pool, store, cfg))
		r.Post("/images/{id}/detect-client", handler.DetectImageFromClient(pool, cfg))
		r.Post("/images/{id}/share", handler.GenerateShareToken(pool, cfg))
		r.Delete("/images/{id}/share", handler.RevokeShareToken(pool))

		r.Post("/persons", handler.CreatePerson(pool))
		r.Post("/detections/batch", handler.BatchSaveDetections(pool))
		r.Post("/tags", handler.CreateTag(pool))
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	slog.Info("api listening", "addr", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

func corsMiddleware(_ string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				// Reflect the exact origin so credentials work (wildcard + credentials is invalid per spec)
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			} else {
				w.Header().Set("Access-Control-Allow-Origin", "*")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
