package handler

import (
	_ "embed"
	"fmt"
	"html/template"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/config"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

//go:embed templates/share_og.html
var ogTemplateSource string

var ogTemplate = template.Must(template.New("og").Parse(ogTemplateSource))

type ogData struct {
	Title        string
	Description  string
	ThumbnailURL string
	ShareURL     string
}

func ShareOGPage(db *pgxpool.Pool, store *storage.Local, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")

		var imageID, accountID string
		err := db.QueryRow(r.Context(),
			`SELECT id, account_id FROM images WHERE share_token = $1`,
			token,
		).Scan(&imageID, &accountID)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		// Fetch confirmed names
		rows, err := db.Query(r.Context(),
			`SELECT p.display_name
			 FROM detections d
			 JOIN tags t ON t.detection_id = d.id AND t.status = 'confirmed'
			 JOIN persons p ON p.id = t.person_id
			 WHERE d.image_id = $1`,
			imageID,
		)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var names []string
		for rows.Next() {
			var name string
			rows.Scan(&name)
			names = append(names, name)
		}

		thumbnailURL := store.URL(accountID, imageID, "thumb.jpg")
		shareURL := cfg.FrontendURL + "/s/" + token

		d := ogData{
			Title:        buildOGTitle(names),
			Description:  buildOGDescription(len(names)),
			ThumbnailURL: thumbnailURL,
			ShareURL:     shareURL,
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		ogTemplate.Execute(w, d)
	}
}

func buildOGTitle(names []string) string {
	switch len(names) {
	case 0:
		return "Group photo — tap faces to name them"
	case 1:
		return names[0]
	case 2:
		return names[0] + " & " + names[1]
	case 3:
		return strings.Join(names[:3], ", ")
	default:
		return fmt.Sprintf("%s, %s, %s and %d more",
			names[0], names[1], names[2], len(names)-3)
	}
}

func buildOGDescription(n int) string {
	if n == 0 {
		return "Open to see who's in the photo and help name them."
	}
	if n == 1 {
		return "1 person tagged. Open to see who's who."
	}
	return fmt.Sprintf("%d people tagged. Open to see who's who.", n)
}
