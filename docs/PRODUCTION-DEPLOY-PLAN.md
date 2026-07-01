# Production deploy architecture for nashishei

**Status:** planned, not yet implemented. Supersedes `docs/updated-architechture.md` (which describes the abandoned Tauri desktop-authoring architecture).

## Context

nashishei currently only runs via `docker compose` + `npm run dev` on localhost. The goal is to make it a real, always-on web app that both the authoring user and the church congregation (viewers) hit over HTTPS — no local dev servers required.

The app already fully pivoted off Tauri/desktop to browser-side ML (`onnxruntime-web`, MAT-525): face detection and ArcFace recognition run entirely in the visitor's browser, and the frontend only calls `POST /api/images/{id}/detect-client`. This means the cloud backend is genuinely thin (CRUD + pgvector similarity queries, no ML compute), which shapes every choice below toward "small and cheap," not "scale for ML workloads."

A partial production setup already exists from the abandoned Tauri effort: `api/fly.toml` (Fly.io app `api-black-silence-6888`, 1GB volume, scale-to-zero) and a Neon Postgres+pgvector database (per `docs/tauri-exe-explainer.md`). No frontend hosting was ever set up (Tauri used to bundle the frontend into the desktop app). This plan keeps the working pieces, adds what's missing (frontend hosting, real object storage), and removes what's now dead weight (the Python ML sidecar).

Two decisions were confirmed with the user rather than assumed:
- **Photo access model:** keep the current trust model — unguessable-but-unauthenticated URLs (matches how share-token links already work today). No authenticated proxy in front of photos.
- **Domain:** start on free subdomains (`*.pages.dev` for frontend, `*.fly.dev` for API). No custom domain purchase for this pass.

## Architecture

| Piece | Where | Why |
|---|---|---|
| Go API | Fly.io (keep `api-black-silence-6888`) | Already correctly shaped (`min_machines_running=0`, scale-to-zero, 1GB shared CPU) for a thin CRUD+pgvector service. No reason to re-platform something that already works for zero benefit. |
| Postgres + pgvector | Neon (keep) | Already provisioned; scale-to-zero pairs with Fly's. |
| Object storage (photos) | Cloudflare R2 (new — replaces Fly volume) | Real durability/offsite backup for actual family photos, vs. a single 1GB Fly volume with no snapshot story. S3-compatible, free egress. |
| Frontend app shell | Cloudflare Pages (new) | Free git-triggered builds (CI/CD for free, no YAML), serves the ~1.75MB Vite build. |
| ML model/runtime assets | Cloudflare R2 (new — same bucket family as photos) | **Not optional/preference** — `w600k_r50.onnx` is 174MB and the WASM runtime files run up to 25.6MB; Pages (and every comparable static host) caps individual deployed files around 25MB. These files physically cannot ship as part of a normal Pages build. |

Frontend and API stay **cross-origin** (`*.pages.dev` ↔ `*.fly.dev`), not reverse-proxied to same-origin. The cookie code already handles this correctly: `api/internal/handler/auth.go:95-129` sets `SameSite=None; Secure` whenever `cfg.SecureCookie` is true, which `ENV=production` (already set in `fly.toml`) already triggers. **No code change needed for cookies.** The only real gap is CORS.

## Required changes

