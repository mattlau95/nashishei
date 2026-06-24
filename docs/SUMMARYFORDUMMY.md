# Summary For Dummy
Plain-English notes on what was built and when. Read this when you've been away for a while and need to remember where things stand.

---

## 2026-06-23 — Project scaffolded (MAT-468)

### What happened
First session. Set up the skeleton of the entire app — nothing user-facing works yet, but all three programs exist, start up without errors, and the database structure is designed.

### The three programs

**Frontend** (`frontend/`)
The website that runs in a browser. Built with React + Vite. Has two pages right now, both blank placeholders:
- Home page — where you'll eventually upload a group photo
- Viewer page (`/s/:token`) — where someone opens a shared link to see the labeled photo

**API** (`api/`)
The backend server written in Go. Handles logins, saves data, generates share links — the brain of the app. Right now it only does one thing: respond to `/health` with `{"status": "ok"}` to confirm it's running.

**ML sidecar** (`ml/`)
A separate mini-server that will eventually detect faces and recognize people. Written in Python, runs inside Docker (because Python isn't installed locally). Also just a `/health` stub for now — the real face detection comes in Phase 1.

### The database (`db/migrations/001_initial.sql`)
Postgres. The table structure is already fully designed for Phase 0:
- `accounts` — who's logged in
- `persons` — named people (stored as a single free-text field — no first/last name split, handles Chinese names like "Kuan Yuen Chang" correctly)
- `images` — uploaded photos, with a `share_token` field for link-based sharing
- `detections` — bounding boxes drawn around faces (stored as 0–1 normalized coordinates so they scale to any screen size)
- `tags` — links a detection (a box) to a person (a name). A face can have multiple *suggested* tags but only one *confirmed* one.

The schema isn't applied to the database yet — that's MAT-469.

### The glue files
- `docker-compose.yml` — one command spins up Postgres and the ML server in Docker
- `Makefile` — shortcuts: `make dev` starts everything, `make migrate` applies the database schema
- `.env.example` — copy this to `.env` to configure local settings (database URL, port, etc.)

### How to start it
```bash
cp .env.example .env
make setup    # installs goose (migration tool) + npm packages
make dev      # starts Postgres + ML in Docker, runs API + frontend locally
```

### What's next (Phase 0 remaining)
- **MAT-469** — wire Postgres into the Go API and run the migrations ✅
- **MAT-470** — enforce multilingual name rules in code (free-text only, comma delimiter)
- **MAT-471** — image upload endpoint + thumbnail generation
- **MAT-472** — account registration + login
- **MAT-473** — share link generation (the `/s/:token` URL)

---

## 2026-06-23 — API connected to the database (MAT-469)

### What happened
The API and the database can now talk to each other. Before this, the database design existed on paper (in a migration file) but nothing had actually applied it to a real database, and the API had no idea the database existed.

### What changed

**The API now connects to Postgres on startup.**
When you run the API server, the very first thing it does is try to connect to the database. If the database is down or unreachable, the server refuses to start and tells you why. No more silent failures.

**The health check is now honest.**
Before: `/health` always returned `{"status": "ok"}` no matter what — even if the database was completely broken.
After: `/health` actually pings the database. If the DB is down it returns `{"status": "db_unavailable"}` and a 503 error code. This matters later when you deploy — monitoring tools can tell if something is actually wrong.

**The database schema now has test data (`db/migrations/002_seed.sql`).**
When you run migrations in dev, it also inserts:
- One test account (`dev@nashishei.local`, password: `password`)
- Three test persons: `Grace Chao`, `Kuan Yuen Chang`, and `陈彬`

The last two are deliberately chosen to verify that multi-word names and Chinese characters survive the round-trip through the database without getting mangled.

### How migrations work
Migrations are SQL files that build up the database schema step by step. You run them with:
```bash
make migrate
```
That command reads the files in `db/migrations/` in order (001, 002, ...) and applies any that haven't run yet. It won't re-run ones that already ran — it keeps track. To undo the last one: `make migrate-down`.

### To smoke test (requires Docker Desktop running)
```bash
cp .env.example .env
docker compose up -d db        # start Postgres
make migrate                   # apply schema + seed data
cd api && go run ./cmd/api     # start the API
curl localhost:8080/health     # should return {"status":"ok"}
```

### What's next (Phase 0 remaining)
- **MAT-470** — enforce multilingual name rules in code (free-text only, comma delimiter)
- **MAT-471** — image upload endpoint + thumbnail generation
- **MAT-472** — account registration + login
- **MAT-473** — share link generation (the `/s/:token` URL)

---

## 2026-06-23 — Phase 0 finished: login, photo upload, name saving, and share links (MAT-470 – MAT-473)

### What happened
Big session. Everything needed to make the app actually usable as a backend was built in one go. You can now register an account, log in, upload a photo, save a person's name, and generate a shareable link — all via the API. Phase 0 is fully complete.

### What was built

**Accounts and login (MAT-472)**
You can now create an account with an email and password, and log in. Passwords are stored scrambled using a one-way process called bcrypt — even if someone stole the database, they couldn't read the passwords. When you log in, the server gives your browser a small secure ticket (called a JWT — "JSON Web Token") stored in a cookie. Every future request carries that ticket invisibly, proving who you are without logging in again. The ticket expires after 7 days.

**Person names saved correctly (MAT-470)**
The "create a person" endpoint is locked down to prevent name-format assumptions from sneaking in. It accepts one field only: `display_name` — a single free-text box that can hold any name in any language or script. It rejects empty names. It measures name length by *character* not byte — this matters because Chinese characters take 3 bytes each, so a byte-based limit would cut Chinese names short at a third of the intended length.

**Photo upload and thumbnail generation (MAT-471)**
You can now upload a photo (JPEG, PNG, or WebP, up to 20 MB). The server checks the actual file contents to confirm it's really an image — not just trusting whatever the browser claims. It automatically creates a smaller preview version (thumbnail) capped at 1200 pixels on the longest side. Both the original and thumbnail are saved to a local folder. Face bounding box coordinates are stored as 0–1 decimal fractions (e.g. 0.5 = the middle of the image), not pixel counts — so they work correctly no matter what screen size the photo is displayed at.

**Share links (MAT-473)**
You can now generate a shareable link for any photo you've uploaded. The link contains a random token — a string of characters generated using the computer's secure random number source, making it impossible to guess. Anyone with the link can view the photo and its confirmed name labels without needing an account. You can revoke the link at any time (which breaks the old URL), and generating a new one creates a fresh token.

**A `/summaryfordummy` slash command**
A custom command was added to Claude Code (`.claude/commands/summaryfordummy.md`). Type `/summaryfordummy` at any point in a session and it writes one of these plain-English summaries automatically.

### What's next
Phase 0 is done. Phase 1 is the first thing the user actually sees: upload a photo → faces get detected automatically in the browser → you name them → you or anyone with the link can tap a face to see the name. That's the core experience.

---
