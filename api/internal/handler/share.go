package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

		shareURL := cfg.FrontendURL + "/s/" + token
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

func GetSharedImage(db *pgxpool.Pool, store storage.Storage) http.HandlerFunc {
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

		// Fetch all detections; named ones carry display_name, unnamed carry null
		rows, err := db.Query(r.Context(),
			`SELECT d.id, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h, p.display_name
			 FROM detections d
			 LEFT JOIN tags t ON t.detection_id = d.id AND t.status = 'confirmed'
			 LEFT JOIN persons p ON p.id = t.person_id
			 WHERE d.image_id = $1`,
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
			DisplayName *string `json:"display_name"`
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

func NameDetectionViaShare(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")

		var req struct {
			DetectionID string `json:"detection_id"`
			DisplayName string `json:"display_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.DisplayName = strings.TrimSpace(req.DisplayName)
		if req.DisplayName == "" || len(req.DisplayName) > 200 {
			http.Error(w, "display_name must be 1–200 chars", http.StatusBadRequest)
			return
		}

		// Look up image by share token
		var imageID, accountID string
		err := db.QueryRow(r.Context(),
			`SELECT id, account_id FROM images WHERE share_token = $1`,
			token,
		).Scan(&imageID, &accountID)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		// Verify detection belongs to this image
		var detImageID string
		err = db.QueryRow(r.Context(),
			`SELECT image_id FROM detections WHERE id = $1`,
			req.DetectionID,
		).Scan(&detImageID)
		if err != nil || detImageID != imageID {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}

		// Create person under the image owner's account, then tag — use a transaction
		// so the unique constraint on confirmed tags prevents double-naming
		tx, err := db.Begin(r.Context())
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(r.Context())

		var personID string
		err = tx.QueryRow(r.Context(),
			`INSERT INTO persons (account_id, display_name) VALUES ($1, $2) RETURNING id`,
			accountID, req.DisplayName,
		).Scan(&personID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		_, err = tx.Exec(r.Context(),
			`INSERT INTO tags (detection_id, person_id, status, created_by)
			 VALUES ($1, $2, 'confirmed', 'viewer')`,
			req.DetectionID, personID,
		)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				http.Error(w, "already named", http.StatusConflict)
				return
			}
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		if err = tx.Commit(r.Context()); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"display_name": req.DisplayName})
	}
}

func RenameViaShare(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")

		var req struct {
			DetectionID string `json:"detection_id"`
			DisplayName string `json:"display_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		req.DisplayName = strings.TrimSpace(req.DisplayName)
		if req.DisplayName == "" || len([]rune(req.DisplayName)) > 200 {
			http.Error(w, "display_name must be 1–200 chars", http.StatusBadRequest)
			return
		}

		tag, err := db.Exec(r.Context(),
			`UPDATE persons p
			 SET display_name = $3
			 FROM tags t, detections d, images i
			 WHERE t.person_id = p.id
			   AND t.detection_id = d.id AND t.status = 'confirmed'
			   AND d.image_id = i.id
			   AND i.share_token = $1
			   AND d.id = $2`,
			token, req.DetectionID, req.DisplayName,
		)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if tag.RowsAffected() == 0 {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"display_name": req.DisplayName})
	}
}

func generateToken() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
