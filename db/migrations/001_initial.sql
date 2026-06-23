-- +goose Up

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  aka          TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  width       INT NOT NULL,
  height      INT NOT NULL,
  share_token TEXT UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE detections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id   UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  bbox_x     REAL NOT NULL,
  bbox_y     REAL NOT NULL,
  bbox_w     REAL NOT NULL,
  bbox_h     REAL NOT NULL,
  source     TEXT NOT NULL DEFAULT 'auto',
  crop_key   TEXT,
  embedding  BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
  person_id    UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'confirmed',
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one confirmed identity per detection; suggestions coexist freely.
CREATE UNIQUE INDEX one_confirmed_tag_per_detection
  ON tags (detection_id)
  WHERE status = 'confirmed';

-- +goose Down

DROP INDEX IF EXISTS one_confirmed_tag_per_detection;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS detections;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS persons;
DROP TABLE IF EXISTS accounts;
