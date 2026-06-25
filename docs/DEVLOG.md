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

## 2026-06-25 - End-to-end debugging: face detection, share link, auth UI, label layout

**Session Goal:** Get the Phase 2 stack working end-to-end — ML detects all faces, share link opens the viewer, show-all labels connect correctly.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **`g++` added to ML Dockerfile apt install:** `insightface==0.7.3` includes a Cython C++ extension (`mesh_core_cython`). `python:3.12-slim` ships no C++ compiler. Without `g++` the pip install fails at the compile step — no workaround, just a missing build dep.

* **`det_size=(1280, 1280)` at startup over `(640, 640)` default:** InsightFace's detection model downscales input to `det_size` before running inference. At `(640, 640)`, faces in a 4032×3024 group photo are too small to detect — the downscale ratio pushes faces below the minimum detectable size. Setting a larger size at singleton initialization time captures all faces at the cost of slower inference. Per-request `prepare()` calls were also tried but are silently ignored by InsightFace once `det_size` is already set.

* **`face_app.models['detection'].input_size` direct attribute override for per-request sizing over re-initializing the singleton:** InsightFace's `FaceAnalysis.prepare()` ignores repeated calls with a different `det_size` ("det_size is already set in detection model, ignore"). Directly writing to the SCRFD model's `input_size` attribute bypasses this guard. This lets each request scale to the actual image dimensions (capped at 1920×1920, rounded to 32px) without recreating the model.

* **`ImageOps.exif_transpose()` before detection (ML) and `imaging.AutoOrientation(true)` before thumbnail generation (API):** Phone photos are physically stored sideways (4032×3024) with an EXIF rotation tag saying "display this as 3024×4032." Without applying the EXIF tag, InsightFace sees a landscape image and returns bboxes in the wrong coordinate space; the API stores the wrong dimensions and generates a sideways thumbnail. Both fixes must be applied together — fixing one without the other misaligns bboxes against the thumbnail.

* **`FRONTEND_URL` config split from `BASE_URL`:** In dev, the API runs on `:8080` and Vite on `:5173`. Share URLs must point to Vite (where React Router handles `/s/:token`). `BASE_URL` is still needed for file-serving URLs (the `/files/` route is on the API). Splitting into two config values lets them differ in dev and converge in prod (where a reverse proxy puts both under the same origin). The OG page redirect and `GenerateShareToken` both use `FRONTEND_URL`.

* **`AuthGate` + `AuthPage` over redirecting to a dedicated `/login` route:** The app has one protected route (`/`). `AuthGate` wraps it in-place — if not authed, renders `AuthPage` instead of `<Home />`, then replaces itself once the cookie is set. No router navigation, no flash of the home page, no `location.state` to thread through. A `/login` route would be correct for an app with many protected routes; for one it's unnecessary machinery.

* **`useLayoutEffect` + `offsetWidth` measurement for `lineX2` over a fixed `CHAR_W` estimate:** `estWidth = name.length * CHAR_W` can only approximate actual rendered text width — font metrics, padding, and the image container's pixel width all interact. After `resolveCollisions` shifts labels horizontally, the estimated center `labelLeft + estWidth/2` consistently lands to the right of the actual label pill. Measuring `el.offsetWidth` after the first paint gives the exact width for every label; `setMeasuredX2` triggers a second (SVG-only) render with correct `x2` values.

* **CSS `bottom` anchor for above-face labels over `top` + fixed `LABEL_H` offset:** The line endpoint is at `bbox_y - LINE_GAP` (a Y position the SVG can draw to exactly). For the label to visually connect, its bottom edge must sit at that same Y. Using `top: labelTopY%` requires knowing the label's pixel height in normalized coordinates — a constant (`LABEL_H`) that was 0.06 but actual rendered height was ~0.03–0.04, leaving a visible gap. `bottom: (1 - lineAnchorY) * 100%` pins the div's bottom edge directly to the line endpoint regardless of actual font rendering height.

* **`labelHitsFace()` flip check over a fixed above/below rule:** The `ABOVE_THRESHOLD = 0.25` rule works for most faces but fails when two faces are vertically close — the "above" label for the lower face lands on the upper face. A pre-placement check against all other face bboxes (using `LABEL_H_EST` for the label height estimate) catches this case and flips to the other side. When both sides hit a face, the threshold-side preference is kept — this is the least-bad option and rare in practice.

