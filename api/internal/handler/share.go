package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/middleware"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

func GenerateShareToken(db *pgxpool.Pool, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := chi.URLParam(r, "id")
		accountID := middleware.AccountID(r.Context())

		// Verify ownership
		var exists bool
		db.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM images WHERE id = $1 AND account_id = $2)`,
			imageID, accountID,
		).Scan(&exists)
		if !exists {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		token, err := generateToken()
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		_, err = db.Exec(r.Context(),
			`UPDATE images SET share_token = $1 WHERE id = $2`,
			token, imageID,
		)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		shareURL := cfg.BaseURL + "/share/" + token
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"share_token": token,
			"share_url":   shareURL,
		})
	}
}

func RevokeShareToken(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := chi.URLParam(r, "id")
		accountID := middleware.AccountID(r.Context())

		tag, err := db.Exec(r.Context(),
			`UPDATE images SET share_token = NULL WHERE id = $1 AND account_id = $2`,
			imageID, accountID,
		)
		if err != nil || tag.RowsAffected() == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func GetSharedImage(db *pgxpool.Pool, store *storage.Local) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")

		var imageID, accountID, storageKey string
		var width, height int
		err := db.QueryRow(r.Context(),
			`SELECT id, account_id, storage_key, width, height
			 FROM images WHERE share_token = $1`,
			token,
		).Scan(&imageID, &accountID, &storageKey, &width, &height)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		// Fetch confirmed tags
		rows, err := db.Query(r.Context(),
			`SELECT d.id, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h, p.display_name
			 FROM detections d
			 JOIN tags t ON t.detection_id = d.id
			 JOIN persons p ON p.id = t.person_id
			 WHERE d.image_id = $1 AND t.status = 'confirmed'`,
			imageID,
		)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		type label struct {
			DetectionID string  `json:"detection_id"`
			BBoxX       float64 `json:"bbox_x"`
			BBoxY       float64 `json:"bbox_y"`
			BBoxW       float64 `json:"bbox_w"`
			BBoxH       float64 `json:"bbox_h"`
			DisplayName string  `json:"display_name"`
		}
		labels := []label{}
		for rows.Next() {
			var l label
			rows.Scan(&l.DetectionID, &l.BBoxX, &l.BBoxY, &l.BBoxW, &l.BBoxH, &l.DisplayName)
			labels = append(labels, l)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id":            imageID,
			"width":         width,
			"height":        height,
			"thumbnail_url": store.URL(accountID, imageID, "thumb.jpg"),
			"labels":        labels,
		})
	}
}

func generateToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
