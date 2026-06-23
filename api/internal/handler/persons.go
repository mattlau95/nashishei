package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/middleware"
)

func CreatePerson(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DisplayName string `json:"display_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}

		body.DisplayName = strings.TrimSpace(body.DisplayName)
		if body.DisplayName == "" {
			http.Error(w, "display_name is required", http.StatusBadRequest)
			return
		}
		if len([]rune(body.DisplayName)) > 200 {
			http.Error(w, "display_name too long (max 200 characters)", http.StatusBadRequest)
			return
		}

		accountID := middleware.AccountID(r.Context())

		var id string
		err := db.QueryRow(r.Context(),
			`INSERT INTO persons (account_id, display_name) VALUES ($1, $2) RETURNING id`,
			accountID, body.DisplayName,
		).Scan(&id)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{
			"id":           id,
			"display_name": body.DisplayName,
		})
	}
}