**1. Fix the CORS vulnerability (do this regardless of anything else — it's live today)**
`api/cmd/api/main.go:91-111` — `corsMiddleware` reflects *any* request `Origin` back with `Access-Control-Allow-Credentials: true`, and the `cfg.FrontendURL` argument passed in is discarded (`func corsMiddleware(_ string)`). Replace with an explicit allowlist: add `ALLOWED_ORIGINS` (comma-separated) to `config.go`, check the incoming `Origin` against it, and only set CORS headers when it matches — otherwise omit them (no `*` fallback for credentialed routes).

**2. Object storage: add an R2 backend behind the existing interface**
`api/internal/storage/local.go` already exposes the right shape (`Save`, `PathFor`, `URL`, `DeleteAll`). Add a sibling `R2` implementation using `aws-sdk-go-v2/service/s3` pointed at the R2 S3-compatible endpoint, select the driver by env in `main.go`, then delete the `/files/*` local-file-server route (`main.go:57-63`) and `storage/local.go` once R2 is wired. Configure R2 bucket CORS (`AllowedOrigins`: the Pages domain, `AllowedMethods: GET, HEAD`) to preserve the existing "canvas `toDataURL` from any frontend origin" behavior called out in the current code comment.

**3. Frontend: point ML asset loads at R2, fix the build pipeline**
- Add a `VITE_ASSET_BASE` build-time env var (default `''`, preserving today's same-origin `public/` behavior for local dev/docker-compose). Use it to prefix the model URLs in `frontend/src/lib/mlBrowser.ts` (currently root-relative fetches of `/models/w600k_r50_sim.onnx` etc.) and `arcfaceSpike.ts`, plus `ort.env.wasm.wasmPaths` for the runtime files.
- `frontend/package.json`'s `copy-wasm` script is not wired into `build` — add `"prebuild": "npm run copy-wasm"` so `npm run build` (and every Pages build) always populates `public/ort/` first. This is a real gap today, not new.
- COOP/COEP headers: **skip for now.** `mlBrowser.ts:343` hardcodes `ort.env.wasm.numThreads = 1` unconditionally, so WASM multithreading isn't attempted and the headers have no effect currently. Revisit only if multithreading is ever turned on (and note: both the Pages domain and the R2 asset domain would need matching headers then).

**4. Delete dead ML-sidecar code** (frontend hasn't called it since MAT-525 — confirmed only `/detect-client` is used, `useFaceDetection.ts:44`)
- `ml/` directory entirely (`main.py`, `sidecar_main.py`, `Dockerfile`, `build_sidecar.ps1`).
- `api/internal/handler/detect.go` (`DetectImage`, `callMLSidecar`) and its route at `main.go:73`.
- `docker-compose.yml`'s `ml` service.
- `MLSidecarURL` from `config.go`, `ML_SIDECAR_URL` from `fly.toml`/`docker-compose.yml`.

**5. Minimal hardening while touching `main.go` anyway**
Add graceful shutdown (`http.Server` + `signal.NotifyContext` + `.Shutdown(ctx)` instead of bare `ListenAndServe`). Fly sends `SIGTERM` on every deploy and every scale-to-zero stop; without this, an in-flight photo upload can be cut mid-write. Small (~15 lines), protects real user data.

**6. Config/secrets**
Set via `fly secrets set` (established pattern already in use):
- `JWT_SECRET` — generate a real random value; never the `dev-secret-change-in-prod` fallback in `config.go:30`.
- `DATABASE_URL` — Neon connection string.
- `ALLOWED_ORIGINS` — the Pages `*.pages.dev` production URL.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.
- Drop `STORAGE_PATH` and the Fly volume mount from `fly.toml` once R2 is live.
- Cloudflare Pages gets `VITE_API_BASE` / `VITE_ASSET_BASE` set in its dashboard, not the repo.

**7. DB migrations: run `goose` manually, not via Fly `release_command`**
Same `Makefile` `migrate` target as today, just pointed at the Neon URL, run by hand right before each deploy that needs it. At this release cadence (solo, infrequent), automating this adds real complexity (bake `goose` into the release image, handle release-command failures blocking deploy) for no real benefit — and manual running lets a human eyeball migration output against real users' data before it's irreversible.

**8. CI/CD: none needed beyond what Pages gives for free**
Cloudflare Pages auto-builds on git push — that's CI/CD for the frontend with zero YAML. The API deploys infrequently and migrations already require a manual step first, so a manual `fly deploy` is the right amount of process. No GitHub Actions needed for this pass.

## Suggested order

1. Backend: fix CORS allowlist, add graceful shutdown, delete `ml/` + `detect.go`'s `DetectImage` + its route + compose's `ml` service + `MLSidecarURL` everywhere.
2. Add `storage.R2`, wire driver selection in `main.go`, delete `/files/*` + `storage/local.go` once confirmed working.
3. Frontend: add `VITE_ASSET_BASE`, update the 3 model-URL call sites + `wasmPaths`, add `prebuild: copy-wasm`.
4. Provision Cloudflare R2 buckets (photos, ML assets), set bucket CORS, note the public URLs.
5. Create the Cloudflare Pages project (git-connected, root `frontend`, build `npm run build`, output `dist`), set env vars.
6. Set Fly secrets, trim `fly.toml`/`config.go` of dead config, remove the volume mount.
7. Run `goose up` by hand against Neon.
8. `fly deploy`; sync `frontend/public/models` + `public/ort` to the R2 assets bucket.
9. Push to `main` to trigger the Pages build.
10. Update `docs/DEVLOG.md`; delete/replace `docs/updated-architechture.md`.

## Verification (when implemented)

- `curl https://<fly-app>.fly.dev/health` returns 200 with DB reachable.
- From the deployed Pages URL: register → login (verify session cookie is set with `SameSite=None; Secure`, survives reload) → upload a photo (lands in R2, not a local volume) → run detection (confirm model files load from the R2 asset domain, not 404 from Pages) → name faces → generate a share link → open the share link in an incognito window (no auth) and confirm the photo/labels render.
- Confirm the old `/images/{id}/detect` route and `ml` service are gone: `curl -X POST https://<fly-app>.fly.dev/api/images/x/detect` should 404, and `docker compose config` should show no `ml` service.
- Confirm CORS: a request from a disallowed origin gets no `Access-Control-Allow-Origin` header (test with `curl -H "Origin: https://evil.example" -I https://<fly-app>.fly.dev/api/health`).

## Open items not yet decided

- **Photo privacy model** was confirmed for this pass as "keep current unauthenticated-but-unguessable URL model," matching the existing share-link trust model. Revisit if the app ever needs stricter access control (e.g. non-consenting minors' photos, per the TouchPoint/biometric privacy gate already flagged in `docs/PROJECT.md` §9-10).
- **Custom domain** deferred — starting on free `*.pages.dev`/`*.fly.dev` subdomains. Add later without re-architecting.
