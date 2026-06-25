import { useRef, useState, useCallback } from 'react'
import type { Detection } from '../types/detection'

type Bbox = { x: number; y: number; w: number; h: number }
type HandleId = 'tl' | 'tc' | 'ml' | 'mr' | 'bl' | 'bc' | 'br'

type DragRef = {
  kind: 'pending' | 'move' | 'resize'
  detId: string
  handle: HandleId | null
  startBbox: Bbox
  startPx: { x: number; y: number }
  liveBox: Bbox
  boxEl: HTMLDivElement | null
}

const DRAG_THRESHOLD_PX = 5

// Offsets are half of --tap-target (44px / 2 = 22px)
const HANDLES: { id: HandleId; style: React.CSSProperties }[] = [
  { id: 'tl', style: { top: -22, left: -22, cursor: 'nw-resize' } },
  { id: 'tc', style: { top: -22, left: '50%', transform: 'translateX(-50%)', cursor: 'n-resize' } },
  { id: 'ml', style: { top: '50%', left: -22, transform: 'translateY(-50%)', cursor: 'w-resize' } },
  { id: 'mr', style: { top: '50%', right: -22, transform: 'translateY(-50%)', cursor: 'e-resize' } },
  { id: 'bl', style: { bottom: -22, left: -22, cursor: 'sw-resize' } },
  { id: 'bc', style: { bottom: -22, left: '50%', transform: 'translateX(-50%)', cursor: 's-resize' } },
  { id: 'br', style: { bottom: -22, right: -22, cursor: 'se-resize' } },
]

