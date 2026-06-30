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

## 2026-06-25 — Show-all label layout overhaul (boundary placement)

**Session Goal:** Fix the show-all label layout for dense group photos (15–20 faces): no label inside a face bbox, no label covering another label, lines as short as possible, overall visual clarity.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **Single cluster frame (bounding box of all faces) over per-face above/below:** The original approach placed each label directly above or below its own face. For 15+ people this causes pile-up — all labels on one side, heavily overlapping. A single bounding box frame around all faces forces labels into two clean margin zones (top / bottom), making the layout predictable and readable.

* **Per-row rectangles → single `<path>` for the debug frame:** Initially drew one `<rect>` per face row. Switched to a single `<path>` element with one subpath (`M…Z`) per row — one SVG element, one stroke, visually reads as one frame shape even though the rows are separate bands.

* **Closest-edge split over image-midpoint split:** First attempt split faces at `frameMidY = (frameTop + frameBottom) / 2` — faces above the midpoint → top margin, below → bottom margin. Debug logging revealed the "rows" produced by clustering actually **overlap in Y** (e.g., `gap_above = -0.014`): a face deep in the front row has a lower bbox_y than some faces in the back row. The midpoint split misassigned many faces. The fix: for each face, compute `distToTop = face.bbox_y − frameTop` and `distToBottom = frameBottom − (face.bbox_y + face.bbox_h)`; assign to whichever margin is closer. This is robust to overlapping rows because it operates per-face, not per-cluster.

* **Proximity-first shelf ordering (closest face → innermost shelf):** Within `packShelves`, faces are first sorted by distance to the frame edge (closest first), then assigned to shelves in that order. The innermost shelf (shelf 0) is physically closest to the frame and gives the shortest leader line. Faces deeper in the cluster overflow to shelf 1, 2, etc. After shelf assignment, faces are re-sorted by X within each shelf so left-to-right label order matches left-to-right face order and lines within a shelf never cross.

* **Centroid-centered shelf start over left-anchoring at X=0:** `packShelves` originally started every shelf at `labelLeft = 0`, making all labels pile up on the left side of the image regardless of where the faces were. Fix: compute the centroid X of all faces on the shelf, then start the label row at `centroidX − totalShelfWidth / 2`. Each label ends up roughly above/below its own face rather than off to the left.

* **Reverted per-face inline placement:** Attempted a `tryInline` pass — before shelving, try to place each label directly adjacent to its face bbox (below for bottom-group, above for top-group), skipping any position that would overlap another face or a committed label. Works correctly for isolated faces but produces visual chaos for dense groups: labels end up at 7+ different Y levels mixed with 2–3 margin shelf rows, and leader lines from inline labels cross those from margin labels. Reverted to the two-zone margin approach, which restricts all labels to 2–4 consistent Y levels per photo.

### Technical Notes

* `clusterRows` groups faces by `bbox_y` proximity (ROW_TOLERANCE = 0.12). For perspective group photos, rows can overlap in Y because front-row faces have large `bbox_h` extending below back-row `bbox_y` values. The cluster is kept for frame visualization (debug `<path>`) but is not used for label placement — closest-edge split handles all assignments.
* Debug logging (`debugLayout`) was added mid-session and removed before commit; key signals: per-row Y bounds and gap sizes, per-label line length and whether the pill landed inside any row bbox.
* `SHELF_H = LABEL_H_EST + NUDGE_GAP = 0.068` normalized units per shelf. For a 16-person photo needing 3 shelves in the top margin, the outermost shelf reaches `frameTop − 0.02 − 2×0.068 = frameTop − 0.156` above the frame — visible on photos where the cluster starts near the vertical center.

### Next Session

* Validate layout on a wider range of photos (portrait vs landscape, 4-person vs 20-person)
* Consider removing the debug frame `<path>` once layout is confirmed stable
* Evaluate whether margin label lines that cross (different shelves crossing each other) need a dedicated no-crossing sort pass

---

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

## 2026-06-26 — iOS redesign + MAT-507/508/509/510/511

