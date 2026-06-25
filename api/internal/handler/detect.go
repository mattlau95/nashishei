package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/middleware"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

type detectionResult struct {
	ID     string  `json:"id"`
	BboxX  float64 `json:"bbox_x"`
	BboxY  float64 `json:"bbox_y"`
	BboxW  float64 `json:"bbox_w"`
	BboxH  float64 `json:"bbox_h"`
	Source string  `json:"source"`
}

type suggestionResult struct {
	DetectionID string  `json:"detection_id"`
	PersonID    string  `json:"person_id"`
	DisplayName string  `json:"display_name"`
	Similarity  float64 `json:"similarity"`
}

var mlClient = &http.Client{Timeout: 60 * time.Second}

func DetectImage(db *pgxpool.Pool, store *storage.Local, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := chi.URLParam(r, "id")
		accountID := middleware.AccountID(r.Context())

		var storageKey string
		if err := db.QueryRow(r.Context(),
			`SELECT storage_key FROM images WHERE id = $1 AND account_id = $2`,
			imageID, accountID,
		).Scan(&storageKey); err != nil {
			http.Error(w, "image not found", http.StatusNotFound)
			return
		}

		// Find the original file (extension may vary)
		pattern := filepath.Join(store.BasePath, storageKey, "original.*")
		matches, err := filepath.Glob(pattern)
		if err != nil || len(matches) == 0 {
			http.Error(w, "original file not found", http.StatusInternalServerError)
			return
		}
		imgBytes, err := os.ReadFile(matches[0])
		if err != nil {
			http.Error(w, "could not read image file", http.StatusInternalServerError)
			return
		}

		// Call ML sidecar
		mlFaces, err := callMLSidecar(cfg.MLSidecarURL, imgBytes)
		if err != nil {
			http.Error(w, "ML sidecar unavailable", http.StatusBadGateway)
			return
		}

		// Persist detections with embeddings
		saved := make([]detectionResult, 0, len(mlFaces))
		embeddings := make(map[string][]float64) // detection_id → embedding
		for _, face := range mlFaces {
			embStr := floatsToVectorLiteral(face.Embedding)
			var id string
			err := db.QueryRow(r.Context(),
				`INSERT INTO detections (image_id, bbox_x, bbox_y, bbox_w, bbox_h, source, embedding)
				 VALUES ($1, $2, $3, $4, $5, 'server', $6::vector) RETURNING id`,
				imageID, face.BboxX, face.BboxY, face.BboxW, face.BboxH, embStr,
			).Scan(&id)
			if err != nil {
				http.Error(w, "server error", http.StatusInternalServerError)
				return
			}
			saved = append(saved, detectionResult{
				ID: id, BboxX: face.BboxX, BboxY: face.BboxY,
				BboxW: face.BboxW, BboxH: face.BboxH, Source: "server",
			})
			embeddings[id] = face.Embedding
		}

		// Run similarity search → suggested tags
		suggestions := computeSuggestions(r, db, accountID, saved, embeddings, cfg.SuggestionThreshold)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"detections":  saved,
			"suggestions": suggestions,
		})
	}
}

type mlFace struct {
	BboxX     float64   `json:"bbox_x"`
	BboxY     float64   `json:"bbox_y"`
	BboxW     float64   `json:"bbox_w"`
	BboxH     float64   `json:"bbox_h"`
	Embedding []float64 `json:"embedding"`
}

func callMLSidecar(sidecarURL string, imgBytes []byte) ([]mlFace, error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("image", "image")
	if err != nil {
		return nil, err
	}
	if _, err := fw.Write(imgBytes); err != nil {
		return nil, err
	}
	mw.Close()

	req, err := http.NewRequest(http.MethodPost, sidecarURL+"/detect-and-embed", &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := mlClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ml sidecar returned %d", resp.StatusCode)
	}

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var result struct {
		Faces []mlFace `json:"faces"`
	}
	if err := json.Unmarshal(respBytes, &result); err != nil {
		return nil, err
	}
	return result.Faces, nil
}

func floatsToVectorLiteral(fs []float64) string {
	parts := make([]string, len(fs))
	for i, f := range fs {
		parts[i] = fmt.Sprintf("%g", f)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func computeSuggestions(
	r *http.Request,
	db *pgxpool.Pool,
	accountID string,
	detections []detectionResult,
	embeddings map[string][]float64,
	threshold float64,
) []suggestionResult {
	suggestions := []suggestionResult{}

	for _, det := range detections {
		emb, ok := embeddings[det.ID]
		if !ok {
			continue
		}
		embStr := floatsToVectorLiteral(emb)

		var personID, displayName string
		var similarity float64
		err := db.QueryRow(r.Context(),
			`SELECT p.id, p.display_name, 1 - (d2.embedding <=> $1::vector) AS similarity
			 FROM detections d2
			 JOIN tags t2 ON t2.detection_id = d2.id AND t2.status = 'confirmed'
			 JOIN persons p ON p.id = t2.person_id
			 WHERE p.account_id = $2
			   AND d2.embedding IS NOT NULL
			 ORDER BY d2.embedding <=> $1::vector
			 LIMIT 1`,
			embStr, accountID,
		).Scan(&personID, &displayName, &similarity)
		if err != nil {
			continue
		}

		if similarity < threshold {
			continue
		}

		_, _ = db.Exec(r.Context(),
			`INSERT INTO tags (detection_id, person_id, status, created_by)
			 VALUES ($1, $2, 'suggested', 'ml')
			 ON CONFLICT DO NOTHING`,
			det.ID, personID,
		)

		suggestions = append(suggestions, suggestionResult{
			DetectionID: det.ID,
			PersonID:    personID,
			DisplayName: displayName,
			Similarity:  similarity,
		})
	}

	return suggestions
}
