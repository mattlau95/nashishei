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

	// Public routes
	r.Get("/health", handler.Health(pool))
	r.Post("/auth/register", handler.Register(pool, cfg))
	r.Post("/auth/login", handler.Login(pool, cfg))
	r.Post("/auth/logout", handler.Logout())
	r.Get("/share/{token}", handler.GetSharedImage(pool, store))
	r.Post("/share/{token}/name", handler.NameDetectionViaShare(pool))
	r.Get("/s/{token}", handler.ShareOGPage(pool, store, cfg))

	// Serve uploaded files
	r.Get("/files/*", func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		prefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
		http.StripPrefix(prefix, http.FileServer(http.Dir(cfg.StoragePath))).ServeHTTP(w, r)
	})

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg.JWTSecret))

		r.Post("/images", handler.UploadImage(pool, store))
		r.Get("/images/{id}", handler.GetImage(pool, store))
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
