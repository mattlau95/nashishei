# QCOverlay Refactor — Add a Selection Model

**File:** `frontend/src/components/QCOverlay.tsx`
**Goal:** Fix clunky, collision-prone interaction by introducing selection state. Boxes are plain outlines by default; only the *selected* box exposes handles and the × button. This collapses the live interactive surface from ~225 elements (25 faces × ~9 controls) to ~9 at a time.

Do this as **two separate passes**. Land Pass 1 first, verify, then do Pass 2.

---

## Root cause (why we're doing this)

There is currently no selection state. Every box renders 7 resize handles + a drag body + a × button, all the time. On a dense group photo these overlap neighboring boxes, so hit targets collide and taps are ambiguous. Disambiguation is currently done with `stopPropagation` (suppressing the conflict) rather than by not having the conflict. Selection removes the conflict structurally.

Keep the existing pieces — they're fine and should be reused: pointer-capture funneled through `containerRef`, the HTML-layer interaction divs, `applyResize`, `median`, `nearestN`, and the SVG outline layer (`pointerEvents: none`).

---

## Pass 1 — Selection model + gesture routing

### 1. New state

```ts
// Render-driving state
const [selectedId, setSelectedId] = useState<string | null>(null);
const [mode, setMode] = useState<'select' | 'add'>('select');

// Drag bookkeeping — a ref, must NOT cause re-renders during a drag
const drag = useRef<{
  kind: 'pending' | 'move' | 'resize';
  detId: string;
  handle: string | null;          // 'tl'|'tc'|'ml'|'mr'|'bl'|'bc'|'br'  | null for moves
  startBbox: Bbox;                 // {x,y,w,h} normalized at pointerdown
  startPx: { x: number; y: number };  // pointer px at pointerdown
} | null>(null);

const DRAG_THRESHOLD_PX = 5;       // below this, a pointerdown→up is a TAP, not a drag
```

Only `selectedId` and `mode` drive renders. Everything about the in-flight drag lives in `drag.current`.

### 2. Gesture routing — resolve intent on pointerup, not via stopPropagation

Replace the current move/resize/add disambiguation with this lifecycle. All handlers still funnel through `containerRef` with `setPointerCapture(e.pointerId)`.

**pointerdown on a box body**
```
drag.current = { kind: 'pending', detId, handle: null, startBbox, startPx };
containerRef.current.setPointerCapture(e.pointerId);
// do NOT select yet, do NOT move yet
```

**pointerdown on a resize handle** (handles only exist on the selected box — see Pass 1 §4)
```
drag.current = { kind: 'resize', detId: selectedId, handle, startBbox, startPx };
containerRef.current.setPointerCapture(e.pointerId);
```

**pointermove (onContainerMove)**
```
if (!drag.current) return;
const dxPx = e.clientX - drag.current.startPx.x;
const dyPx = e.clientY - drag.current.startPx.y;

if (drag.current.kind === 'pending') {
  if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return;  // still a tap so far
  drag.current.kind = 'move';                              // promote to drag
}
// apply move/resize by writing transform on the ACTIVE element via ref (see Pass 1 §5)
```

**pointerup (onContainerUp)**
```
const d = drag.current;
drag.current = null;
if (!d) return;

if (d.kind === 'pending') {
  setSelectedId(d.detId);           // never crossed threshold → it was a TAP → select
} else {
  commitBboxToState(d.detId, finalBbox);   // move/resize → commit ONCE, here
}
```

The threshold is essential: without it every intended tap jitters into a micro-drag, which is half of what "clunky" feels like on mobile.

### 3. The add gesture — explicit mode, not tap-the-gaps

Remove tap-empty-to-add. Replace with an explicit toggle so it can never fight tap-empty-to-deselect (and so "empty" doesn't have to mean the slivers between boxes).

- A visible **`+ Add face`** button sets `mode = 'add'`.
- In `mode === 'add'`: a tap anywhere on the image adds a box (median-sized via existing helper), then `setSelectedId(newId)` and `setMode('select')`. One box per toggle.
- In `mode === 'select'`: a tap on empty space → `setSelectedId(null)`. No box is ever spawned by accident.

A visible button is also more legible for the 90-year-old stakeholder than a hidden gap-tap affordance (brand pillar #1).

### 4. Render rule — handles/× on the selected box ONLY

- **Every box:** SVG outline (keep dashed = `source:'manual'`, solid = `source:'auto'`) + one transparent body div for tap-to-select / drag-to-move.
- **Selected box only:** the 7 handle divs + the × button + a visually distinct outline (thicker / accent color) so the active box is obvious.

This is the change that collapses ~225 live controls to ~9.

### 5. Perf — don't re-render 25 divs per pointermove

During an active move/resize, write `style.transform` (or inline left/top) directly on the **one** active element through a ref. Only call `setState`/commit the bbox on **pointerup**. Running the whole detections array through React state on every pointermove re-lays-out all overlay divs at 60fps and feels imprecise even when `applyResize` is mathematically correct.

### Pass 1 acceptance check
- Tapping a box selects it; only that box shows handles + ×.
- Tapping empty space (select mode) deselects; spawns nothing.
- `+ Add face` → one tap places one box, which is then selected.
- A deliberate tap never turns into a tiny drag.
- Dragging a box is smooth on mobile (no full-overlay relayout mid-drag).

---

## Pass 2 — Coordinate cleanup (do separately)

Remove the `preserveAspectRatio="none"` stretch. Instead, size the overlay container to the **actual rendered image rect** (object-fit math or measure the `<img>`), and let every box be clean `%` within that rect. The stretch fakes the coordinate mapping and adds a low-grade imprecision that no amount of selection work fixes, because it lives in the mapping underneath everything.

### Pass 2 acceptance check
- Box outlines sit exactly on faces at multiple viewport widths and aspect ratios.
- No distortion of the × badge / handle positions relative to their box.

---

## Out of scope (note, don't build now)
- Repeated taps at the same point cycling selection through stacked boxes under the pointer. Nice later; skip for now.

## Constraints to respect
- Mobile-first; keep 44px effective hit targets on the handles of the selected box.
- Don't regress the reusable pieces: pointer capture via `containerRef`, HTML interaction layer, `applyResize` / `median` / `nearestN`, SVG outline layer.