**Session Goal:** Restyle the entire site to match the iOS system palette; close five queued tickets: remove debug bbox, auto-fill ML suggestions, viewer action bar rename + Browse/Edit Names, home gallery, viewer back button.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **iOS system palette (`#007AFF`, SF Pro, `rgba(60,60,67,0.18)` separator) over the existing custom design system:** The Slideshow prototype was already iOS-flavoured. Matching the whole site to iOS makes the product feel native on the primary use device (iPhone) without inventing a bespoke design language. The original tokens were an early approximation; these are the canonical system values.

* **`PUT /share/:token/name` as a new endpoint over updating `POST` to be an upsert:** All faces shown in CastGrid are already named — the POST endpoint INSERTs a new `persons` row + `tags` row, which would 409 on every edit attempt. A dedicated PUT that UPDATEs `persons.display_name` keeps the semantics clean (POST = first-time name, PUT = correction) and requires no change to the POST code path.

* **`suggestionMap` declared before `names` useState initializer (MAT-508 fix):** The useState initializer references `suggestionMap` to seed pre-filled names. In JavaScript, a `const` declared below its use in a closure that runs at module parse time hits a temporal dead zone error. Moving the declaration above the useState call is the only fix — no workaround.

* **CastGrid available in both ≤12 and ≥12 modes over separate Browse panels:** The user asked for Browse/Edit Names in both viewer modes. The CastGrid component already handles arbitrary label counts; removing the `!canShowAll` gate adds the feature with a one-line change. No second component needed.

* **`← Home` as an absolute-positioned pill over adding it to the action bar:** The action bar only renders when `namedLabels.length > 0`. A photo with no named faces would show no back navigation at all. Positioning it absolute over the photo guarantees visibility regardless of naming state.

* **Unshared photos rendered at 55% opacity (not hidden) in the gallery:** The gallery is the user's record of all uploads, not just shared ones. Hiding unshared photos would silently delete history from their perspective. Dimming signals "incomplete" without erasing the entry.

* **`useEffect` on `step === 'pick'` for gallery re-fetch over fetching once on mount:** When a user completes a naming flow and `reset()` is called, `step` returns to `'pick'` and the effect re-fires. This gives automatic gallery refresh after upload with zero explicit user action and no state threading.

* **`SHOW_ALL_MAX = 12` over a higher threshold:** 12 is a conservative upper bound for the show-all overlay at MVP — at 12 labels the overlay is already approaching its density limit. The constant is intentionally named and isolated so it can be lowered after real-photo testing without a search-and-replace.

* **SpotlightPlayer coverflow as Slideshow (not Browse Names):** The coverflow improves the Slideshow experience itself — face-by-face navigation with crop thumbnails is a better slideshow than a plain list. Browse Names is a different task (finding a specific person); Slideshow is a presenting/reviewing task that the coverflow suits naturally.

### Technical Notes

* **iOS design system:** `tokens.css` completely rewritten — `--color-blue: #007AFF`, `--color-fill: rgba(120,120,128,0.12)`, `--color-separator: rgba(60,60,67,0.18)`, `--radius-pill: 9999px`, `--tap-target: 44px`. `index.css` rewritten with `-apple-system, "SF Pro Display"` font stack. All pages and components updated in one pass.
* **New components:** `CastGrid.tsx` (browse/edit roster with per-row inline edit), `SpotlightPlayer.tsx` (coverflow carousel), `useFaceCrops.ts` (shared canvas crop hook).
* **MAT-507:** Removed `FaceRow` type, `clusterRows` function, `buildFramePath` function, `ROW_TOLERANCE` constant, `rows` useMemo, and the debug `<path>` block from `ShowAllOverlay.tsx` — all were dead code once the debug frame was removed.
* **MAT-508:** `Suggestion` type gained `similarity?: number` (API already returns it). `FaceNameList` seeds the `names` useState initializer from `suggestionMap` so high-confidence detections arrive pre-filled; user can still clear or edit them.
* **MAT-509:** `RenameViaShare` uses a single `UPDATE persons … FROM tags, detections, images WHERE i.share_token = $1 AND d.id = $2` — no transaction needed since it's a single UPDATE, not an INSERT chain.
* **MAT-510:** `ListImages` queries `SELECT id, share_token FROM images WHERE account_id = $1 ORDER BY created_at DESC` — no storage_key parsing needed since `accountID` is already in context. `images` table already had `created_at`, so no migration.
* **MAT-511:** Link renders inside the photo `<div>` (which has `position: relative`) at `zIndex: 20` — above ShowAllOverlay labels (zIndex 9/10), no conflict with NamePopover (zIndex 20, different location).
* `go build ./...` and `tsc --noEmit` both pass clean.

