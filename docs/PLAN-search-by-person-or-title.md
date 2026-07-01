# Plan — Search/Browse Photos by Person or Title

**Ticket:** MAT-554 (explore + plan only — no code in this pass)
**Scope today:** the authenticated owner's own gallery (`Home.tsx`'s "Your photos" grid). Not a public/cross-account search — `docs/PROJECT.md` §4 explicitly lists "public/searchable face directory" as a non-goal, and shared-link viewing stays link-only.

---

## Current state (confirmed by code read)

- `images` table has no `title`/`caption` column at all (`db/migrations/001_initial.sql:20-28`).
- `GET /api/images` (`api/internal/handler/images.go:148-184`) returns only `{id, thumbnail_url, share_token}` for every image in the account, unfiltered, unpaginated, sorted `created_at DESC`. No joins to persons/tags.
- There is no `GET /persons` or "list tags for photo" endpoint anywhere. The only place person names are queried across tables is the share-link viewer (`GetSharedImage`, `share.go:94-101`) and the internal ANN-suggestion helper (`computeSuggestions`, `detect.go:43-97`) — neither is reusable as-is for search, but the join shape and account-scoping idiom are.
- No query-param convention exists anywhere in the API (no `?q=`, `?page=`, no pagination at all). This feature establishes the first one — keep it minimal.
- `persons.display_name` has no uniqueness constraint, and `NameDetectionViaShare` (`share.go:184-187`) always inserts a *new* person row rather than reusing an existing one by name. Search must match on `display_name` text, not a canonical person id, and must `DISTINCT` on image id (a photo tagged with two rows that happen to share a display name shouldn't show up twice).

---

## Data model change

Add a nullable `title` column to `images`:

```sql
-- db/migrations/004_image_title.sql
ALTER TABLE images ADD COLUMN title TEXT;
```

- **Set at:** upload time, optional (empty by default — most photos will stay untitled and remain searchable only by person). Editable later via a new `PATCH /images/{id}` handler (small, follows the existing ownership-check idiom in `images.go:37-40`).
- No index needed yet. Ticket itself says this isn't urgent at current photo volumes — revisit with a `pg_trgm` GIN index on `title` and `persons.display_name` if/when ILIKE scans start showing up as slow (Phase 2+ scale note in `docs/PROJECT.md` §4/§8).
- No new tables. `persons`/`tags`/`detections` already have everything search needs.

---

## Query approach

Extend the existing `GET /api/images` route rather than adding a parallel endpoint — same handler, one new optional query param, so there's exactly one gallery-fetch code path for the frontend to call.

```
GET /api/images            -> today's behavior, unchanged
GET /api/images?q=<term>   -> title OR person-name match, same account
```

When `q` is present:

```sql
SELECT id, share_token, title
FROM images i
WHERE account_id = $1
  AND (
    title ILIKE '%' || $2 || '%'
    OR EXISTS (
      SELECT 1 FROM detections d
      JOIN tags t ON t.detection_id = d.id AND t.status = 'confirmed'
      JOIN persons p ON p.id = t.person_id AND p.account_id = i.account_id
      WHERE d.image_id = i.id AND p.display_name ILIKE '%' || $2 || '%'
    )
  )
ORDER BY created_at DESC
```

- `EXISTS` rather than a `JOIN` avoids row fan-out (an image with several confirmed tags would otherwise repeat), so no `DISTINCT` is needed — which matters because Postgres requires `DISTINCT` queries to include every `ORDER BY` column in the select list, and `created_at` isn't part of the response shape.
- `p.account_id = i.account_id` is defense-in-depth: `tags`/`detections` have no direct `account_id` column, so this closes the subquery without trusting that every upstream write path scoped things correctly.
- Only `confirmed` tags are searchable by name (matches how the rest of the app treats `suggested` as not-yet-real).
- Response gains a `title` field on every image, not just search results — the gallery grid needs it either way to eventually display/edit titles.

---

## UI — `Home.tsx`

- A single search `<input>` above the `<h2>Your photos</h2>` line (`Home.tsx:178`), one box for both title and person — matches the ticket's own suggested shape and avoids inventing a two-field UI for a feature with no usage data yet.
- Debounce (~300ms) before calling `/api/images?q=`; empty query falls back to the existing unfiltered fetch (`Home.tsx:48-54`) unchanged.
- Empty-result state: reuse the existing conditional-render slot (`galleryLoaded && gallery.length > 0`, `Home.tsx:176`) and add a sibling "No photos match “{query}”" message for the `galleryLoaded && gallery.length === 0 && query` case.
- Grid markup (`Home.tsx:186-244`) doesn't need to change structurally. Whether to show `title` as a caption under each thumbnail, and how title-editing is exposed in the UI, are open implementation-ticket decisions, not blocking this plan — flagging as the one real open question below.

## Open question for implementation — resolved

Went with option (b): a click-to-edit title caption under each gallery thumbnail, saved via `PATCH /images/{id}` on blur/Enter. The upload flow (option a) turned out to be the wrong place for this — `useFaceDetection.ts` uploads the file automatically the moment it's picked (before the QC/naming steps even render), so there's no natural pause in that flow to collect a title without restructuring it. The `title` form field on `POST /images` is still supported server-side for future use, just not wired to any UI yet.

---

## Suggested implementation tickets

1. **DB + title editing** — migration `004_image_title.sql`, optional title field on upload, `PATCH /images/{id}` to edit it later.
2. **Search endpoint** — `?q=` on `GET /api/images`, title+person ILIKE join above, `title` added to the response shape.
3. **Search UI** — debounced search box on `Home.tsx`, wired to `?q=`, empty state.
