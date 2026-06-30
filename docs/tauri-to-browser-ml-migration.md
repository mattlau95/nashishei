# Tauri → Browser-native ML Migration Report
**Date:** 2026-06-29  
**Project:** Nashishei (那是谁 — "Who Is That?")  
**Scope:** Full replacement of the Tauri desktop app + Python/InsightFace ML sidecar with in-browser ONNX inference via `onnxruntime-web`.

---

## 1. Starting Architecture (Pre-Migration)

### Stack
- **Frontend:** React + Vite, wrapped in a Tauri v2 desktop app (Windows `.exe`)
- **ML sidecar:** Python FastAPI (`ml/sidecar_main.py`), frozen with PyInstaller into a `.exe` Tauri spawns at startup
- **API:** Go + Chi, running in cloud (Fly.io)
- **Database:** Postgres + pgvector, running in cloud (Neon)

### Detection Flow
1. User uploads a photo in the Tauri window
2. Tauri invokes the ML sidecar via IPC
3. Sidecar runs InsightFace (`FaceAnalysis`, buffalo_l model pack):
   - **Detection:** SCRFD `det_10g.onnx` — RetinaFace variant, handles group photos
   - **Embedding:** ArcFace `w600k_r50.onnx` — 512-dim face embedding
4. Sidecar returns bboxes + 512-dim embeddings to the frontend
5. Frontend POSTs embeddings to cloud API (`/images/{id}/detect-client`)
6. API stores in pgvector, runs cosine similarity for name suggestions

### Pain Points
- Tauri requires a Windows desktop install — no mobile, no other devices
- PyInstaller build takes ~10 minutes; the `.exe` is not committed to git (gitignored)
- Dev environment is fragile: Python version, PyInstaller, Rust toolchain, MSVC must all align
- Cloud Postgres + pgvector search stays cheap; the ML RAM cost (1–2 GB for InsightFace) is what motivated local-only execution

---

## 2. The Decision to Pivot

The pivot was triggered by realising `onnxruntime-web` (ort) 1.27 ships a WebGPU execution provider that can run the same ONNX models in-browser with no install. If the cosine similarity between embeddings is high enough in-browser, the Tauri sidecar is redundant.

**Key question:** Do browser-computed ArcFace embeddings produce usable cosine similarities?

---

## 3. Spike Phase

### What Was Built
A throwaway test page at `/spike` (`src/pages/ArcFaceSpike.tsx`, `src/lib/arcfaceSpike.ts`) that:
1. Downloaded `w600k_r50.onnx` from HuggingFace (later: copied from `~/.insightface/models/buffalo_l/`)
2. Cached it in IndexedDB (`arcface-spike` DB)
3. Used MediaPipe `FaceDetector` to find faces
4. Ran ArcFace inference via ort WebGPU EP
5. Displayed cosine similarity matrix between uploaded photos

### First Result (Without Alignment)
- Same person: 0.3–0.4 cosine similarity
- Different person: −0.1

Low but directionally correct. Alignment was missing.

### Fix: 5-Point Similarity Transform
Switched from `FaceDetector` to `FaceLandmarker` to get 478-point landmarks, then computed:
- Left eye: landmark 468 (iris center)
- Right eye: landmark 473
- Nose: landmark 1
- Left mouth: landmark 61
- Right mouth: landmark 291

Closed-form similarity transform maps these to InsightFace's canonical 112×112 template positions:
```
[38.29, 51.70]  [73.53, 51.50]  [56.03, 71.74]  [41.55, 92.37]  [70.73, 92.20]
```

**Post-alignment result:** Same person cosine similarity improved to acceptable range. Go decision made.

### Vite Ort Loading Fix
ort 1.27 dynamically imports `.mjs` companion files at runtime. Bundling it via Vite breaks this. Fix:
```ts
// vite.config.ts
optimizeDeps: { exclude: ['onnxruntime-web'] }
```
This lets ort resolve its own worker modules via `import.meta.url`.

---

## 4. Phase A — Wire Browser ML into Production Detection Flow

### New Files Created

#### `src/lib/mlBrowser.ts`
Production ML singleton. Responsibilities:
- IndexedDB cache for ONNX model blobs (DB: `nashishei-ml`)
- Load `w600k_r50.onnx` with download progress reporting
- Create ort `InferenceSession` (WebGPU EP → WASM fallback)
- Load MediaPipe FaceLandmarker for detection
- `detectAndEmbed(img)` → `FaceResult[]` with bboxNorm + 512-dim embedding

