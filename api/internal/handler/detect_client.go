package handler

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/middleware"
)

// DetectImageFromClient accepts face detections and 512-dim embeddings produced by
// the local ML sidecar running on the Tauri desktop client. It stores them with
// their embeddings and runs the same pgvector similarity search as DetectImage.
func DetectImageFromClient(db *pgxpool.Pool, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := chi.URLParam(r, "id")
		accountID := middleware.AccountID(r.Context())

		var exists bool
		if err := db.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM images WHERE id = $1 AND account_id = $2)`,
			imageID, accountID,
		).Scan(&exists); err != nil || !exists {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}

		var req struct {
			Faces []mlFace `json:"faces"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}

		saved := make([]detectionResult, 0, len(req.Faces))
		embeddings := make(map[string][]float64)
		for _, face := range req.Faces {
			embStr := floatsToVectorLiteral(face.Embedding)
			var id string
			if err := db.QueryRow(r.Context(),
				`INSERT INTO detections (image_id, bbox_x, bbox_y, bbox_w, bbox_h, source, embedding)
				 VALUES ($1, $2, $3, $4, $5, 'client', $6::vector) RETURNING id`,
				imageID, face.BboxX, face.BboxY, face.BboxW, face.BboxH, embStr,
			).Scan(&id); err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
			saved = append(saved, detectionResult{
				ID: id, BboxX: face.BboxX, BboxY: face.BboxY,
				BboxW: face.BboxW, BboxH: face.BboxH, Source: "client",
			})
			embeddings[id] = face.Embedding
		}

		suggestions := computeSuggestions(r, db, accountID, saved, embeddings, cfg.SuggestionThreshold)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"detections":  saved,
			"suggestions": suggestions,
		})
	}
}