* **`main.py` volume-mounted in docker-compose over rebuilding the ML image on every code change:** The ML Docker image takes several minutes to build (installs insightface, bakes the 500MB buffalo_l weights). Volume-mounting `ml/main.py` into the running container means Python code changes take effect after a `docker compose restart ml` (~5 seconds) with no rebuild. Caveat: a clean `docker compose build ml` bakes the weights-only image; the mount overlays `main.py` at runtime.

### Technical Notes

* InsightFace singleton `det_size` is set to `(1280, 1280)` at startup. Per-request, `face_app.models['detection'].input_size` is overwritten to the actual image dimensions (rounded to nearest 32, capped at 1920). The startup size is effectively a no-op after the first request but is kept as a valid initial state.
* `image.Decode` + blank `_ "image/jpeg"` / `_ "image/png"` imports removed from `images.go`; replaced by `imaging.Decode(..., imaging.AutoOrientation(true))` which registers and handles JPEG/PNG internally. Any existing images already stored sideways are not retroactively fixed — re-uploading is required.
* Docker Desktop WSL2 bridge causes the Go API (running on Windows host) to appear as the bridge gateway IP inside the Postgres container, missing the `trust` pg_hba rule and hitting `scram-sha-256`. Fixed by running the API inside Docker on the same compose network as `db`, using the `db` service hostname.
* `golang:1.23-alpine` was too old for `go.mod`'s `go 1.26.3` directive; switched to `golang:1.26-alpine` in `Dockerfile.dev`.
* `localStorage.getItem('authed') === '1'` used as auth-state flag — HttpOnly cookies aren't readable from JS, so there's no other way for the frontend to know if a valid session exists without a round-trip to `/api/auth/me`.
* Debug `print()` statements left in `ml/main.py` (face count, bbox, det_score per detection) — useful for ongoing tuning, low cost.

### Next Session

* Consider cleaning up `ml/main.py` debug prints once detection quality is confirmed
* Investigate label collision resolution on portrait photos where faces are vertically stacked (not just horizontally)
* Phase 2 remaining: verify show-all layout against a 10+ face photo

---

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

## 2026-06-23 - Phase 0 complete — auth, image upload, persons, share tokens
**Session Goal:** Close out all remaining Phase 0 tickets (MAT-470 through MAT-473) in one pass.
**Status:** Completed ✅ — Phase 0 fully done, all 6 tickets closed.

### The "Why" (Decision Log)
* **JWT in an HTTP-only cookie over a session store:** No Redis or DB table needed for Phase 0. JWT is stateless — the server just verifies the signature on each request. HTTP-only means JavaScript can't read the token, which closes the most common XSS attack vector. 7-day expiry is reasonable for a tool used by a small group.
* **MIME detection from file bytes, not Content-Type header:** The browser's Content-Type can be spoofed or wrong. Reading the first 512 bytes of the actual file and checking the magic bytes is always more reliable.
* **`imaging.Fit` with Lanczos for thumbnails:** Lanczos is slower than nearest-neighbour but produces sharper results, which matters for face photos where you need to see detail. At 1200px max the performance cost is negligible.
* **`crypto/rand` for share tokens:** Never use `math/rand` for anything security-related — it's predictable. `crypto/rand` uses the OS's cryptographic random source, making tokens unguessable even if an attacker knows when they were generated.
* **All four tickets done in a single commit:** They're independent features but all Phase 0 foundations. Shipping them together keeps the branch history clean — one meaningful step forward, not four noisy micro-commits.

### Technical Notes
* `isUniqueViolation` checks for Postgres error code `23505` (unique constraint violation) in the error string — used to return a clean "email already registered" 409 instead of a 500.
* `image/jpeg` and `image/png` imported as blank (`_`) imports in `images.go` — Go's image decode registry requires this; without them `image.Decode` doesn't know how to handle those formats.
* File server route uses `chi.RouteContext` to strip the `/files` prefix before passing to `http.FileServer` — the standard `http.StripPrefix` pattern doesn't compose cleanly with chi's wildcard routing.
* `display_name` length is checked in runes (`[]rune`), not bytes — a Chinese character is 3 bytes in UTF-8 but 1 rune, so byte-length checks would be wrong for the congregation's names.
* Added `JWT_SECRET` and `BASE_URL` to `.env.example` — `BASE_URL` is used to construct share URLs so they're correct whether running locally or in prod.