### Next Session

* Validate gallery on first-time-upload (no photos yet) and after a complete flow (new photo appears)
* Validate Browse/Edit Names rename flow end-to-end against the live API
* Consider lowering `SHOW_ALL_MAX` below 12 after real-photo density testing

---

## 2026-06-26 — Tauri desktop shell (Step 1)

**Session Goal:** Scaffold the Tauri desktop app for authoring — Tauri v2 wrapping the existing React/Vite frontend, CORS configured for the desktop WebView origin, verified login works in the Tauri window.
**Status:** Partially Completed — Tauri window opens and login works ✅; ML sidecar bundling (Step 2) not yet done.

### The "Why" (Decision Log)

* **Tauri desktop app over local Go binary serving the frontend:** The viewing use case can't require installation — elderly congregation members receive a share link and must open it in a plain browser. Authoring needs to run a local ML sidecar (InsightFace/ArcFace) without paying for cloud RAM. A Tauri desktop app lets authoring use local RAM while the viewer stays a web page. Embedding the frontend in a Go binary would have collapsed both clients into one and made the viewer require installation.

* **Cloud Postgres + pgvector stays over SQLite:** Embedding generation is expensive (moves to local sidecar); pgvector similarity search is cheap (stays in cloud). SQLite on each user's machine would also lose cross-device data and break the share-link viewer flow, which reads from the same Postgres rows the author wrote.

* **ML sidecar runs locally over staying in the cloud:** Not ready to pay for a hosting service with enough RAM for InsightFace/ArcFace. Running the sidecar on the author's machine costs nothing.

* **MSVC toolchain over MinGW/GNU for Windows Tauri builds:** Tauri's `cdylib` crate generates 95,263 exported symbols — PE/COFF DLLs cap at 65,535, which both GNU `ld` and LLVM `lld` enforce. MSVC's `link.exe` doesn't impose this limit. The GNU toolchain was attempted first (MSYS2 + MinGW GCC 16 + LLD 22) and hit the same wall. VS 2022 Build Tools installed via winget as admin unblocked the build.

* **Vite proxy for API calls in dev over `VITE_API_BASE` env var:** In `tauri dev`, the WebView loads from the Vite dev server (`http://localhost:5173`), so Vite's existing `/api/` → `localhost:8080` proxy handles all API calls — no change to any fetch URL. The env-var approach is still needed for production builds (where there's no Vite proxy), but the MVP dev workflow doesn't require it yet.

* **CORS middleware on the Go API over per-handler headers:** `tauri://localhost` is the WebView2 origin for production Tauri builds; dev builds go through Vite so CORS isn't an issue there. Adding a router-level middleware means future routes are covered automatically and the allowed-origins list is a single maintained map.

### Technical Notes

* Tauri v2.11.3 scaffolded at `frontend/src-tauri/`. Bundle identifier `au.nashishei.app`. Window 430×932 (iPhone 14 Pro portrait). `tauri-plugin-shell` added to `Cargo.toml` and registered in `lib.rs` — needed later to spawn the ML sidecar.
* `frontend/package.json` gets `@tauri-apps/cli` (devDep) and `@tauri-apps/api` (dep) + `"tauri": "tauri"` script.
* `frontend/.gitignore` excludes `src-tauri/target/` and `src-tauri/gen/`.
* `vite.config.ts` adds `strictPort: true` — prevents silent port switching to 5174 when 5173 is held by a stale process (which caused a window-loads-blank failure in the first dev run).
* CORS middleware (`corsMiddleware`) added to `api/cmd/api/main.go` as a router-level `Use` — allows `tauri://localhost`, `https://tauri.localhost`, and both dev ports (5173, 5174) plus `cfg.FrontendURL`.
* Makefile gains `tauri-dev`, `tauri-build-mac` (universal Apple), `tauri-build-windows` (x86_64-msvc).
* First Rust build: ~2 min 8 sec (374 crates from scratch, MSVC). Subsequent builds use incremental cache.
* MAT-512 created in Linear (P2 / Deep Work): face detection loading animation (Detecting Faces.dc.html). INBOX.md cleared.
* Rust 1.96.0 installed via rustup; VS 2022 Build Tools installed as admin; `stable-x86_64-pc-windows-msvc` is the active default toolchain.

