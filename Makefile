.PHONY: dev api frontend migrate migrate-down test build tauri-dev tauri-build-mac tauri-build-windows

# Start Postgres + ML sidecar in Docker, then run API and frontend locally
dev:
	docker compose up -d db ml
	@echo "Waiting for db..." && sleep 2
	$(MAKE) migrate
	$(MAKE) -j2 api frontend

api:
	cd api && cp ../.env.example ../.env 2>/dev/null || true && go run ./cmd/api

frontend:
	cd frontend && npm run dev

# Run migrations (requires goose: go install github.com/pressly/goose/v3/cmd/goose@latest)
migrate:
	goose -dir db/migrations postgres "$(DATABASE_URL)" up

migrate-down:
	goose -dir db/migrations postgres "$(DATABASE_URL)" down

# Build the Go binary
build:
	cd api && go build -o bin/api ./cmd/api

test:
	cd api && go test ./...
	cd frontend && npm run build

# Tauri desktop app — dev + production builds
tauri-dev:
	cd frontend && npm run tauri dev

tauri-build-mac:
	cd frontend && npm run tauri build -- --target universal-apple-darwin

tauri-build-windows:
	cd frontend && npm run tauri build -- --target x86_64-pc-windows-msvc

# Install local tooling
setup:
	go install github.com/pressly/goose/v3/cmd/goose@latest
	cd frontend && npm install
