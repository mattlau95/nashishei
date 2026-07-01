-- +goose Up
ALTER TABLE images ADD COLUMN title TEXT;

-- +goose Down
ALTER TABLE images DROP COLUMN title;