Key design choices:
- **Singleton promise** (`_initPromise`) prevents double-init from React Strict Mode's double-effect
- **`import.meta.hot.decline()`** forces full page reload on HMR edits (module-level sessions don't survive module swaps)

#### `src/contexts/MLContext.tsx`
React context exposing `{ mlState, loadProgress, ep, mlError }` to the whole component tree. Wraps `initML()` in a `useEffect` with `.then/.catch` to drive `mlState`.

#### Rewrites

**`src/hooks/useFaceDetection.ts`**
```
Before: upload → POST /ml-sidecar/detect-and-embed → POST /api/images/{id}/detect-client
After:  upload → detectAndEmbed(img) in-browser → POST /api/images/{id}/detect-client
```
All Tauri IPC and `mlApi()` calls removed.

**`src/components/ImageDetector.tsx`**
Added `mlState` gating: detection only fires when `imgLoaded && mlState === 'ready'`. Shows "Loading face detection X%" overlay while ML initialises.

**`src/pages/Home.tsx`**
ML load progress indicator on the pick screen.

---

## 5. Phase B — Strip Tauri

Files deleted / packages removed:
- `frontend/src-tauri/` — entire Tauri Rust scaffold
- `ml/sidecar_main.py`, `ml/build_sidecar.ps1` — PyInstaller entry point and build script
- `frontend/src/lib/ml.ts` — Tauri IPC ML wrapper
- `package.json`: removed `@tauri-apps/api`, `@tauri-apps/cli`, `tauri` script
- `Makefile`: removed `tauri-dev`, `tauri-build-mac`, `tauri-build-windows` targets
- Net change: **−4,253 lines**

---

## 6. Local Dev Environment Debugging

Getting the API running locally involved several non-obvious problems:

### Docker Port Conflict
Local PostgreSQL installation on port 5432 intercepted Docker's mapped port. Fix:
```yaml
# docker-compose.yml
ports:
  - "5433:5432"   # was 5432:5432
```
And update `DATABASE_URL` to `127.0.0.1:5433` (not `localhost` — Windows resolves `localhost` to `::1` IPv6 but Docker listens on IPv4).

### UTF-8 BOM in `.env`
PowerShell's `Set-Content` writes UTF-16 LE with BOM by default. `godotenv.Load()` in Go silently fails to parse a BOM-prefixed file. Fixed by writing `.env` with a tool that produces clean UTF-8.

### Goose Migration Conflict
The `init.sql` Docker entrypoint had already created all tables. Goose tried to run migrations 1–3 and hit "table already exists" errors. Fixed by manually stamping goose_db_version records 0–3 as applied:
```sql
INSERT INTO goose_db_version (version_id, is_applied) VALUES (0,true),(1,true),(2,true),(3,true);
```

---

## 7. Auth Cookie Bug

### Symptom
Register → login → page "refreshes" without entering the app.

### Root Cause
`setSessionCookie` in `api/internal/handler/auth.go` set:
```go
SameSite: http.SameSiteNoneMode,  // requires Secure=true
Secure:   cfg.SecureCookie,        // false in dev (http://localhost)
```
Browsers silently drop `SameSite=None` cookies that lack `Secure=true`. The cookie was never stored. Every subsequent request was unauthenticated. `AuthGate` saw 401, removed `localStorage['authed']`, and returned to the login screen — instantly, with no visible error.

### Fix
```go
sameSite := http.SameSiteLaxMode
if cfg.SecureCookie {
    sameSite = http.SameSiteNoneMode
}
```
`SameSite=Lax` works for same-site dev requests (both frontend and API on localhost). `SameSite=None` is correct in production where the Tauri WebView or a different origin makes cross-site requests.

---

## 8. Browser ML Loading Failures (MediaPipe)

After fixing auth, the ML load itself failed repeatedly with: `Cannot read properties of null (reading 'Kd')` — a null dereference inside MediaPipe's minified WASM code.

### Attempts and Findings

**Attempt 1: GPU delegate removed**  
Removed `delegate: 'GPU'` from `FaceLandmarker.createFromOptions`. No change.

**Attempt 2: CDN → local WASM files**  
Copied `@mediapipe/tasks-vision/wasm/` to `public/mediapipe-wasm/`. No change.

**Attempt 3: Local model file**  
Downloaded `face_landmarker.task` (3.6 MB) to `public/models/` and switched from `modelAssetPath` (URL) to `modelAssetBuffer` (pre-fetched Uint8Array). No change.

**Attempt 4: Remove COOP/COEP headers**  
Root cause identified: with `COOP: same-origin` + `COEP: credentialless`, `crossOriginIsolated = true`. MediaPipe selected its threaded WASM variant (`vision_wasm_module_internal.js`). This variant creates Web Workers and tries to re-import itself by URL — but since it was loaded via `fetch()` not a `<script>` tag, the worker URL resolution fails, leaving an internal null.

Removing both headers set `crossOriginIsolated = false`. MediaPipe fell back to the single-threaded `vision_wasm_internal.js`. This worked — `[ML] FaceLandmarker ready` logged successfully.

**Side effect:** ort WASM threading also requires SAB. Mitigated by:
- ort uses WebGPU EP (confirmed working — no SAB needed)
- `ort.env.wasm.numThreads = 1` set explicitly as fallback

---

## 9. React Strict Mode Double-Init

After fixing MediaPipe, the app sometimes showed "ML not initialized" on the first upload attempt.

**Root cause:** React 18 Strict Mode fires `useEffect` twice in development. Without a guard, `initML()` was called concurrently. The second call tried to create a second WebGPU session while the first was still initialising, producing a race where one session was null when `detectAndEmbed()` ran.

**Fix:** Singleton promise pattern in `mlBrowser.ts`:
```ts
let _initPromise: Promise<EP> | null = null

export function initML(onProgress): Promise<EP> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => { ... })()
    .catch((e) => { _initPromise = null; throw e })
  return _initPromise
}
```
Both effect invocations receive the same promise. When it resolves, both `.then()` callbacks fire and set `mlState = 'ready'`.

---

## 10. HMR Module Swap Bug

After adding `console.log` statements to `mlBrowser.ts`, Vite hot-swapped the module. The new module instance had `_arcSession = null`, but `mlState` was already `'ready'` (set by the old instance). The next upload attempt threw "ML not initialized".

**Fix:** Declare HMR incompatibility at the top of the file:
```ts
if (import.meta.hot) import.meta.hot.decline()
```
Vite now does a full page reload on any change to `mlBrowser.ts`, keeping module state and React state in sync.

---

## 11. MediaPipe Face Detection — 0 Faces Detected

With the loading fixed, uploading a 4000×3000 group photo returned `[detect] faces found: 0`.

**Attempts:**
1. Lowered `minFaceDetectionConfidence` from 0.4 → 0.1 — still 0
2. Added downscaling to 1920px before detection — still 0
3. Confirmed MediaPipe was actually running (XNNPACK delegate message appears on first `detect()` call)

**Root cause:** MediaPipe FaceLandmarker is a landmark tracker optimised for individual faces at moderate distances. The same group photos worked in the Tauri sidecar because InsightFace's SCRFD detector (`det_10g.onnx`) is specifically designed for faces-in-the-wild: small faces, group photos, varying angles.

---

## 12. Final Solution — SCRFD via ort

Dropped MediaPipe entirely. Loaded `det_10g.onnx` (16 MB, copied from `~/.insightface/models/buffalo_l/`) via ort alongside `w600k_r50.onnx`.

### SCRFD Pipeline (JavaScript implementation)

**Input preprocessing:**
- Resize image to fit 640×640 maintaining aspect ratio (letterbox with black)
- Normalise: `(pixel − 127.5) / 128`, RGB channel order
- NCHW float32 tensor `[1, 3, 640, 640]`

**Output structure (9 tensors, accessed by index):**
- `[0..2]`: score tensors for strides [8, 16, 32]
- `[3..5]`: bbox tensors (distance format: `[d_left, d_top, d_right, d_bottom] × stride`)
- `[6..8]`: 5-point keypoint tensors (offset format: `[Δx₀, Δy₀, ..., Δx₄, Δy₄] × stride`)

**Anchor generation per stride:**
```
for row in 0..fmH:
  for col in 0..fmW:
    for anchor in 0..2:
      center = (col × stride, row × stride)
```

**Bbox decode:**
```
x1 = (cx − d_left  × stride) / scale
y1 = (cy − d_top   × stride) / scale
x2 = (cx + d_right × stride) / scale
y2 = (cy + d_bottom× stride) / scale
```

**Keypoint decode:**
```
kp_x[k] = (cx + Δx[k] × stride) / scale
kp_y[k] = (cy + Δy[k] × stride) / scale
```

**NMS:** greedy, sorted by score descending, IoU threshold 0.4

**Keypoint order (matches InsightFace canonical template):**
`[leftEye, rightEye, nose, leftMouth, rightMouth]`

These keypoints feed directly into the existing `similarityTransform()` + `alignAndPreprocess()` functions, producing the 112×112 ArcFace input — identical algorithm to the Python sidecar.

---

## 13. Final Architecture (Post-Migration)

### Stack
- **Frontend:** React + Vite, served as a pure web app (no Tauri)
- **ML:** `onnxruntime-web` in-browser, WebGPU EP (WASM fallback)
  - Detection: `det_10g.onnx` (SCRFD, 16 MB)
  - Embedding: `w600k_r50.onnx` (ArcFace, 166 MB, IndexedDB-cached)
- **API:** Go + Chi, cloud (unchanged)
- **Database:** Postgres + pgvector, cloud (unchanged)

### Detection Flow (New)
1. Page load: `initML()` downloads + caches both ONNX models, creates ort sessions
2. User picks photo → `detectAndEmbed(img)` runs fully in-browser
3. SCRFD detects faces → 5-point landmarks per face
4. Similarity transform → 112×112 aligned crop per face
5. ArcFace embedding → 512-dim vector per face
6. Frontend POSTs `{ faces: [{ bbox, embedding }] }` to `/api/images/{id}/detect-client`
7. API stores in pgvector, returns name suggestions (unchanged)

### What Was Kept
- Cloud Postgres + pgvector (similarity search is cheap)
- `POST /images/{id}/detect-client` endpoint (pre-computed embeddings)
- All frontend UI (QCOverlay, FaceNameList, Viewer, ShowAllOverlay)
- Auth flow (cookie-based JWT)

### What Was Removed
- Tauri desktop app
- Python ML sidecar (PyInstaller, FastAPI, InsightFace Python bindings)
- `@tauri-apps/api`, `@tauri-apps/cli`
- MediaPipe `@mediapipe/tasks-vision` (and its 11 MB local WASM files)
- COOP/COEP server headers

### New Dependencies
- `onnxruntime-web` (already present; now used for both models)
- `det_10g.onnx` in `public/models/` (gitignored, copied from local InsightFace cache)

---

## 14. Open Issues at Session End

1. **`det_10g` detection not yet verified** — SCRFD integration was the last change of the session. Need to confirm `[detect] faces found: N > 0` on a real group photo.
2. **Debug logs in `mlBrowser.ts`** — `console.log` statements added during debugging still present; remove once detection confirmed.
3. **`public/mediapipe-wasm/`** and **`public/models/face_landmarker.task`** — on disk but no longer used; gitignored but should be cleaned up manually.
4. **Architecture docs** — `docs/updated-architechture.md` and `docs/tauri-exe-explainer.md` describe the old Tauri stack; need updating.

---

## 15. Key Lessons

| Problem | Symptom | Root Cause | Fix |
|---|---|---|---|
| SameSite=None without Secure | Login "refreshes" silently | Browsers drop SameSite=None cookies on non-HTTPS | Use SameSite=Lax in dev |
| COOP+COEP + MediaPipe | Null dereference in MediaPipe WASM | Threaded WASM variant can't resolve its own URL when loaded via fetch | Remove COOP/COEP; let MediaPipe use single-threaded variant |
| React Strict Mode + singletons | "ML not initialized" on first upload | Double effect invocation creates two concurrent sessions | Singleton promise with `_initPromise` guard |
| Vite HMR + module singletons | "ML not initialized" after code edit | HMR swaps module instance; sessions on old instance, mlState from new | `import.meta.hot.decline()` forces full reload |
| MediaPipe on group photos | 0 faces detected | FaceLandmarker is a landmark tracker, not a crowd face detector | Replace with SCRFD `det_10g.onnx` (same model as sidecar) |
| Windows `localhost` → IPv6 | DB connection refused | Windows resolves `localhost` to `::1`; Docker listens on `0.0.0.0` (IPv4) | Use `127.0.0.1` explicitly |
| Docker port 5432 conflict | DB auth failure | Local Postgres installation intercepts Docker's port mapping | Remap Docker to 5433 |
| PowerShell UTF-8 BOM | `godotenv.Load()` silently fails | `Set-Content` writes BOM-prefixed UTF-16 LE | Write `.env` with a BOM-free tool |
