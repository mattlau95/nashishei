package handler

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

func CreateTag(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DetectionID string `json:"detection_id"`
			PersonID    string `json:"person_id"`
			Status      string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		if body.DetectionID == "" || body.PersonID == "" {
			http.Error(w, "detection_id and person_id required", http.StatusBadRequest)
			return
		}
		if body.Status == "" {
			body.Status = "confirmed"
		}

		var id string
		err := db.QueryRow(r.Context(),
			`INSERT INTO tags (detection_id, person_id, status) VALUES ($1, $2, $3) RETURNING id`,
			body.DetectionID, body.PersonID, body.Status,
		).Scan(&id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"id": id})
	}
}
