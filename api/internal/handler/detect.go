package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
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

type mlFace struct {
	BboxX     float64   `json:"bbox_x"`
	BboxY     float64   `json:"bbox_y"`
	BboxW     float64   `json:"bbox_w"`
	BboxH     float64   `json:"bbox_h"`
	Embedding []float64 `json:"embedding"`
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
