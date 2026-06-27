## 6. Architecture

Two clients, one thin backend. The expensive compute (face detection +
ArcFace embedding generation) runs **locally in a desktop app**, so the
cloud never pays for ML RAM. The cloud shrinks to a small API + Postgres +
object storage.

### Clients

- **Authoring app (desktop, Tauri).** Wraps the existing React + Vite
  frontend; ships as a signed installer for Windows + macOS (Intel + Apple
  Silicon). This is where photos are uploaded, faces corrected, and names
  entered. Author-only — the people doing the work, not the audience.
- **Viewing surface (web, hosted).** The share link. Plain browser, no
  install, no inference. Fetches the image + a JSON of boxes/names and
  renders tap-to-reveal / show-all-labels. This MUST stay web — you cannot
  send a 90-year-old congregation an .exe.

### Backend (thin, cheap)

- **API / CRUD / auth / sharing:** Go + chi. The desktop app talks to it
  over HTTPS exactly as a browser would — never directly to Postgres.
- **DB:** Postgres (+ pgvector, Phase 2). Stores boxes, names, share
  tokens, and embeddings. pgvector **similarity search runs here** (it's a
  cheap query); only embedding *generation* is heavy, and that's local.
- **Storage:** object storage for original images + face crops, so the web
  viewer can load them.

### ML service (relocated, not rewritten)

- Python FastAPI sidecar — MediaPipe (Phase 1) → InsightFace detection +
  ArcFace embeddings (Phase 2). Identical to the original plan, but the
  process now runs on **127.0.0.1**, spawned by the desktop app as a Tauri
  bundled sidecar binary, instead of on a server. The §6 sidecar isolation
  is what makes this relocation nearly free.

### Data flow (authoring)

1. Author picks a photo (local).
2. Local FastAPI: detect → boxes + crops; ArcFace → embeddings.
3. Desktop app uploads original + crops to object storage and
   boxes/embeddings/tags to Postgres via the Go API.
4. pgvector (cloud) returns suggested matches vs. prior confirmed faces.
5. Author confirms; names sync up.

### Data flow (viewing)

1. Viewer opens share link in a browser.
2. Web app fetches image + tags JSON. Renders labels. No inference.

### Rules that still hold

- **Two-problem rule:** detection vs. recognition stay separate.
- **Two-client rule (new):** authoring is concentrated (installable app OK);
  viewing is broad (must be web). Don't collapse them.

### Deploy

- Backend: managed Postgres + a small API instance + object storage
  (~$5–15/mo; no ML RAM).
- Desktop: Tauri bundler produces signed/notarized installers; Tauri
  updater ships updates.