# Viewer User Flow — Tagging View

Covers the shared photo viewer (`/s/:token`) as of the cast-grid + spotlight update.

---

## Entry point

User opens a share link. The app fetches the photo + all face labels from `/api/share/{token}`.

**Two cases on load:**
- Some faces are named → action bar appears below the photo
- No faces named yet → action bar is hidden; tap-to-name is the only interaction

---

## Always-on: Tap to reveal / name a face

Available in every state except while Slideshow is active.

1. User taps any face area on the photo
2. **If named** → name label appears above or below that face; tapping again dismisses it
3. **If unnamed** → name input popover appears; user types and saves; face becomes named in the session
4. Tapping anywhere outside a face dismisses the active label or popover

---

## Action bar (below photo)

Appears whenever at least one face is named. Buttons shown depend on face count:

| Named faces | Buttons shown |
|-------------|---------------|
| ≤ 12        | Show all names · Slideshow |
| > 12        | Browse names · Slideshow |

---

## Show all names (≤ 12 faces only)

1. User taps "Show all names"
2. All named faces get labels placed in the top/bottom margins with leader lines (existing ShowAllOverlay)
3. Tap-to-reveal is suspended while this overlay is active
4. Tapping "Hide names" dismisses the overlay

---

## Browse names (> 12 faces)

Used when the photo has too many faces for the all-labels overlay to be readable.

1. User taps "Browse names"
2. A scrollable roster expands below the photo — one row per named face, sorted top-to-bottom then left-to-right (reading order)
3. Each row shows: face crop thumbnail (72 × 72) + full name
4. Header reads: `"13 of 17 named — tap a name to find them in the photo"` (counts named vs. total detected)
5. User taps a row:
   - The page scrolls back up to the photo
   - ~400 ms after the scroll starts, a yellow pulse ring animates once around that face on the photo
   - The grid row stays highlighted (yellow tint) until the user taps it again or taps a different row
6. Tapping the same row again deselects it (ring disappears, row returns to normal)
7. Tapping "Hide names" collapses the roster

---

## Slideshow

Available for any face count as long as at least one face is named.

1. User taps "Slideshow"
2. The photo dims everywhere except the first face, which is ringed with a bright white border
3. A footer bar appears fixed at the bottom of the screen showing:
   - Face crop (80 × 80) + full name in large text
   - Position counter ("3 of 17")
   - Controls: ‹ Prev · ▶ Play / ⏸ Pause · Next › · ✕ Close
4. Slideshow **opens paused** on the first face — user reads the name, then decides when to proceed
5. User taps ▶ to start auto-advancing (every 4 seconds per face)
6. User taps ‹ or › at any time to step manually (tapping either also pauses auto-play)
7. At the last face, advancing wraps back to the first
8. Keyboard shortcuts (desktop): ← / → to step, Space to toggle play/pause, Escape to close
9. Tapping ✕ or Escape closes the slideshow and returns to the normal photo view

---

## Mode interactions / constraints

- Tap-to-reveal is **suspended** during Slideshow (no face hit targets active)
- Show all names and Browse names are **mutually exclusive** (opening one closes the other — enforced by count gating: only one button is ever shown at a time)
- Slideshow can be opened from either mode; closing it returns to the previous state
- The Browse names grid selection (highlighted row + pulse ring) is independent of Slideshow — opening then closing Slideshow does not clear the selected row
