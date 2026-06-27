# How the Tauri Desktop App Works — End to End

A tutorial for someone who knows code but hasn't shipped a desktop app with a bundled AI model before.

---

## The Problem We Were Solving

You have a React web app. It runs in a browser. You also have a Python face-detection service (InsightFace) that needs to run locally because:

1. Hosting a machine learning model in the cloud costs real money (RAM + GPU)
2. You want it to work offline
3. The model is too heavy to run in a browser (it's Python + C++ extensions, not WebAssembly)

The naive approach — "just run Python on the user's machine" — falls apart immediately. You can't ask congregation members to install Python, then pip install a 500 MB model, then run a terminal command. You need a single double-clickable `.exe`.

That's the whole reason this effort existed.

---

## What Tauri Actually Is

Tauri is a framework for building desktop apps using web technologies (HTML/CSS/JS) for the UI, but **Rust** as the native shell.

Think of it like Electron, but instead of bundling an entire copy of Chromium (~150 MB), Tauri uses the **OS's built-in browser engine**:
- Windows → WebView2 (the same engine as Edge, built into Windows 10/11)
- macOS → WKWebView (Safari's engine)
- Linux → WebKitGTK

This means the installer is tiny (ours is ~14 MB for the Go API docker image; the `.exe` installer itself is the Tauri app + your JS bundle).

### The mental model

```
nashishei.exe
├── WebView2 window        ← your React app renders here (HTML/CSS/JS)
├── Rust process           ← the "host" that owns the window
│   └── spawns child:
│       └── nashishei-ml.exe   ← your frozen Python ML server
```

The Rust process is the OS-native parent. It owns the window, handles the app lifecycle (startup, shutdown), and can do things the browser can't — like spawning child processes, reading files, talking to hardware. Your React app runs inside the WebView2 window and communicates with Rust via **commands** (more on that below).

---

## The Two-Client Architecture Decision

We decided early that there would be **two different clients**:

| Client | Who uses it | Where it runs |
|---|---|---|
| Tauri desktop app | The photo author (you) | Installed `.exe` on Windows |
| Web browser | Viewers (congregation members) | Share link, no install |

This mattered because:
- Viewers can't install anything. They get a link, they tap it, it opens.
- The author needs ML detection, which requires local compute.
- Keeping them separate means the viewer experience is never degraded by author complexity.

The **cloud Go+Postgres backend stays for both** — it stores images, names, share tokens, and runs pgvector similarity search. Only the ML model moved to the local desktop.

---

## The Files Involved and What They Do

### `frontend/src-tauri/` — the Rust shell

This is the Tauri-specific part. When you run `npm run tauri build`, Tauri:
1. Runs Vite to build your React app into static files (`frontend/dist/`)
2. Compiles the Rust code in `src-tauri/` into a native binary
3. Bundles everything — the static files, the Rust binary, icons, and any sidecar executables — into an installer

Key files:

**`src-tauri/tauri.conf.json`** — the Tauri config. Like `package.json` but for the desktop app. Defines:
- App name, version, window size
- What icons to use
- What external binaries to bundle (`externalBin`)
- Security settings (CSP, etc.)

**`src-tauri/src/lib.rs`** — the Rust code that runs when the app starts. We wrote two things here:
1. Spawn the ML sidecar process on startup
2. A `ml_base_url` command so the frontend can ask Rust where the ML server is

**`src-tauri/capabilities/default.json`** — Tauri v2's permission system. Every plugin capability has to be explicitly listed here. We added `shell:allow-spawn` so Rust can spawn child processes.

---

### `ml/sidecar_main.py` + `ml/build_sidecar.ps1` — the frozen Python server

Your existing ML code (`ml/main.py`) is a FastAPI server. In Docker it starts fine. But in an `.exe` there's no Docker.

**PyInstaller** solves this. It freezes your Python interpreter + all your dependencies into a single self-contained executable. The user's machine doesn't need Python installed.

`sidecar_main.py` is the entry point PyInstaller compiles. It:
1. Detects whether it's "frozen" (i.e., running as a compiled exe vs. raw Python)
2. If frozen, sets `INSIGHTFACE_HOME` to a directory next to the `.exe` — this is where the buffalo_l face model weights live
3. Starts uvicorn (the ASGI server that runs FastAPI) on port 8001

`build_sidecar.ps1` is the PowerShell script that runs PyInstaller with all the right flags:
- `--onefile` → one big `.exe` instead of a folder of files
- `--collect-data insightface` → bundle the InsightFace data files (model configs, etc.)
- Hidden imports for uvicorn → PyInstaller can't always auto-detect dynamic imports in async frameworks

The output goes to `frontend/src-tauri/binaries/nashishei-ml-x86_64-pc-windows-msvc.exe`. That filename suffix (`x86_64-pc-windows-msvc`) is required — Tauri uses it to know which binary to bundle for which platform.

---

### `tauri.conf.json` → `externalBin`

```json
"bundle": {
  "externalBin": ["binaries/nashishei-ml"]
}
```

This tells Tauri: "when you build the installer, include this binary." Tauri appends the target triple automatically, so it finds `nashishei-ml-x86_64-pc-windows-msvc.exe` on Windows.

---

### `src-tauri/src/lib.rs` — spawning the sidecar

```rust
struct MlSidecar(Mutex<Option<CommandChild>>);

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())   // registers the shell plugin
    .invoke_handler(tauri::generate_handler![ml_base_url])  // registers commands
    .manage(MlSidecar(Mutex::new(None)))  // shared state across the app
    .setup(|app| {
      match app.shell().sidecar("nashishei-ml").and_then(|cmd| cmd.spawn()) {
        Ok((_, child)) => {
          *app.state::<MlSidecar>().0.lock().unwrap() = Some(child);
        }
        Err(e) => log::error!("Failed to spawn ML sidecar: {e}"),
      }
      Ok(())
    })
    // ...
}
```

**What `tauri_plugin_shell` is:** a Tauri plugin that gives Rust the ability to spawn child processes (sidecars and arbitrary shell commands). Without it, Tauri's default security model blocks process spawning entirely.

**What `.manage(MlSidecar(...))` does:** Tauri has a typed state store. By storing the `CommandChild` handle in managed state, we keep it alive for the entire app lifetime. If we dropped it, the OS would kill the child process. When the app exits, the Mutex is dropped, the CommandChild is dropped, and the OS kills the ML server.

**What `ml_base_url` command does:** a Tauri command is just a Rust function exposed to JavaScript. The React frontend calls `invoke('ml_base_url')` and gets back `"http://127.0.0.1:8001"`. This way the frontend doesn't have the port hardcoded — Rust controls it.

---

## The Production URL Problem

In development, you run `npm run tauri dev`. Vite starts a dev server at `http://localhost:5173`. Vite has a **proxy** configured: any request to `/api/...` gets forwarded to your Go backend at `localhost:8080`. The browser never talks directly to the backend.

In the installed `.exe`, **there is no Vite.** There is no dev server. There is no proxy. The React app is compiled static files baked into the binary.

When the app calls `fetch('/api/images')`, that request goes to... nowhere. `/api/images` is a relative URL, so it resolves against the WebView2 origin (`https://tauri.localhost/api/images`). That doesn't exist.

**The fix:** `VITE_API_BASE` environment variable.

At **build time** (not runtime), you pass:
```bash
VITE_API_BASE=https://api-black-silence-6888.fly.dev npm run tauri build
```

Vite bakes that URL into the compiled JS bundle as `import.meta.env.VITE_API_BASE`. Then the `api()` helper function uses it:

```typescript
// frontend/src/lib/api.ts
const BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export function api(path: string, init?: RequestInit): Promise<Response> {
  const url = BASE
    ? `${BASE}${path.replace(/^\/api/, '')}`  // prod: full URL, strip /api prefix
    : path                                     // dev: relative URL, Vite proxy handles it
  return fetch(url, init)
}
```

In dev: `BASE` is empty → `url = '/api/images'` → Vite proxy forwards it.
In prod: `BASE = 'https://api-black-silence-6888.fly.dev'` → `url = 'https://api-black-silence-6888.fly.dev/images'` → direct HTTPS request.

Similarly, `mlApi()` in `frontend/src/lib/ml.ts` calls `invoke('ml_base_url')` to get the sidecar URL from Rust, then fetches directly to `http://127.0.0.1:8001/detect-and-embed`.

---

## The Detect-Client Architecture Split

The original flow was:
```
Frontend → POST /api/images/{id}/detect → Go backend → ML service (cloud) → pgvector
```

This doesn't work anymore because the ML service is now **local to the user's machine**. The cloud Go backend can't reach `http://127.0.0.1:8001` on your laptop.

New flow:
```
Frontend → POST /api/images          → Go backend (stores image, returns ID)
Frontend → POST /detect-and-embed    → Local ML sidecar (runs InsightFace, returns embeddings)
Frontend → POST /api/images/{id}/detect-client → Go backend (stores embeddings, runs pgvector similarity)
```

The frontend becomes the orchestrator. It talks to both the local sidecar and the cloud backend, then stitches the results together. The cloud backend never needs to know about the local sidecar.

`detect_client.go` is the new Go handler that accepts the client-provided embeddings (as `vector(512)` pgvector values) rather than running detection itself.

---

## The Deployment Stack

### Neon (managed Postgres)

Your Go backend needs Postgres with pgvector for face embedding similarity search. Options:
- **Fly.io managed Postgres** — doesn't ship pgvector
- **Supabase** — has pgvector, but the free tier pauses your database after 1 week of inactivity
- **Neon** — has pgvector, free tier never pauses, has a Sydney (and US East) region

We picked Neon. `db/init.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` and creates the schema. You paste this into Neon's SQL Editor in the dashboard.

### Fly.io (Go API)

`api/Dockerfile` is a two-stage build:
1. Stage 1 (`golang:1.26-alpine`): compile the Go binary with `CGO_ENABLED=0` (static binary, no C dependencies)
2. Stage 2 (`alpine:3.20`): copy just the binary into a tiny image (~14 MB)

`api/fly.toml` configures the Fly.io deployment:
- App name, region (`ewr` = Secaucus, NJ — closest to you)
- A persistent 1 GB volume at `/storage` for uploaded images (otherwise they'd vanish on redeploy)
- `auto_stop_machines = "stop"` + `min_machines_running = 0` → the machine sleeps when idle (saves money), wakes on the first request (cold start ~1-2 seconds)

Secrets (DATABASE_URL, JWT_SECRET, etc.) are stored in Fly's secret store and injected as environment variables at runtime — they're never in the repo.

---

## The CORS Problem (and why it was hard)

CORS (Cross-Origin Resource Sharing) is a browser security mechanism. When JavaScript on one origin (`https://tauri.localhost`) tries to fetch from a different origin (`https://api-black-silence-6888.fly.dev`), the browser first sends a **preflight OPTIONS request** asking "is this allowed?"

The server must respond with headers like:
```
Access-Control-Allow-Origin: https://tauri.localhost
Access-Control-Allow-Credentials: true
```

If it doesn't, the browser blocks the actual request. The JavaScript fetch throws a `TypeError` — which looks exactly like a network error to the user.

**What we ran into:**

The original CORS middleware had an allowlist:
```go
allowed := map[string]bool{
    "https://tauri.localhost": true,
    "tauri://localhost": true,
    // etc.
}
```

But WebView2 (the browser engine inside Tauri on Windows) was sending an `Origin` header that wasn't in our list. We could see in the Fly.io logs that OPTIONS requests were arriving and returning 204 — but no `Access-Control-Allow-Origin` header was in the response, so the browser blocked the POST.

We couldn't easily see what origin WebView2 was actually sending without devtools (which are disabled in production builds). So we switched to **reflecting any origin** — whatever `Origin` header arrives, echo it back:

```go
origin := r.Header.Get("Origin")
if origin != "" {
    w.Header().Set("Access-Control-Allow-Origin", origin)
    w.Header().Set("Access-Control-Allow-Credentials", "true")
}
```

This is safe for a desktop app because CSRF attacks (which CORS protects against) require a victim to visit a malicious website that makes requests on their behalf. In a desktop app, your WebView2 is not visiting random websites.

---

## The Cookie / Auth Problem

Login sets a session cookie. The cookie contains a JWT (signed token that proves who you are). Every subsequent request sends the cookie back, and the Go middleware verifies the JWT.

The problem: **`SameSite=Lax`**.

`SameSite` is a cookie attribute that controls when the browser sends the cookie. `Lax` means: send the cookie on same-site requests and top-level navigations, but **not on cross-origin `fetch()` calls with credentials**.

Our request from `https://tauri.localhost` to `https://api-black-silence-6888.fly.dev` is cross-origin. With `SameSite=Lax`, the browser stores the cookie after login but then refuses to send it on subsequent API calls. Every call returns 401 (unauthorized), even though you just logged in.

Fix: `SameSite=None; Secure`. This tells the browser: "send this cookie on all cross-origin requests, including credentialed fetch." The `Secure` flag is required when `SameSite=None` — the spec mandates it (to ensure the cookie only travels over HTTPS).

---

## The Auth State Bug (still open)

There's a known bug. The app tracks "is the user logged in?" with:

```typescript
// App.tsx
const [authed, setAuthed] = useState(() => localStorage.getItem('authed') === '1')
```

After login succeeds, we write `localStorage.setItem('authed', '1')`. On next app launch, we read it back and skip the login screen.

The problem: `localStorage` and the session cookie are independent. If the cookie expires (or is cleared), `localStorage` still says `'1'`, so the app shows the home screen — but every API call fails with 401 because there's no valid cookie.

What needs to happen: on startup, hit `GET /me` (a new endpoint that just returns the current user if authenticated, or 401 if not). If 401, clear the flag and show login. There also needs to be a **logout button** that calls `POST /auth/logout` (clears the cookie server-side) and clears the localStorage flag.

This is the next thing to fix.

---

## The Build Process, Start to Finish

Here's how to build the `.exe` for real:

```powershell
# 1. Build the ML sidecar (do this once, or when ml/main.py changes)
#    Output: frontend/src-tauri/binaries/nashishei-ml-x86_64-pc-windows-msvc.exe
cd ml
.\build_sidecar.ps1

# 2. Build the Tauri app with the real API URL baked in
cd ..\frontend
$env:VITE_API_BASE = "https://api-black-silence-6888.fly.dev"
npm run tauri build

# Installers are at:
#   src-tauri/target/release/bundle/nsis/nashishei_0.1.0_x64-setup.exe  (NSIS installer)
#   src-tauri/target/release/bundle/msi/nashishei_0.1.0_x64_en-US.msi   (MSI installer)
```

To deploy backend changes:
```powershell
cd api
fly deploy   # rebuilds Docker image, rolls out new version
```

To run in development (with hot reload and devtools):
```powershell
# Terminal 1: start the Go API
cd api
go run ./cmd/api

# Terminal 2: start the ML service (Docker)
docker compose up ml

# Terminal 3: start Tauri in dev mode
cd frontend
npm run tauri dev
# Opens a window with hot reload. F12 opens devtools.
```

---

## Plugins and Dependencies Summary

| Thing | What it is | Why we need it |
|---|---|---|
| `tauri-plugin-shell` | Tauri plugin for spawning processes | Lets Rust start the ML sidecar exe |
| `@tauri-apps/api` | JS library | Lets React call `invoke('ml_base_url')` to talk to Rust |
| `@tauri-apps/cli` | Build tool | `npm run tauri build` / `npm run tauri dev` |
| PyInstaller | Python → exe freezer | Bundles Python + InsightFace into a single executable |
| `uv` | Python package manager (replaces pip) | What your system uses; `uv pip install` instead of `pip install` |
| WebView2 | Browser engine on Windows | Built into Windows 10/11; Tauri uses it for the UI |
| Neon | Managed Postgres with pgvector | Hosts the database in the cloud; free tier doesn't pause |
| Fly.io | Container hosting | Runs the Go API; `ewr` region is in Secaucus, NJ |
| pgvector | Postgres extension | Stores face embeddings as `vector(512)`; cosine similarity search |

---

## Where Things Live

```
nashishei/
├── api/                        Go backend
│   ├── cmd/api/main.go         Entry point + CORS middleware + router
│   ├── internal/handler/       HTTP handlers (auth, images, detect, detect_client, etc.)
│   ├── Dockerfile              Production Docker build
│   └── fly.toml                Fly.io deployment config
├── frontend/                   React + Vite + Tauri
│   ├── src/
│   │   ├── lib/api.ts          api() helper — routes to cloud backend
│   │   ├── lib/ml.ts           mlApi() helper — routes to local sidecar
│   │   ├── hooks/useFaceDetection.ts   Orchestrates upload → sidecar → detect-client
│   │   └── ...                 All other React components
│   ├── src-tauri/
│   │   ├── src/lib.rs          Rust: spawns ML sidecar, exposes Tauri commands
│   │   ├── tauri.conf.json     App config, window size, externalBin
│   │   ├── capabilities/       Permission grants (shell:allow-spawn, etc.)
│   │   └── binaries/           ← GITIGNORED: the compiled ML sidecar exe goes here
│   └── vite.config.ts          Dev proxy + VITE_API_BASE wiring
├── ml/
│   ├── main.py                 FastAPI + InsightFace detection server
│   ├── sidecar_main.py         PyInstaller entry point (sets INSIGHTFACE_HOME, starts uvicorn)
│   └── build_sidecar.ps1       Script that runs PyInstaller
└── db/
    └── init.sql                Schema + pgvector extension (applied to Neon once)
```