### Next Session
* Phase 1 — in-browser face detection with MediaPipe, SVG overlay for bounding boxes, QC correction flow (tap-to-add, drag-to-resize), face-crop name entry grid, tap-to-reveal viewer, simple show-all-labels.

---

## 2026-06-23 - Phase 1 T1 + T2 — MediaPipe detection + QC correction overlay
**Session Goal:** Land MAT-474 (face detection SVG overlay) and MAT-475 (QC correction flow).
**Status:** Completed ✅ — MAT-474 closed, MAT-475 closed. Two P2 polish tickets (MAT-480, MAT-481) captured for later.

### The "Why" (Decision Log)
* **Local WASM over CDN for MediaPipe:** CDN WASM silently failed in Vite's dev environment. Copying `@mediapipe/tasks-vision` WASM files to `public/mediapipe-wasm/` at install time gives deterministic, offline-capable loading. The directory is gitignored and rebuilt from `node_modules` — no binary blobs in version control.
* **`blaze_face_full_range` over `blaze_face_short_range`:** The short-range model missed every face in portrait and night-time group photos. Full-range handles non-frontal angles and varied distances, at the cost of being slightly slower — acceptable for a one-shot detection on image load.
* **Canvas pre-processing before MediaPipe:** Drawing to an off-screen canvas (capped at 1920px) applies EXIF orientation and normalises the bitmap before passing to the detector. Without this, rotated photos (common on mobile) produce zero detections.
* **Client-side greedy NMS (IoU 0.35):** MediaPipe returned duplicate boxes on some photos. A simple greedy non-maximum suppression pass, ordered by confidence, deduplicates without any server round-trip.
* **HTML+SVG hybrid for QCOverlay (replaced pure SVG):** `preserveAspectRatio="none"` makes SVG text positioning unreliable under non-uniform scale — the × badge was never visually aligned with its hit rect regardless of `dominantBaseline`. Switching to absolutely-positioned HTML divs (sized with `%` CSS) gives pixel-exact button dimensions and reliable pointer events. The SVG layer is kept for visual outlines only (`pointerEvents: none`).
* **Selection model for QC overlay:** Without selection state, every detected box rendered 7 handles + a delete button simultaneously — ~225 live interactive elements on a 25-face photo. Introducing `selectedId` collapses this to 9 controls at a time and eliminates hit-target collisions between neighbouring boxes.
* **Gesture intent resolved on `pointerup`, not `stopPropagation`:** The old approach used `stopPropagation` to disambiguate tap vs drag, which was fragile. The new approach sets `kind: 'pending'` on `pointerdown` and promotes to `'move'` only after crossing a 5px threshold on `pointermove`. Intent (select vs commit drag) is resolved once on `pointerup`.
* **Direct DOM mutation during drag:** Calling `setDetections` on every `pointermove` re-renders all overlay divs at 60fps. Instead, `style.left/top/width/height` and SVG `setAttribute` are written directly on the dragged element's DOM node. `setDetections` is called exactly once on `pointerup` to commit the final bbox to React state.
* **Explicit `+ Add face` button over tap-the-gaps:** Removing tap-empty-to-add eliminates the ambiguity between "tap to deselect" and "tap to add a box." A visible labelled button is also clearer for non-technical users (a primary user persona).

### Technical Notes
* `minDetectionConfidence: 0.2` — lowered from the default to catch partially-occluded faces in dense group photos; client-side NMS handles the resulting false positives.
* `dragRef = useRef<DragRef>` stores `boxEl` and `svgRectEl` (the actual DOM nodes) at `pointerdown` time, avoiding `Map.get()` lookups on every `pointermove`.
* Removed the `tr` corner handle to free that position for the × delete button — `tl`, `br`, `bl` cover diagonal resize; `tc`/`mr` cover the top and right edges.
* `tabIndex={0}` not yet added to the container — keyboard shortcuts (MAT-480) deferred to a follow-up ticket.
* MAT-481 (sticky add mode + portrait button placement) also deferred; both tickets are P2 and don't block T3.

