-- +goose Up
-- Dev seed: one test account + a few persons to exercise multilingual name handling.
-- Password hash is bcrypt of "password" — dev only, never use in prod.

INSERT INTO accounts (id, email, password_hash) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'dev@nashishei.local',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LjZdGiumiiK');

INSERT INTO persons (account_id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Grace Chao'),
  ('00000000-0000-0000-0000-000000000001', 'Kuan Yuen Chang'),
  ('00000000-0000-0000-0000-000000000001', '陈彬');

-- +goose Down

DELETE FROM persons  WHERE account_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM accounts WHERE id         = '00000000-0000-0000-0000-000000000001';
