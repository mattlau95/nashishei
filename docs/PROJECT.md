# PROJECT.md — Group Photo Labeling App

# App Name: nàshìshéi - Who Is That? 
# Put a name to every face.

"nashishei" id derived from the Chinese words 那是谁?

Path to logo/icons: "C:\Users\mattl\nashishei\docs\icons"

---

## 1. The one-sentence purpose

Upload a group photo, name the faces (fast), and share a version where anyone can tap — or reveal all labels at once — to learn everyone's name.

The key problem solved: **"I'm in this photo with 40 people and I only know five of them."**

---

## 2. Persona / audience

**Primary stakeholder — "The Elder" (~90, tech-savvy).**
A church founder and elder. An original Mac loyalist who bought Mac desktops for his office before that was normal. Comfortable with technology and curious about new tools, but 90 years old — so **legibility, large tap targets, and zero-friction sharing** matter more than density or power-user features. He requested this over dinner; "show all the names at once" was *his* headline ask. Pleasing him early is a real project goal, not a vanity metric. (Relationship context: longtime family connection — the builder's mother was church staff in the early 2000s.)

**Secondary audience — the congregation.**
Multi-generational, **many Chinese names** romanized to English (e.g. Matthew Lau, Kuan Yuen Chang, Grace Chao, Harrison Lee, Chen Bin, Ching Hsu) and sometimes in Chinese characters. Name handling cannot assume Western "First Last" structure.

**The builder.**
Design Engineer, UX background. Solo, building for fun around a friend's request. Familiar stack: React + Vite, Go + chi, Postgres. New/unfamiliar piece: the ML (detection + face recognition).

---

## 3. Brand pillars / design principles

1. **Legible over dense.** If a 90-year-old can't read it at arm's length on a phone, it's wrong. Big type, high contrast, generous spacing.
2. **The photo is the hero.** Labels and UI never permanently obscure a face. Overlays are dismissible; faces are never blocked.
3. **Naming should feel fast, not like data entry.** Voice, text bulk-entry, and one-face-at-a-time crops beat typing into 40 fields.
4. **Share is one tap.** The payoff is sending a link. No account required to *view*.
5. **Names belong to people, not formats.** Every name is a free-text string. No assumptions about order, length, or script.
6. **Correct, don't demand perfection.** Auto-detection can be imperfect because humans can fix it cheaply (click-to-add, drag-to-resize).

---

## 4. Scope

### Must-haves (MVP / Phase 1)
- Upload a group photo (target: up to **40 faces**).
- Auto-detect faces, draw marquee boxes (browser-based).
- QC step: "Did we miss anyone?" → tap-to-add a face; size from **median of 3–5 nearest detected faces**; drag to resize.
- Name entry via an enlarged face-crop grid.
- **Tap-a-face-to-reveal** its name (the core viewing interaction).
- **Show-all-labels (simple version):** label above/below each face with a short leader line + one collision-nudge pass. Good enough for a 15–25 person photo. *This is the stakeholder's wow moment — ship it in Phase 1.*
- Mobile-first throughout; correction UI is **responsive** (nicer on desktop, not broken on mobile).

### Nice-to-haves
- **Bulk name entry by text** (Phase 1.5/2): "top, left to right: A, B, C / bottom, left to right: D, E" → assign to boxes.
- **Bulk name entry by voice** (Phase 2): record a spoken description → transcribe → same parser. *Lossy for romanized Chinese names; secondary to text.*
- **Show-all-labels (robust version)** (Phase 2): true boundary-labeling — margin placement, minimized leader-line crossings, ordered by y — for dense 40-face photos.
- **Account-scoped face recognition** (Phase 2): new photo's faces matched against your previously confirmed faces → *suggested* tags you confirm.
- **Large photos (40–200)** (Phase 2+): tiled detection; **search/tap interface instead of all-labels** (200 labels can't fit a screen — by design). *Note: VBS group photos of 150–200 kids are a real case here.*
- **Connect contacts / external name source** (Phase 2) to seed recognition.
- **TouchPoint church-database integration** (Phase 3 — see Open Questions).

### Non-goals (explicitly out of scope)
- Cross-account recognition ("this person also appears in a stranger's photo"). Privacy hairball, not wanted.
- Public/searchable face directory. This is private-link sharing only.
- Perfect detection on first pass. The QC step exists precisely so we don't need it.
- 200-label simultaneous display. Search/tap replaces it at scale.
- Account required to *view* a shared photo. Viewing is link-only.

---

## 5. Multilingual foundation (lock these in Phase 0)

The congregation skews toward romanized Chinese names, so name-format assumptions are a trap. Decisions to bake in from day one:

1. **`display_name` is a single free-text UTF-8 string.** No `first_name`/`last_name` split, ever. Optional `aka[]` (text array) reserved for future matching/aliases.
2. **Bulk parser delimiter is the comma — never whitespace.** "Kuan Yuen Chang" must survive as one name. State this in UI copy.
3. **Template copy includes Chinese-name examples** so the comma convention is self-evident, e.g.:
   > *Type each name separated by a comma. Multi-part names are fine — write the whole name between commas.*
   > *Example — top row, left to right: Grace Chao, Harrison Lee, Kuan Yuen Chang*
4. **Voice transcription is best-effort and flagged as such.** English-tuned ASR mangles spoken romanized Chinese names; the text path is the reliable one for this congregation. Phase 2 roster-constrained transcription improves this.
5. **Allow Chinese characters in names**, not only romanization.

---

## 6. Architecture

- **Frontend:** React + Vite. SVG overlay on top of the image for boxes, leader lines, and tap hit-testing (scales cleanly, crisp lines).
- **API / CRUD / auth / sharing:** Go + chi.
- **ML service:** Python FastAPI sidecar — MediaPipe (Phase 1 browser) → InsightFace detection + ArcFace embeddings (Phase 2 server). No mature Go equivalent, so isolate the unfamiliar piece here.
- **DB:** Postgres; add `pgvector` in Phase 2 for embedding similarity.
- **Storage:** object storage / volume for original images + face crops.
- **Deploy:** mirror the familiar ollae-style setup.

### Two-problem rule
**Detection** ("where are the faces") and **recognition** ("whose face") are separate components with separate models and separate phases. Never conflate.

---

## 7. Data model (Phase 0 — get this right early)

Three concepts kept distinct so Phase 2 recognition is non-destructive:

```sql
-- A person is a named identity that can recur across photos.
CREATE TABLE persons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id),
  display_name TEXT NOT NULL,            -- free-text, any script, never split
  aka          TEXT[] DEFAULT '{}',      -- reserved: aliases for future matching
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id),
  storage_key TEXT NOT NULL,
  width       INT NOT NULL,
  height      INT NOT NULL,
  share_token TEXT UNIQUE,               -- link-only sharing (ollae pattern)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A detection is a box in an image. Source records how it got there.
CREATE TABLE detections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id   UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  bbox_x     REAL NOT NULL,              -- normalized 0..1 so it scales across render sizes
  bbox_y     REAL NOT NULL,
  bbox_w     REAL NOT NULL,
  bbox_h     REAL NOT NULL,
  source     TEXT NOT NULL DEFAULT 'auto', -- 'auto' | 'manual'
  crop_key   TEXT,                        -- stored face crop
  embedding  VECTOR(512),                 -- Phase 2 (pgvector); null until then
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A tag links a detection to a person. Recognition AND collaborators produce
-- SUGGESTED tags; the owner CONFIRMS one. Blank faces are filled last-write-wins
-- (the fill goes straight in as 'confirmed'); changing an already-confirmed face
-- creates a 'suggested' row instead of overwriting. See §4 / §9.
CREATE TABLE tags (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  detection_id UUID NOT NULL REFERENCES detections(id) ON DELETE CASCADE,
  person_id    UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'confirmed', -- 'suggested' | 'confirmed'
  created_by   TEXT,                               -- link visitor id / owner; for attribution
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: no table-level UNIQUE (detection_id) — suggestions must coexist with
  -- the confirmed tag. Instead enforce "at most one CONFIRMED tag per face":
);

-- At most one confirmed identity per detection; unlimited suggestions alongside.
CREATE UNIQUE INDEX one_confirmed_tag_per_detection
  ON tags (detection_id)
  WHERE status = 'confirmed';
```

Normalized (0..1) bounding boxes are deliberate: the same coordinates drive a thumbnail, a phone render, and a desktop render without recomputation.

---

## 8. Phased build plan

### Phase 0 — Foundations (no ML)
- Repo scaffold (Vite/React + Go/chi + Postgres), mirroring the familiar deploy shape.
- Data model above, including the multilingual decisions.
- Image upload + storage + crop/thumbnail generation.
- Accounts + link-based sharing token.

### Phase 1 — Detect, correct, name, view + simple all-labels
- **T1** In-browser detection (MediaPipe Face Detector). Render boxes as SVG overlay.
- **T2** QC flow 1a: "Did we miss anyone?" tap-to-add; size = median of nearest 3–5; drag-resize with generous mobile hit targets.
- **T3** Face-list (one row per face: crop thumbnail + name input) → save. Free-text names, Tab/Enter navigation, progress counter.
- **T4** Viewing: **tap-a-face-to-reveal**.
- **T5** **Show-all-labels (simple):** above/below placement, short leader line, one collision-nudge pass.
- **T6** Responsive correction UI (pinch-zoom/pan, big handles).
- *Milestone: a usable single-user tool + the stakeholder's wow feature.*

### Phase 1.5 — Persistence & collaborative naming
- Persist detections server-side.
- Shareable link; collaborators (no account) fill names. Conflict policy TBD (last-write-wins vs suggestion queue).
- OG preview card for the share link (reuse the ollae caching approach).
- **Text bulk-entry parser:** comma-delimited names → row-cluster by y, sort by x → propose assignment → user nudges before commit.

### Phase 2 — Recognition + robust labels + voice + scale
- Python sidecar: InsightFace detection + ArcFace embeddings → `pgvector`.
- Account-scoped recognition → *suggested* tags to confirm.
- **Show-all-labels (robust):** boundary labeling, margin placement, minimized leader-line crossings.
- **Voice entry:** Whisper transcription → existing parser (best-effort; roster-constrained when available).
- **Large photos (40–200):** tiled detection + search/tap interface (no all-labels).
- Connect contacts / external name source.

### Phase 3 — TouchPoint (gated)
- Read-only roster pull, **opt-out flags enforced before any matching**.
- Match suggestions against roster; human confirms.

---

## 9. Open questions (for future-me)

- **TouchPoint:** read-only roster pull vs. write tags back? Is the consent / opt-out policy resolved on the church side? *(Hard gate on Phase 3 — biometric data of non-consenting people.)*
- ~~**Collaborative naming conflict model**~~ — **DECIDED:** hybrid. Blank faces are last-write-wins (anyone with the link fills freely, no friction); changing an *already-named* face creates a **suggestion** the owner confirms rather than a silent overwrite. Speed where it's harmless, safety where it matters. *(Schema impact: drop `UNIQUE (detection_id)` so suggestions coexist with the confirmed tag — see §7.)*
- **Working title / brand.**
- **Voice:** worth the effort given ASR weakness on romanized Chinese names, or keep it as a delight-only extra?

---

## 10. Known risks

- **Browser detection is weak on dense/small/profile faces.** Mitigated by the QC correction step (Phase 1) and InsightFace upgrade (Phase 2).
- **Recognition degrades below ~112px face crops.** 200-person photos may simply not recognize well regardless of effort — set expectations.
- **Leader-line label layout is the hardest UI work.** De-risked by shipping the simple version first.
- **Voice + romanized Chinese names** is the weakest accuracy combo — text is the reliable path for this congregation.
- **Biometric privacy (TouchPoint)** is a real legal/ethical gate, not a feature toggle.
