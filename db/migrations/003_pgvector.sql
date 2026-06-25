-- +goose Up
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE detections
  ALTER COLUMN embedding TYPE vector(512) USING NULL;

CREATE INDEX detections_embedding_cosine_idx
  ON detections USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- +goose Down
DROP INDEX IF EXISTS detections_embedding_cosine_idx;

ALTER TABLE detections
  ALTER COLUMN embedding TYPE bytea USING NULL;

DROP EXTENSION IF EXISTS vector;
