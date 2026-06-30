package storage

import (
	"fmt"
	"os"
	"path/filepath"
)

type Local struct {
	BasePath string
	BaseURL  string
}

func NewLocal(basePath, baseURL string) (*Local, error) {
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("create storage dir: %w", err)
	}
	return &Local{BasePath: basePath, BaseURL: baseURL}, nil
}

func (l *Local) Save(accountID, imageID, filename string, data []byte) error {
	dir := filepath.Join(l.BasePath, accountID, imageID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create image dir: %w", err)
	}
	return os.WriteFile(filepath.Join(dir, filename), data, 0644)
}

func (l *Local) PathFor(accountID, imageID, filename string) string {
	return filepath.Join(l.BasePath, accountID, imageID, filename)
}

func (l *Local) URL(accountID, imageID, filename string) string {
	return fmt.Sprintf("%s/files/%s/%s/%s", l.BaseURL, accountID, imageID, filename)
}

func (l *Local) DeleteAll(accountID, imageID string) error {
	return os.RemoveAll(filepath.Join(l.BasePath, accountID, imageID))
}