### Next Session
* MAT-476 — T3: Face-list name entry and save to API
* MAT-480 — Keyboard shortcuts for selected box (arrow keys, Backspace, Escape, Tab) — P2, do after T3 if time allows
* MAT-481 — Add-face UX: sticky mode + top/bottom button — P2, pair with MAT-480

---

## 2026-06-23 - Phase 1 T3 — Face-list name entry and save to API
**Session Goal:** MAT-476 — face crop list, name inputs, and full save-to-API sequence.
**Status:** Completed ✅ — MAT-476 closed.

### The "Why" (Decision Log)
* **Vertical list over grid:** Single-column list gives unambiguous reading order (bbox_y → bbox_x sort), one focus per line, larger hit targets, and lower visual density — consistent with the app's brand pillar of legibility for older users. The grid's only advantage (at-a-glance overview) is recovered by the progress counter.
* **Canvas crop client-side, not a server thumbnail:** The server already generates a 1200px thumbnail for sharing, but extracting individual face regions requires knowing the bbox coordinates — information only available after QC. Doing it client-side avoids a round-trip and works offline. The image is already in memory as a blob URL, so there's no extra fetch.
* **Detection coordinates map correctly to `naturalWidth/naturalHeight`:** The MediaPipe canvas pre-processing step scales to max 1920px then normalises by the scaled canvas dimensions. Because `bbox_x = originX_scaled / cw` and `cw = origW * scale`, the normalization factors cancel: `bbox_x * origW` recovers the pixel position on the original image exactly. No scale correction needed in `FaceNameList`.
* **Three-step state machine in `Home.tsx` (`pick → qc → name`):** Keeps each phase's component self-contained. `Home` holds `File` + blob URL from step 1 so `FaceNameList` can upload the original file in step 3 without re-reading from disk.
* **Save sequence order — image first, detections second, tags last:** The API has foreign key constraints (`detections → images`, `tags → detections`, `tags → persons`). Upload order must respect them. Persons are created inline during the tag loop rather than upfront, since we don't know names until the user types them.
* **Auth required for save, no login UI yet:** All save endpoints (`POST /images`, `POST /detections/batch`, `POST /persons`, `POST /tags`) require a valid session cookie. The frontend surfaces a 401 as a readable "Not logged in" error. Auth UI is deferred — for now, dev sessions can authenticate via curl.

### Technical Notes
* `FaceNameList` draws each crop to an off-screen 96×96 canvas in a `useEffect` that fires once on mount. The canvas `toDataURL('image/jpeg', 0.85)` produces compact data URLs stored in a `Record<string, string>` keyed by detection ID.
* Tab/Enter key handler in name inputs uses an `inputRefs` array (`useRef<(HTMLInputElement | null)[]>`) to imperatively focus the next field — avoids needing a focus-management library.
* `POST /detections/batch` returns saved detection IDs in the same order as the request array; the tag loop uses positional indexing (`savedDets[i]`) to correlate names → detection IDs.
* Named rows get a faint yellow background + border (`rgba(250,220,0,0.08)`) to give instant visual feedback without a checkbox.
* `go build ./...` and `tsc --noEmit` both pass clean.

### Next Session
* MAT-477 — T4: Tap-to-reveal public viewer
* MAT-482 — Design tokens
* MAT-480 — Keyboard shortcuts for selected box — P2
* MAT-481 — Sticky add mode + portrait button placement — P2

---

## 2026-06-24 - MAT-477 + MAT-478 — T4 tap-to-reveal viewer + T5 show-all-labels

**Session Goal:** Build the full public viewer — tap-to-reveal a single name (T4), then show-all-labels with leader lines and collision nudge (T5).
**Status:** Completed ✅ — MAT-477 closed, MAT-478 closed.

### The "Why" (Decision Log)

