package storage

// Storage persists uploaded photos and thumbnails and serves back their URLs.
type Storage interface {
	Save(accountID, imageID, filename string, data []byte) error
	URL(accountID, imageID, filename string) string
	DeleteAll(accountID, imageID string) error
}
