package handler

import (
	"bytes"
	"encoding/json"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"

	"github.com/disintegration/imaging"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mattlau95/nashishei/api/internal/middleware"
	"github.com/mattlau95/nashishei/api/internal/storage"
)

const maxUploadSize = 20 << 20 // 20 MB

var allowedMIME = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

func UploadImage(db *pgxpool.Pool, store *storage.Local) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadSize)
		if err := r.ParseMultipartForm(maxUploadSize); err != nil {
			http.Error(w, "file too large (max 20 MB)", http.StatusBadRequest)
			return
		}

		file, _, err := r.FormFile("image")
		if err != nil {
			http.Error(w, "image field required", http.StatusBadRequest)
			return
		}
		defer file.Close()

		// Read into memory so we can detect MIME and process without seeking
		buf := new(bytes.Buffer)
		if _, err := buf.ReadFrom(file); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		data := buf.Bytes()

		mimeType := http.DetectContentType(data[:min(512, len(data))])
		ext, ok := allowedMIME[mimeType]
		if !ok {
			http.Error(w, "unsupported file type — use JPEG, PNG, or WebP", http.StatusBadRequest)
			return
		}

		// Decode to get dimensions
		img, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			http.Error(w, "could not read image", http.StatusBadRequest)
			return
		}
		bounds := img.Bounds()
		width := bounds.Dx()
		height := bounds.Dy()

		accountID := middleware.AccountID(r.Context())

		// Insert DB row first to get the image ID
		var imageID string
		err = db.QueryRow(r.Context(),
			`INSERT INTO images (account_id, storage_key, width, height)
			 VALUES ($1, '', $2, $3) RETURNING id`,
			accountID, width, height,
		).Scan(&imageID)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		originalFile := "original." + ext
		if err := store.Save(accountID, imageID, originalFile, data); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		// Generate thumbnail (max 1200px longest edge)
		thumb := imaging.Fit(img, 1200, 1200, imaging.Lanczos)
		var thumbBuf bytes.Buffer
		if err := imaging.Encode(&thumbBuf, thumb, imaging.JPEG, imaging.JPEGQuality(85)); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}
		if err := store.Save(accountID, imageID, "thumb.jpg", thumbBuf.Bytes()); err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		storageKey := accountID + "/" + imageID
		_, err = db.Exec(r.Context(),
			`UPDATE images SET storage_key = $1 WHERE id = $2`,
			storageKey, imageID,
		)
		if err != nil {
			http.Error(w, "server error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"id":            imageID,
			"width":         width,
			"height":        height,
			"original_url":  store.URL(accountID, imageID, originalFile),
			"thumbnail_url": store.URL(accountID, imageID, "thumb.jpg"),
		})
	}
}

func GetImage(db *pgxpool.Pool, store *storage.Local) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := chi.URLParam(r, "id")
		accountID := middleware.AccountID(r.Context())

		var id, storageKey string
		var width, height int
		var shareToken *string
		err := db.QueryRow(r.Context(),
			`SELECT id, storage_key, width, height, share_token
			 FROM images WHERE id = $1 AND account_id = $2`,
			imageID, accountID,
		).Scan(&id, &storageKey, &width, &height, &shareToken)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"id":            id,
			"width":         width,
			"height":        height,
			"thumbnail_url": store.URL(accountID, id, "thumb.jpg"),
			"share_token":   shareToken,
		})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