* **Absolutely-positioned HTML divs for hit targets and label pills over SVG elements:** SVG with `preserveAspectRatio="none"` distorts non-path geometry — a pattern already discovered in T2 (QCOverlay). Hit-target `%`-sized HTML divs give exact bbox coverage; pill divs give reliable text wrapping and `clamp()` edge protection. The SVG layer is kept for leader lines only (T5), where it's appropriate: lines are pure geometry and don't distort.
* **CSS `clamp()` for T4 edge protection over `getBoundingClientRect`:** JS measurement requires a `useRef`, a `useLayoutEffect`, and a second render. `clamp(8px, calc(center - 100px), calc(100% - 208px))` recalculates on every layout change (orientation, resize) with zero JS. Tradeoff accepted: assumes max label width of 200px.
* **Label above vs below: `bbox_y >= 0.25` threshold:** Labels show above the face by default (natural reading direction). Faces in the top 25% of the image get their label below to stay in-bounds. The 0.25 cutoff is a first-pass value — logged in INBOX.md for confirmation after real-photo testing.
* **`touchAction: 'manipulation'` over no attribute:** Safari's legacy double-tap-to-zoom adds a 300ms delay to all `onClick` events unless suppressed. `manipulation` removes the delay while keeping scroll and pinch-zoom intact — critical for the Elder use case on iPhone.
* **Unnamed faces produce no hit target:** A hit target that does nothing on tap is a false affordance — especially confusing on touch. No hit target = no confusion.
* **T5 layout in a `useMemo` pure function over client-side measurement:** All bbox coordinates are already normalized (0–1), so the layout algorithm (`computeLayout`) runs entirely in coordinate space — no DOM access, no refs, no second render. `useMemo` re-runs only when the label array changes.
* **SVG for T5 leader lines, HTML for T5 label pills (two-layer approach):** The same SVG/HTML split from T2. Leader lines are `<line>` elements in a `viewBox="0 0 1 1"` overlay — normalized coords work naturally for geometry. Label pills are HTML divs — needed for text wrapping, token-based styles, and `overflow: hidden`.
* **One-pass left-to-right nudge for collision resolution over a full constraint solver:** The spec explicitly calls for a "simple" pass for Phase 1. The greedy nudge (sort by `labelLeft`, shift each label right until clear of the previous one) handles the common case of horizontally adjacent faces and is ~10 lines. Known limit: can push rightmost labels into the clamped right edge on dense photos. Accepted for Phase 1; robust layout is Phase 2.
* **`var(--text-sm)` for show-all pills over `var(--text-lg)` used in tap-to-reveal:** When all labels are visible simultaneously the visual density is high — smaller text keeps the photo readable. Tap-to-reveal shows only one label at a time so it can afford the larger size for legibility at arm's length.

### Technical Notes

* `Viewer.tsx` was a 12-line stub; replaced with 195-line implementation covering fetch, loading/error states, `FaceHitTarget`, `NameLabel` (tap mode), `ShowAllOverlay` toggle, and the pill button.
* `ShowAllOverlay.tsx` — new component, ~120 lines. `computeLayout` is a pure function outside the component; `useMemo` gates it on the `labels` array reference.
* Char-width estimate in `computeLayout`: `name.length * 0.024 + 0.06` — calibrated for a ~375px viewport. Chinese names are narrower per glyph than Latin at the same char count; the estimate is slightly generous, which is safe (labels slightly wider than needed, nudge still fires).
* `handleToggleShowAll` clears `activeId` before toggling — prevents a ghost tap-reveal label persisting when switching into show-all mode.
* Container `onClick` guarded with `!showAll` — prevents the dismiss handler from firing when the user taps the photo in show-all mode.
* `tsc --noEmit` passes clean on both files.

### Next Session

* MAT-479 — T6: Hardening pass (accessibility, token retrofit on T1–T3, error states)
* MAT-480 — Keyboard shortcuts for QC overlay — P2
* MAT-481 — Sticky add mode + portrait button placement — P2
* Confirm `bbox_y >= 0.25` threshold after real-photo testing (logged in INBOX.md)

---

## 2026-06-23 - MAT-482 — Design tokens
**Session Goal:** Extract a single source of truth for color, type, spacing, and tap targets before building T4/T5.
**Status:** Completed ✅ — MAT-482 closed.

