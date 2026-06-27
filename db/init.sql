-- Auto-generated from migrations 001–003 (Up sections only).
-- Mounted at /docker-entrypoint-initdb.d/ so postgres runs this once on a fresh volume.

-- 001_initial
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

CREATE UNIQUE INDEX one_confirmed_tag_per_detection
  ON tags (detection_id)
  WHERE status = 'confirmed';

-- 002_seed (dev account, password = "password")
INSERT INTO accounts (id, email, password_hash) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'dev@nashishei.local',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LjZdGiumiiK');

INSERT INTO persons (account_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Grace Chao'),
  ('00000000-0000-0000-0000-000000000001', 'Kuan Yuen Chang'),
  ('00000000-0000-0000-0000-000000000001', '陈彬');

-- 003_pgvector
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE detections
  ALTER COLUMN embedding TYPE vector(512) USING NULL;

CREATE INDEX detections_embedding_cosine_idx
  ON detections USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
