# Devlog: Nashishei

## Template (Copy this for new entries)
## [YYYY-MM-DD] - [Summary]
**Session Goal:** [Goal]
**Status:** [Completed/Partially Completed/Blocked]

### The "Why" (Decision Log)
* **Resolution:** [Why this was the right path]

### Technical Notes
* [Stack changes, bugs, or refactors]

### Next Session
* [Task 1]

---
## History (Log Entries start here)

## 2026-06-23 - Phase 0 scaffold + Postgres wiring
**Session Goal:** Get the full project skeleton standing and the database connected to the API.
**Status:** Partially Completed (MAT-468 ✅, MAT-469 ✅ — MAT-470/471/472/473 in progress)

### The "Why" (Decision Log)
* **Monorepo layout (`frontend/` + `api/` + `ml/`):** Keeps all three services in one repo so they can share migration files and be started with a single `make dev`. The ML sidecar is isolated in its own directory precisely because it's the unfamiliar piece — Python/FastAPI — so it can evolve independently without touching Go or React code.
* **pgx/v5 over lib/pq:** pgx is the modern idiomatic Postgres driver for Go. Better performance, native support for pgvector (needed in Phase 2), and a cleaner pool API.
* **Migrations via goose, not embedded:** Keeps migrations as plain SQL files you can read and edit without touching Go code. Embeds come later if deployment requires it.
* **ML sidecar runs in Docker only:** Python isn't installed locally. Stubbing it behind Docker from day one means the local dev workflow is consistent and the sidecar can be swapped for a heavier model (InsightFace) in Phase 2 without changing how the rest of the stack starts.
* **`/health` pings the DB:** A health endpoint that lies (always returns OK) is worse than no health endpoint. Now monitoring tools will actually catch a broken database connection.

### Technical Notes
* Vite proxy configured to forward `/api/*` to `:8080` — avoids CORS issues in dev without any server-side config.
* `go.sum` needed an explicit `go get github.com/jackc/pgx/v5/pgxpool` call to pull the transitive `puddle/v2` dep — gomod didn't fetch it automatically from the top-level get.
* Seed migration (`002_seed.sql`) includes `陈彬` and `Kuan Yuen Chang` as test persons — these are the exact edge cases that would break a naive first/last name split.
* Custom slash command `/summaryfordummy` created at `.claude/commands/summaryfordummy.md` — appends plain-English session notes to `docs/SUMMARYFORDUMMY.md`.

### Next Session
* MAT-470 — Multilingual name validation (server-side, no first/last split)
* MAT-471 — Image upload endpoint + object storage + thumbnail generation
* MAT-472 — Accounts + auth (register, login, chi middleware)
* MAT-473 — Share token generation + public viewer route (unblocks after 471 + 472)

---