function applyResize(handle: HandleId, bbox: Bbox, dx: number, dy: number): Bbox {
  let { x, y, w, h } = bbox
  const MIN = 0.02
  if (handle.includes('l')) { x += dx; w = Math.max(MIN, w - dx) }
  if (handle.includes('r')) { w = Math.max(MIN, w + dx) }
  if (handle.includes('t')) { y += dy; h = Math.max(MIN, h - dy) }
  if (handle.includes('b')) { h = Math.max(MIN, h + dy) }
  return { x: Math.max(0, x), y: Math.max(0, y), w, h }
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0.08
  const s = [...vals].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function nearestN(dets: Detection[], nx: number, ny: number, n: number): Detection[] {
  return [...dets]
    .map((d) => ({ d, dist: Math.hypot(d.bbox_x + d.bbox_w / 2 - nx, d.bbox_y + d.bbox_h / 2 - ny) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map((e) => e.d)
}

type Props = {
  detections: Detection[]
  setDetections: React.Dispatch<React.SetStateAction<Detection[]>>
  addMode: boolean
  scale?: number
}

export default function QCOverlay({ detections, setDetections, addMode, scale = 1 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drag = useRef<DragRef | null>(null)
  const boxRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const getRect = useCallback(() => containerRef.current!.getBoundingClientRect(), [])

  // ── box body: tap-to-select or drag-to-move ──────────────────────────────
  function onBoxDown(e: React.PointerEvent, det: Detection) {
    e.stopPropagation()
    containerRef.current?.setPointerCapture(e.pointerId)
    drag.current = {
      kind: 'pending',
      detId: det.id,
      handle: null,
      startBbox: { x: det.bbox_x, y: det.bbox_y, w: det.bbox_w, h: det.bbox_h },
      startPx: { x: e.clientX, y: e.clientY },
      liveBox: { x: det.bbox_x, y: det.bbox_y, w: det.bbox_w, h: det.bbox_h },
      boxEl: boxRefs.current.get(det.id) ?? null,
    }
  }

  // ── resize handle ─────────────────────────────────────────────────────────
  function onHandleDown(e: React.PointerEvent, det: Detection, handle: HandleId) {
    e.stopPropagation()
    containerRef.current?.setPointerCapture(e.pointerId)
    drag.current = {
      kind: 'resize',
      detId: det.id,
      handle,
      startBbox: { x: det.bbox_x, y: det.bbox_y, w: det.bbox_w, h: det.bbox_h },
      startPx: { x: e.clientX, y: e.clientY },
      liveBox: { x: det.bbox_x, y: det.bbox_y, w: det.bbox_w, h: det.bbox_h },
      boxEl: boxRefs.current.get(det.id) ?? null,
    }
  }

  // ── background ────────────────────────────────────────────────────────────
  function onContainerDown(_e: React.PointerEvent<HTMLDivElement>) {
    // No pointer capture here — background touches must bubble to the zoom wrapper.
    // Capture only happens in onBoxDown/onHandleDown where a drag is definite.
  }

  // ── move: mutate DOM directly, no React re-render during drag ─────────────
  function onContainerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return

    const dxPx = e.clientX - d.startPx.x
    const dyPx = e.clientY - d.startPx.y

    if (d.kind === 'pending') {
      if (Math.hypot(dxPx, dyPx) < DRAG_THRESHOLD_PX) return
      d.kind = 'move'
    }

    const r = getRect()
    const dx = dxPx / r.width
    const dy = dyPx / r.height

    const nb: Bbox =
      d.kind === 'move'
        ? {
            x: Math.max(0, Math.min(1 - d.startBbox.w, d.startBbox.x + dx)),
            y: Math.max(0, Math.min(1 - d.startBbox.h, d.startBbox.y + dy)),
            w: d.startBbox.w,
            h: d.startBbox.h,
          }
        : applyResize(d.handle!, d.startBbox, dx, dy)

    d.liveBox = nb

    if (d.boxEl) {
      d.boxEl.style.left = `${nb.x * 100}%`
      d.boxEl.style.top = `${nb.y * 100}%`
      d.boxEl.style.width = `${nb.w * 100}%`
      d.boxEl.style.height = `${nb.h * 100}%`
    }
  }

  // ── up: resolve intent, commit state once ─────────────────────────────────
  function onContainerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    drag.current = null

    if (!d) {
      // Background tap
      if (addMode) {
        const r = getRect()
        const nx = (e.clientX - r.left) / r.width
        const ny = (e.clientY - r.top) / r.height
        const nearest = nearestN(detections, nx, ny, 5)
        const w = median(nearest.map((det) => det.bbox_w))
        const h = median(nearest.map((det) => det.bbox_h))
        const newId = crypto.randomUUID()
        setDetections((prev) => [
          ...prev,
          {
            id: newId,
            bbox_x: Math.max(0, Math.min(1 - w, nx - w / 2)),
            bbox_y: Math.max(0, Math.min(1 - h, ny - h / 2)),
            bbox_w: w,
            bbox_h: h,
            source: 'manual',
          },
        ])
        setSelectedId(newId)
        // add mode stays active — user exits explicitly via Cancel
      } else {
        setSelectedId(null)
      }
      return
    }

    if (d.kind === 'pending') {
      // Under threshold — it was a tap → select; pull keyboard focus so arrow/delete keys work immediately
      setSelectedId(d.detId)
      containerRef.current?.focus()
    } else {
      // Move or resize committed — write final bbox to state once
      const fb = d.liveBox
      setDetections((prev) =>
        prev.map((det) =>
          det.id !== d.detId
            ? det
            : { ...det, bbox_x: fb.x, bbox_y: fb.y, bbox_w: fb.w, bbox_h: fb.h },
        ),
      )
      setSelectedId(d.detId)
    }
  }

  // ── keyboard: Tab cycle, arrow nudge, Backspace/Delete remove, Escape deselect ─
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Tab') {
      e.preventDefault()
      const sorted = [...detections].sort((a, b) => a.bbox_y - b.bbox_y || a.bbox_x - b.bbox_x)
      if (sorted.length === 0) return
      if (!selectedId) {
        setSelectedId(e.shiftKey ? sorted[sorted.length - 1].id : sorted[0].id)
        return
      }
      const idx = sorted.findIndex((d) => d.id === selectedId)
      const next = idx === -1 ? 0 : e.shiftKey
        ? (idx - 1 + sorted.length) % sorted.length
        : (idx + 1) % sorted.length
      setSelectedId(sorted[next].id)
      return
    }

    if (!selectedId) return

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault()
      const NUDGE = e.shiftKey ? 0.02 : 0.005
      const dx = e.key === 'ArrowLeft' ? -NUDGE : e.key === 'ArrowRight' ? NUDGE : 0
      const dy = e.key === 'ArrowUp' ? -NUDGE : e.key === 'ArrowDown' ? NUDGE : 0
      setDetections((prev) =>
        prev.map((det) =>
          det.id !== selectedId
            ? det
            : {
                ...det,
                bbox_x: Math.max(0, Math.min(1 - det.bbox_w, det.bbox_x + dx)),
                bbox_y: Math.max(0, Math.min(1 - det.bbox_h, det.bbox_y + dy)),
              },
        ),
      )
      return
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      setDetections((prev) => prev.filter((d) => d.id !== selectedId))
      setSelectedId(null)
      return
    }

    if (e.key === 'Escape') {
      setSelectedId(null)
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        position: 'absolute',
        inset: 0,
        touchAction: 'none',
        userSelect: 'none',
        cursor: addMode ? 'crosshair' : 'default',
      }}
      onPointerDown={onContainerDown}
      onPointerMove={onContainerMove}
      onPointerUp={onContainerUp}
      onPointerCancel={onContainerUp}
      onKeyDown={onKeyDown}
    >
      {/* One div per detection: CSS outline for the visual box, no SVG layer needed.
          outline is layout-independent (drawn outside border-box) and has uniform
          pixel width regardless of image aspect ratio — no preserveAspectRatio distortion. */}
      {detections.map((det) => {
        const sel = det.id === selectedId
        return (
          <div
            key={det.id}
            ref={(el) => { if (el) boxRefs.current.set(det.id, el); else boxRefs.current.delete(det.id) }}
            style={{
              position: 'absolute',
              left: `${det.bbox_x * 100}%`,
              top: `${det.bbox_y * 100}%`,
              width: `${det.bbox_w * 100}%`,
              height: `${det.bbox_h * 100}%`,
              outline: sel
                ? '2px solid #fff'
                : det.source === 'manual'
                ? '2px dashed rgba(255,230,80,1)'
                : '2px solid rgba(250,220,0,0.9)',
            }}
          >
            {/* tap-to-select / drag-to-move surface */}
            <div
              style={{ position: 'absolute', inset: 0, cursor: sel ? 'grab' : 'pointer' }}
              onPointerDown={(e) => onBoxDown(e, det)}
            />

            {sel && (
              <>
                {/* × — outside top-right; safe since tr handle is absent */}
                <button
                  aria-label="Delete face"
                  style={{
                    position: 'absolute',
                    top: -14,
                    right: -14,
                    width: 28,
                    height: 28,
                    padding: 0,
                    background: 'var(--color-overlay-label)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    lineHeight: '28px',
                    textAlign: 'center',
                    transform: `scale(${1 / scale})`,
                    transformOrigin: 'center',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setDetections((prev) => prev.filter((d) => d.id !== det.id))
                    setSelectedId(null)
                  }}
                >
                  ×
                </button>

                {/* 7 resize handles — var(--tap-target) touch targets, counter-scaled to stay fixed screen size */}
                {HANDLES.map((h) => {
                  const existing = (h.style.transform as string) ?? ''
                  const scaleT = `scale(${1 / scale})`
                  return (
                  <div
                    key={h.id}
                    style={{
                      position: 'absolute',
                      width: 'var(--tap-target)',
                      height: 'var(--tap-target)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transformOrigin: 'center',
                      ...h.style,
                      transform: existing ? `${existing} ${scaleT}` : scaleT,
                    }}
                    onPointerDown={(e) => onHandleDown(e, det, h.id)}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        background: 'var(--color-accent)',
                        border: '1px solid rgba(0,0,0,0.5)',
                        pointerEvents: 'none',
                      }}
                    />
                  </div>
                  )
                })}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
