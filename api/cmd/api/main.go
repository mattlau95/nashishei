package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/db"
	"github.com/mattlau95/nashishei/api/internal/handler"
	"github.com/mattlau95/nashishei/api/internal/middleware"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

const shutdownTimeout = 10 * time.Second

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

	var store storage.Storage
	switch cfg.StorageDriver {
	case "r2":
		store = storage.NewR2(cfg.R2AccountID, cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2Bucket, cfg.R2PublicURL)
		slog.Info("storage driver", "driver", "r2", "bucket", cfg.R2Bucket)
	case "local":
		local, err := storage.NewLocal(cfg.StoragePath, cfg.BaseURL)
		if err != nil {
			slog.Error("storage init failed", "err", err)
			os.Exit(1)
		}
		store = local
		slog.Info("storage driver", "driver", "local", "path", cfg.StoragePath)
	default:
		slog.Error("unknown STORAGE_DRIVER", "driver", cfg.StorageDriver)
		os.Exit(1)
	}

	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.RequestID)
	r.Use(corsMiddleware(cfg.AllowedOrigins))

	// Public routes
	r.Get("/health", handler.Health(pool))
	r.Post("/auth/register", handler.Register(pool, cfg))
	r.Post("/auth/login", handler.Login(pool, cfg))
	r.Post("/auth/logout", handler.Logout(cfg))
	r.Get("/share/{token}", handler.GetSharedImage(pool, store))
	r.Post("/share/{token}/name", handler.NameDetectionViaShare(pool))
	r.Put("/share/{token}/name", handler.RenameViaShare(pool))
	r.Get("/s/{token}", handler.ShareOGPage(pool, store, cfg))

	// Serve uploaded files when using local storage — CORS header allows canvas
	// toDataURL from any frontend origin. Not needed for the r2 driver, which
	// serves files directly from the R2 public URL.
	if cfg.StorageDriver == "local" {
		r.Get("/files/*", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			rctx := chi.RouteContext(r.Context())
			prefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
			http.StripPrefix(prefix, http.FileServer(http.Dir(cfg.StoragePath))).ServeHTTP(w, r)
		})
	}

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(cfg.JWTSecret))

		r.Get("/images", handler.ListImages(pool, store))
		r.Post("/images", handler.UploadImage(pool, store))
		r.Get("/images/{id}", handler.GetImage(pool, store))
		r.Patch("/images/{id}", handler.EditImageTitle(pool))
		r.Delete("/images/{id}", handler.DeleteImage(pool, store))
		r.Post("/images/{id}/detect-client", handler.DetectImageFromClient(pool, cfg))
		r.Post("/images/{id}/share", handler.GenerateShareToken(pool, cfg))
		r.Delete("/images/{id}/share", handler.RevokeShareToken(pool))

		r.Post("/persons", handler.CreatePerson(pool))
		r.Post("/detections/batch", handler.BatchSaveDetections(pool))
		r.Post("/tags", handler.CreateTag(pool))
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	srv := &http.Server{Addr: addr, Handler: r}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("api listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	stop()
	slog.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
		os.Exit(1)
	}
	slog.Info("shutdown complete")
}

func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allowed[origin] {
				// Echo the exact origin so credentials work (wildcard + credentials is invalid per spec)
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