### Next Session

* Step 2: Bundle ML sidecar — PyInstaller freeze of `ml/main.py`, configure as `bundle.externalBin`, Rust `setup()` spawns it on startup
* Production API URL: add `VITE_API_BASE` env var for prod builds (Vite proxy won't exist in the bundled app)
* Test upload + detect flow end-to-end in the Tauri window

---

## 2026-06-26 — Tauri Step 2 — ML sidecar, detect-client, production deploy

**Session Goal:** Bundle InsightFace as a local sidecar for the Tauri desktop app, add a server endpoint for client-provided embeddings, and configure production deployment.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **PyInstaller self-contained .exe over requiring Python on the user's machine:** Zero user-setup is the bar — they double-click the app. PyInstaller freezes the entire environment into a single binary that Tauri can spawn as a sidecar. A raw script or venv requires a matching Python version and manual dependency install.

* **detect-client architecture (frontend → local sidecar → POST embeddings to cloud) over cloud-side ML:** RAM cost is the constraint. InsightFace + ArcFace needs ~1–2 GB; the cloud API container stays lean (Go + pgvector queries only). The local sidecar does the embedding work; the cloud stores and searches.

* **CORS reflect-any-origin over an explicit allowlist:** The WebView2 runtime generates a non-deterministic origin per installation. The allowlist was blocking every request because the exact origin string was unknown at build time. Reflecting the request's `Origin` header was the only viable path short of fingerprinting each installation.

* **SameSite=None; Secure over SameSite=Lax:** Lax cookies are silently dropped on cross-site requests. The Tauri WebView sends credentialed requests from `tauri://localhost` to `https://api.nashishei.example.com` — a cross-site request — so the auth cookie was never being transmitted. None + Secure is the correct setting for a credentialed cross-origin cookie.

### Technical Notes

* `ml/sidecar_main.py` — minimal FastAPI wrapper around the existing InsightFace pipeline, PyInstaller entry point. `ml/build_sidecar.ps1` — PowerShell build script, outputs `.exe` to `frontend/src-tauri/binaries/`.
* `frontend/src-tauri/tauri.conf.json` — `externalBin` registers the sidecar; `lib.rs` — `MlSidecar` managed state + `ml_base_url` Tauri command returns the spawned sidecar's port.
* `api/internal/handler/detect_client.go` — new endpoint `POST /images/{id}/detect-client`. Accepts pre-computed embeddings, stores them, runs pgvector similarity for suggestions. No ML on the server.
* `api/Dockerfile` — multi-stage build (golang:1.26-alpine → alpine:3.20). `api/fly.toml` — Fly.io config (app: api-black-silence-6888, region: ewr, 1 GB volume).
* `db/init.sql` — schema + pgvector extension init for Neon deployment.
* All 7 direct `fetch()` calls in frontend updated to `api()`; `ml.ts` gets `mlApi()`.
* React 19 compat: `useRef<T>(null)` → `RefObject<T | null>` in `useZoomPan.ts`.
* `tsc --noEmit` passes clean.

### Next Session

* Auth hardening — 401 interceptor, startup session validation, logout button, conditional Secure cookie
* Fix dev ML routing (sidecar binary not present on dev machine)
* MAT-519/520/522/523 — viewer + naming UX

---

## 2026-06-29 — Auth hardening + viewer/naming UX (MAT-519/520/522/523)

**Session Goal:** Harden auth state management, fix dev ML routing, and close five UX tickets across the viewer and naming flow.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **401 interceptor + startup session validation over trusting `localStorage` alone:** `localStorage['authed']` is a UI gate, not a ground truth — the server cookie can expire without it. The interceptor dispatches `session-expired` on any 401 (non-auth paths); startup validation fires `GET /api/images` on mount and clears the flag if it comes back 401. Together they keep UI state in sync with actual session state.

* **`SecureCookie` conditional on `ENV == "production"` over always Secure:** Browsers reject `Secure` cookies on non-HTTPS origins. Dev runs on `http://localhost`, so `Secure: true` unconditionally broke cookie storage in dev. The conditional gives prod the security requirement without breaking the dev loop.

* **`VITE_ML_BASE=/ml-sidecar` + Vite proxy over running the sidecar binary locally in dev:** The PyInstaller `.exe` isn't built on the dev machine. Routing `mlApi()` calls through the Vite proxy to docker compose's ML service on port 8000 gives the same model with zero binary setup.

* **Sticky image + action bar over a `maxHeight: 40vh` inner scroll box:** The 40vh box was the first pass; nested scrolling (a scroll container inside a scrolling page) fights the browser's natural scroll model and feels clunky. The sticky approach pins the photo and controls at the viewport top and lets the names list scroll as plain page content — the native iOS list-detail pattern.

* **"X named" header text moved into the sticky block over leaving it inside CastGrid:** Useful context that the user explicitly wanted always visible while scrolling through names. Once the sticky layout existed, the count line belongs in the pinned section rather than the scrolling content.

* **Solid `#000` action bar + `#1c1c1e` CastGrid body over transparent/uniform dark:** The transparent action bar let the photo bleed through, creating visual ambiguity about where the sticky block ended. `#000` makes a clean seam. `#1c1c1e` (iOS elevated dark surface) for the names list establishes a visual hierarchy between the two sections.

### Technical Notes

* `api.ts` — 401 interceptor dispatches `session-expired` CustomEvent for all non-`/api/auth/` paths.
* `App.tsx` — `AuthGate` restructured: startup `GET /api/images` validation clears `authed` if 401; `session-expired` listener; `logout()` function; `checking` state renders nothing until validation completes.
* `Home.tsx` — `onLogout` prop + "Sign out" button in header; upload tap zone moved above gallery (MAT-520).
* `config.go` — `SecureCookie bool` derived from `env == "production"`. `auth.go` — `setSessionCookie` + `Logout` consume `cfg.SecureCookie`.
* `ml.ts` — `VITE_ML_BASE` env var checked before Tauri `invoke`; short-circuits the IPC call when set.
* `vite.config.ts` — `/ml-sidecar` proxy: `target: http://localhost:8000`, strips prefix.
* `FaceNameList.tsx` — MAT-522: `position: sticky; bottom: 0` footer with "X of Y named" counter + Save button, replaces inline save. MAT-523: "Paste names" disabled (`opacity: 0.35`, `pointerEvents: none`). MAT-519: "View in your gallery" secondary pill button in done state.
* `Viewer.tsx` — Copy link button (copies `window.location.href`, "✓ Copied" for 2s). Photo + action bar in `position: sticky; top: 0` wrapper; CastGrid is plain page flow below. "N named" header text lifted from CastGrid into sticky block.
* `CastGrid.tsx` — `backgroundColor: #1c1c1e`, `borderTop` removed, header text removed (now in Viewer).
* `tsc --noEmit` passes clean.

### Next Session

* MAT-518 — Sign-in confirmation animation (not yet started)
* MAT-521 — Duplicate image detection warning (Deep Work, not yet started)
* Test full upload → detect → name → share flow end-to-end in the Tauri window

---

## 2026-06-29 — Tauri → browser-native ML (MAT-525)

**Session Goal:** Prove ArcFace can run in-browser via `onnxruntime-web`, migrate the full detection flow off the Tauri/Python sidecar, and strip all Tauri code.
**Status:** Partially Completed — ML loads, detection runs; face detection results unverified end-to-end (switched from MediaPipe to SCRFD at session end, awaiting first successful detection).

### The "Why" (Decision Log)

* **Browser ML over Tauri sidecar:** Tauri requires a Windows desktop install and a PyInstaller build step — a hard barrier for multi-device authoring and CI. `onnxruntime-web` with WebGPU EP runs the same ONNX weights (w600k_r50, det_10g) client-side with no install, no sidecar process, and no cloud ML cost.

* **Spike-first over jumping straight to integration:** The risk was that cosine similarity in-browser would be too low to be useful. A throwaway `/spike` page with real photos confirmed 0.3–0.4 same-person vs −0.1 different-person before any production code was touched.

* **5-point similarity transform alignment (closed-form) over crop-and-scale:** Naive bbox crop loses pose information — the same face at different angles produces different embeddings. Similarity transform maps detected facial keypoints to InsightFace's canonical 112×112 template, normalising scale/rotation/translation in one pass. Same algorithm as the Python sidecar.

* **SCRFD `det_10g.onnx` over MediaPipe FaceLandmarker for detection:** MediaPipe FaceLandmarker returned 0 faces on every real church group photo (4000×3000, faces ~200px tall). The same photos worked in the Tauri sidecar because it used InsightFace's SCRFD detector, which is purpose-built for faces-in-the-wild at varying scales. Dropping MediaPipe and loading `det_10g.onnx` via ort gives the identical detection pipeline to the sidecar.

* **`COEP: credentialless` removed over kept:** Initially added COOP + COEP to enable SharedArrayBuffer for ort WASM threading. But with `crossOriginIsolated = true`, MediaPipe chose its multi-threaded WASM variant (`vision_wasm_module_internal`), which creates Web Workers and tries to re-import itself by URL — crashing because the file was loaded via fetch, not a `<script>` tag. Removing both headers made MediaPipe fall back to the single-threaded variant. ort uses WebGPU EP (confirmed working) and doesn't need SAB.

* **`import.meta.hot.decline()` in `mlBrowser.ts`:** Module-level singletons (`_arcSession`, `_detSession`) survive page renders but not Vite HMR module swaps. After any edit, HMR would install a new module instance with null sessions while `mlState` was already `'ready'`, causing "ML not initialized" on the next detect. Declining HMR forces a full page reload on any edit to this file.

* **Singleton `_initPromise` guard over unguarded `useEffect`:** React 18 Strict Mode fires effects twice. Without a guard, two concurrent `initML` calls raced — the second session creation often conflicted with the WebGPU context held by the first, leaving one session null and the app in an error state.

* **`SameSite=Lax` in dev over `SameSite=None`:** The Tauri SameSite=None setting was correct for a cross-site credentialed request from the Tauri WebView. In the browser-only dev environment (both frontend and API on localhost), SameSite=None requires Secure=true, which requires HTTPS. Without it the browser silently dropped the auth cookie on every request, causing login to appear to "refresh the page" without entering the app.

### Technical Notes

* `frontend/src/lib/mlBrowser.ts` — new file, replaces all ML logic: IndexedDB cache for both models, SCRFD preprocessing (640×640 letterbox, `(x−127.5)/128` normalisation, NCHW float32), SCRFD postprocessing (anchor decoding, NMS, 5-point kps extraction), similarity transform + ArcFace alignment, `detectAndEmbed()` public API.
* `frontend/src/lib/arcfaceSpike.ts` + `ArcFaceSpike.tsx` — kept as dev-only tools at `/spike`; use the older MediaPipe+onnxruntime spike approach; not part of the production flow.
* `frontend/src/contexts/MLContext.tsx` — new context wrapping `initML`; exposes `mlState`, `loadProgress`, `ep`, `mlError` to the whole tree.
* `frontend/src/hooks/useFaceDetection.ts` — rewritten: old flow hit `/detect-and-embed` Tauri sidecar; new flow calls `detectAndEmbed(img)` then `POST /api/images/{id}/detect-client`.
* `frontend/src/components/ImageDetector.tsx` — gated on `mlState === 'ready'` + `imgLoaded` before triggering detection.
* Tauri stripped: `@tauri-apps/api`, `@tauri-apps/cli`, `src-tauri/`, `ml/sidecar_main.py`, Makefile `tauri-*` targets — net −4,253 lines.
* `api/internal/handler/auth.go` — `setSessionCookie` + `Logout` now use `SameSiteLaxMode` when `!cfg.SecureCookie` (dev), `SameSiteNoneMode` when `cfg.SecureCookie` (prod).
* `public/mediapipe-wasm/` + `public/models/face_landmarker.task` — downloaded and then made redundant when MediaPipe was dropped; directories gitignored.
* `public/models/det_10g.onnx` (16 MB) copied from `~/.insightface/models/buffalo_l/` — same file used by the Python sidecar.
* `docker-compose.yml` — port remapped `5432→5433` (local Postgres on 5432 intercepted Docker's mapped port); `POSTGRES_HOST_AUTH_METHOD: trust` added.
* Windows/Docker networking: `localhost` resolves to `::6` (IPv6) on Windows; changed `DATABASE_URL` to `127.0.0.1:5433` explicitly.

### Next Session

* Verify `det_10g.onnx` SCRFD detects faces on first upload (check `[detect] faces found:` in console)
* Strip debug `console.log` statements from `mlBrowser.ts` once detection confirmed
* Remove `public/mediapipe-wasm/` and `public/models/face_landmarker.task` from disk (already gitignored, just clutter)
* Confirm end-to-end: upload → detect → name → save → share
* Update architecture docs to reflect pure web app (no Tauri, no sidecar)

---

## 2026-06-30 — Browser ML debugging + post-migration fixes

**Session Goal:** Verify SCRFD face detection end-to-end in the browser, fix blockers found on first real test, and clean up post-migration clutter.
**Status:** Completed ✅ — 17 faces detected on a 4000×3000 church group photo; full upload → detect → name → save → gallery flow confirmed working.

### The "Why" (Decision Log)

* **`createImageBitmap(img)` over `img.naturalWidth/naturalHeight` for scale calculations:** Chrome 89+ applies EXIF correction when calling `drawImage(HTMLImageElement)`, but `naturalWidth/naturalHeight` return the physical storage dimensions. For an iPhone photo stored sideways (e.g. 4032×3024 physical, EXIF rotate=90°), the old code computed a landscape scale but drew a portrait image into the canvas — SCRFD saw faces sideways and returned zero detections. `createImageBitmap` gives corrected dimensions and consistent pixels in one call; closing the bitmap at the end frees memory. The same bitmap is reused for both the SCRFD letterbox pass and every ArcFace alignment crop.

* **Runtime catch-and-WASM-retry over relying on the `createSession` fallback:** The existing `createSession` WebGPU→WASM fallback only catches errors thrown by `InferenceSession.create()`. The `AveragePool ceil_mode` crash in `det_10g` manifests at `run()` time — the session creates successfully, the ArcFace warmup (all-zeros 112×112) passes, but the first real SCRFD inference on actual pixel data hits the unsupported ceil() path. Fix: store `_arcBuf`/`_detBuf` at module scope after loading, extract `runPipeline()`, add an inner try/catch in `detectAndEmbed` that reinitializes both sessions on WASM and retries once. Transparent to the caller; the "Detecting faces…" spinner covers the extra init time.

* **onnxsim inside the existing ML Docker container over installing Python on the host:** No Python on the Windows dev machine. The `nashishei-ml` image already has Python + ONNX dependencies (installed for InsightFace), so `docker run --rm -v ./frontend/public/models:/models nashishei-ml sh -c "pip install -q onnxsim && onnxsim ..."` was zero-setup. Result: `det_10g` Shape nodes 6→3, Slice 2→1 — the dynamic shape computations that triggered the ceil_mode issue at WebGPU dispatch time. `w600k_r50` had no AveragePool issue (it's all BatchNorm + Conv + Gemm) but was simplified anyway for consistency.

* **`_sim.onnx` suffix + new IndexedDB cache keys over overwriting original files:** Keeps the original models as on-disk reference while the simplified versions are validated. New cache keys (`det_10g_sim`, `w600k_r50_sim`) ensure all browsers automatically pick up the new models without manual IndexedDB clearing.

* **`onDone` callback prop over `<Link to="/">` for "View in your gallery":** `<Link to="/">` on an already-mounted route does not cause React to unmount/remount `Home` — the `step` state stays at `'name'` and the gallery never shows. A direct callback into `Home.reset()` is the unambiguous path.

### Technical Notes

* `mlBrowser.ts` — `detectFaces` and `alignAndPreprocess` now accept `ImageBitmap` instead of `HTMLImageElement`. `detectAndEmbed` creates the bitmap once (`createImageBitmap(img)`), passes it to both functions, and closes it in a `finally` block.
* `mlBrowser.ts` — `_arcBuf` and `_detBuf` stored at module scope after `loadModel` resolves. `runPipeline(bmp, W, H)` extracted as inner helper; `detectAndEmbed` wraps it with a catch that reinitializes to WASM and retries if `_ep === 'webgpu'`.
* Both models simplified with `onnxsim` inside the `nashishei-ml` Docker image; outputs written directly to `frontend/public/models/`. `initML` now loads `w600k_r50_sim.onnx` and `det_10g_sim.onnx`.
* `FaceNameList.tsx` — `onDone?: () => void` prop added; "View in your gallery" changed from `<Link to="/">` to a `<button onClick={onDone}>`. `Home.tsx` passes `reset` as `onDone`.
* Cleanup: removed `public/models/face_landmarker.task` (3.7 MB) and `public/mediapipe-wasm/` (~11 MB) from disk (were already gitignored).
* Confirmed working: 17 faces detected on a 4000×3000 church group photo; full upload → detect → name → save → gallery flow working end-to-end.

### Next Session

* Delete original `det_10g.onnx` + `w600k_r50.onnx` from `public/models/` (182 MB saved) once WebGPU confirmed clean (no WASM fallback warning in console)
* Unrecognized faces sorted to top in step 2 of 2 (INBOX)
* Auto-generate share link immediately on "Save names" — remove explicit "Share Photo" button (INBOX)
* Show photo thumbnail on "Saved!" screen (INBOX)
* Center "View in your gallery" button on "Saved!" screen (INBOX)
* Add file organization (delete + management) to "Your Photos" gallery section (INBOX)

---

## 2026-06-30 — "Saved!" screen revamp + unknowns-first sort (MAT-529, MAT-528)

**Session Goal:** Auto-generate the share link on save, show a photo thumbnail on the done screen, center the gallery button, and sort unrecognized faces to the top of the naming list.
**Status:** Completed ✅

### The "Why" (Decision Log)

* **Auto-share by passing `resolvedImageId` as a param over relying on `savedImageId` state:** `setSavedImageId` and `setDone` are batched React updates — `handleShare` can't read `savedImageId` until the batch flushes. Adding an optional `id` param to `handleShare` and calling it with the local `resolvedImageId` bypasses the batch entirely.

* **Share fires as `void` fire-and-forget over `await` inside `handleSave`:** Blocking `setDone(true)` on a network call that isn't part of the core save would delay the "Saved!" screen. Errors surface via `setError` inline on the done screen — losing a share link is far less bad than appearing to stall on save.

* **"Share Photo" button removed (no fallback) over keeping it:** Once share is auto-generated, a button that triggers the same action is redundant and confusing. The `sharing ? "Generating link…" : shareUrl ? <row> : null` pattern shows loading state then result — the correct pattern for an auto-fired async action.

* **Unknowns-first sort by passing `suggestionMap` into `sortedDetections` over re-deriving inside the function:** `suggestionMap` was already built at the top of the component; moving its declaration one line above `sorted` gave the sort function the prebuilt `O(1)` lookup with no extra work per comparison.

### Technical Notes

* `handleShare(id?: string)` — `imageId` resolves to `id ?? savedImageId`; called with `resolvedImageId` inside `handleSave` after `setDone(true)`.
* Done screen: `<img src={imgSrc} style={{ width:120, height:120, objectFit:'cover', borderRadius:'var(--radius-md)' }}>` above the "Saved!" heading. Size is a default, not a deliberate pick.
* "View in your gallery" button wrapped in `<div style={{ display:'flex', justifyContent:'center' }}>` — `textAlign:'center'` on the parent doesn't centre flex containers, explicit wrapper required.
* `sortedDetections(dets, suggestionMap)` — sort key: `(aKnown - bKnown) || (bbox_y diff) || (bbox_x diff)` where `Known = suggestionMap[id]?.display_name ? 1 : 0`. `suggestionMap` declaration moved above `sorted` (was one line below).
* `tsc --noEmit` passes clean on both changes.

### Next Session

* Tapping thumbnail on "Saved!" should navigate to image view (same as "View in your gallery") — INBOX
* Portrait image view: "Browse/Edit Names" sticky sometimes hidden when photo is taller than viewport — INBOX, needs a feasible fix
* Delete original `det_10g.onnx` + `w600k_r50.onnx` (182 MB) from `public/models/` once WebGPU confirmed stable with no WASM fallback in console

---