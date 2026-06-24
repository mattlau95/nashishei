package handler

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/middleware"
)

func BatchSaveDetections(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ImageID    string `json:"image_id"`
			Detections []struct {
				BboxX  float64 `json:"bbox_x"`
				BboxY  float64 `json:"bbox_y"`
				BboxW  float64 `json:"bbox_w"`
				BboxH  float64 `json:"bbox_h"`
				Source string  `json:"source"`
			} `json:"detections"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if body.ImageID == "" {
			http.Error(w, "image_id required", http.StatusBadRequest)
			return
		}

		accountID := middleware.AccountID(r.Context())

		// Verify the image belongs to this account
		var exists bool
		if err := db.QueryRow(r.Context(),
			`SELECT EXISTS(SELECT 1 FROM images WHERE id = $1 AND account_id = $2)`,
			body.ImageID, accountID,
		).Scan(&exists); err != nil || !exists {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}

		type result struct {
			ID     string  `json:"id"`
			BboxX  float64 `json:"bbox_x"`
			BboxY  float64 `json:"bbox_y"`
			BboxW  float64 `json:"bbox_w"`
			BboxH  float64 `json:"bbox_h"`
			Source string  `json:"source"`
		}

		saved := make([]result, 0, len(body.Detections))
		for _, d := range body.Detections {
			src := d.Source
			if src == "" {
				src = "auto"
			}
			var id string
			err := db.QueryRow(r.Context(),
				`INSERT INTO detections (image_id, bbox_x, bbox_y, bbox_w, bbox_h, source)
				 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
				body.ImageID, d.BboxX, d.BboxY, d.BboxW, d.BboxH, src,
			).Scan(&id)
			if err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
			saved = append(saved, result{ID: id, BboxX: d.BboxX, BboxY: d.BboxY, BboxW: d.BboxW, BboxH: d.BboxH, Source: src})
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{"detections": saved})
	}
}