### The "Why" (Decision Log)
* **Extract, don't invent:** Grepped all T1–T3 component styles first, found the actual clusters, then codified those. Tokens that reflect real usage are stable; tokens guessed in advance drift immediately.
* **`#555` over `#666` for muted text:** `#666` on white is 5.74:1 (AA only). `#555` is 7.17:1 (AAA). The elder-user legibility requirement makes AAA achievable here — one character change, measurable gain.
* **`--color-overlay-label: rgba(20,20,20,0.92)`:** The existing delete-button style already proved this value works visually. White text on it is ~17:1 over any photo content — well into AAA. Codifying it means T4/T5 name labels over photos have a verified, named value to reference.
* **No retrofit of T1–T3:** The ticket explicitly defers this to the MAT-480/481/T6 hardening pass. Retrofitting now would be churn with no user-visible gain at this stage.

### Technical Notes
* `src/tokens.css` — 44 lines, all CSS custom properties on `:root`, imported in `main.tsx` before `index.css` so tokens are available to everything.
* Tap target `--tap-target: 44px` — stops the magic number appearing in QCOverlay handle sizing and future touch targets.
* Focus ring uses the accent yellow in a two-ring pattern: `0 0 0 2px #fadc00, 0 0 0 4px rgba(250,220,0,0.25)` — visible on both white and dark photo backgrounds.
* Contrast ratios documented inline in the file header for auditability.

### Next Session
* MAT-477 — T4: Tap-to-reveal public viewer
* MAT-480 — Keyboard shortcuts for selected box — P2
* MAT-481 — Sticky add mode + portrait button placement — P2

---

## 2026-06-24 - Share UI + bbox_y threshold validation (MAT-477 patch, MAT-490)
**Session Goal:** Close out the remaining MAT-477 gaps (share link was undeliverable to users) and validate the label placement threshold from MAT-490.
**Status:** Completed ✅ — MAT-477 closed, MAT-490 closed.

### The "Why" (Decision Log)
* **Share UI lives in `FaceNameList`'s done state, not a new page:** After saving, the user is already in context — they've just named everyone and the natural next question is "now what?" A `Share photo` button inline in the done state answers that without navigation. A separate Share page would require keeping the image ID in router state or a URL param.
* **"Share photo" button → link reveal (two steps) over a link shown immediately on save:** The share token API call is a side-effectful write (generates a new token on each call). Requiring an explicit user action to trigger it makes the intent clear and avoids generating tokens the user didn't ask for.
* **Share URL fixed from `/share/` to `/s/`:** The frontend route was always `/s/:token`, but `share.go` generated `BASE_URL + "/share/" + token`. Every share link produced before this fix would 404. The API route itself (`GET /share/{token}`) is unaffected — that's a backend path, not a page URL. Origin of the mismatch is unknown; caught and fixed this session.
* **`ABOVE_THRESHOLD = 0.25` kept as-is over lowering to the geometric minimum (~0.08):** Analytically, a label (~30px, ~7% of a 400px image) above a face with `bbox_y = 0.08` fits without clipping. But keeping 0.25 means top-row faces in group photos always get a "below" label — which reads naturally (label points down toward the rest of the group). The extra conservatism is a UX benefit, not just a safety margin.
* **Named constant over inline magic number:** `0.25` appears in both `Viewer.tsx` and `ShowAllOverlay.tsx` with no explanation. The threshold has a non-obvious WHY (geometry + UX intent), which is exactly the case for a named constant + comment. One line to change if the threshold is ever tuned.

### Technical Notes
* `share.go` line 48: `cfg.BaseURL + "/share/" + token` → `cfg.BaseURL + "/s/" + token`. One-line fix.
* `FaceNameList.tsx`: added `savedImageId`, `shareUrl`, `sharing`, `copied` state. `handleShare()` calls `POST /api/images/{id}/share`; `handleCopy()` writes to `navigator.clipboard` and shows a 2-second "Copied!" flash.
* Threshold extracted to `const ABOVE_THRESHOLD = 0.25` in both `Viewer.tsx` (after `HIT_PAD`) and `ShowAllOverlay.tsx` (with the other normalized-coordinate constants). Both files updated to reference the constant.
* `tsc --noEmit` passes clean after both changes.

### Next Session
* MAT-479 — T6: Hardening pass (accessibility, token retrofit on T1–T3, error states)
* MAT-480 — Keyboard shortcuts for QC overlay — P2
* MAT-481 — Sticky add mode + portrait button placement — P2
* Phase 1.5 planning — server-side detection persistence, no-account viewer naming, OG preview card

---