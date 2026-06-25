import { useLayoutEffect, useMemo, useRef, useState } from 'react'

type Label = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  display_name: string
}

const LINE_GAP = 0.02
const NUDGE_GAP = 0.008
const CHAR_W = 0.016
const LABEL_PAD = 0.04
const LABEL_H_EST = 0.06
const SHELF_H = LABEL_H_EST + NUDGE_GAP
const ROW_TOLERANCE = 0.12

type PlacedLabel = Label & {
  above: boolean
  estWidth: number
  labelLeft: number
  lineAnchorY: number
  lineX1: number
  lineY1: number
  lineX2: number
  lineY2: number
}

type FaceRow = {
  faces: Label[]
  top: number
  bottom: number
  left: number
  right: number
}

// Group faces into horizontal rows by Y proximity.
function clusterRows(faces: Label[]): FaceRow[] {
  const sorted = [...faces].sort((a, b) => a.bbox_y - b.bbox_y)
  const rows: Label[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const last = rows[rows.length - 1]
    const lastTop = Math.min(...last.map(f => f.bbox_y))
    if (sorted[i].bbox_y - lastTop <= ROW_TOLERANCE) {
      last.push(sorted[i])
    } else {
      rows.push([sorted[i]])
    }
  }
  return rows.map(faces => ({
    faces,
    top:    Math.min(...faces.map(f => f.bbox_y)),
    bottom: Math.max(...faces.map(f => f.bbox_y + f.bbox_h)),
    left:   Math.min(...faces.map(f => f.bbox_x)),
    right:  Math.max(...faces.map(f => f.bbox_x + f.bbox_w)),
  }))
}

// Build a single SVG path string that outlines every face row as one shape.
// Each row becomes a subpath (M…Z); SVG renders them with one stroke.
function buildFramePath(rows: FaceRow[]): string {
  return rows
    .map(r => `M ${r.left} ${r.top} L ${r.right} ${r.top} L ${r.right} ${r.bottom} L ${r.left} ${r.bottom} Z`)
    .join(' ')
}

// Pack faces into horizontal shelves on one side of the frame edge.
//
// Step 1 — proximity sort: faces whose edge is closest to frameEdge go first →
//   they land on shelf 0 (innermost, shortest leader line).
//   "above": closest = smallest bbox_y.
//   "below": closest = largest bbox_y + bbox_h.
//
// Step 2 — within each shelf, re-sort by face X center so labels read
//   left-to-right and lines don't cross within the same shelf.
function packShelves(faces: Label[], above: boolean, frameEdge: number): PlacedLabel[] {
  if (faces.length === 0) return []

  const byProximity = above
    ? [...faces].sort((a, b) => a.bbox_y - b.bbox_y)
    : [...faces].sort((a, b) => (b.bbox_y + b.bbox_h) - (a.bbox_y + a.bbox_h))

  type Shelved = { label: Label; shelf: number; estWidth: number }
  const shelved: Shelved[] = []
  let shelf = 0
  let shelfW = 0
  for (const l of byProximity) {
    const estWidth = Math.max(l.display_name.length * CHAR_W + LABEL_PAD, 0.08)
    if (shelfW + estWidth > 1 - NUDGE_GAP && shelfW > 0) { shelf++; shelfW = 0 }
    shelved.push({ label: l, shelf, estWidth })
    shelfW += estWidth + NUDGE_GAP
  }

  const result: PlacedLabel[] = []
  for (let s = 0; s <= shelf; s++) {
    const inShelf = shelved
      .filter(x => x.shelf === s)
      .sort((a, b) => (a.label.bbox_x + a.label.bbox_w / 2) - (b.label.bbox_x + b.label.bbox_w / 2))

    const lineAnchorY = above
      ? frameEdge - LINE_GAP - s * SHELF_H
      : frameEdge + LINE_GAP + s * SHELF_H

    // Center the shelf over the centroid of its faces rather than anchoring at x=0.
    const totalW    = inShelf.reduce((sum, x) => sum + x.estWidth, 0) + (inShelf.length - 1) * NUDGE_GAP
    const centroidX = inShelf.reduce((sum, x) => sum + x.label.bbox_x + x.label.bbox_w / 2, 0) / inShelf.length
    let labelLeft   = Math.max(0, Math.min(1 - totalW, centroidX - totalW / 2))

    for (const { label: l, estWidth } of inShelf) {
      result.push({
        ...l, above, estWidth, labelLeft, lineAnchorY,
        lineX1: l.bbox_x + l.bbox_w / 2,
        lineY1: above ? l.bbox_y : l.bbox_y + l.bbox_h,
        lineX2: labelLeft + estWidth / 2,
        lineY2: lineAnchorY,
      })
      labelLeft += estWidth + NUDGE_GAP
    }
  }
  return result
}

function computeLayout(labels: Label[]): PlacedLabel[] {
  if (labels.length === 0) return []

  const frameTop    = Math.min(...labels.map(l => l.bbox_y))
  const frameBottom = Math.max(...labels.map(l => l.bbox_y + l.bbox_h))

  // Assign each face to whichever frame edge its own bbox is physically closest to.
  // This keeps leader lines as short as possible and avoids labels inside the frame.
  const topGroup: Label[]    = []
  const bottomGroup: Label[] = []
  for (const l of labels) {
    const distTop    = l.bbox_y - frameTop
    const distBottom = frameBottom - (l.bbox_y + l.bbox_h)
    ;(distTop <= distBottom ? topGroup : bottomGroup).push(l)
  }

  return [
    ...packShelves(topGroup,    true,  frameTop),
    ...packShelves(bottomGroup, false, frameBottom),
  ]
}

export default function ShowAllOverlay({ labels }: { labels: Label[] }) {
  const rows   = useMemo(() => labels.length ? clusterRows(labels) : [], [labels])
  const placed = useMemo(() => computeLayout(labels), [labels])

  const containerRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [measuredX2, setMeasuredX2] = useState<Map<string, number>>(new Map())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const containerW = container.offsetWidth
    if (containerW === 0) return
    const next = new Map<string, number>()
    for (const p of placed) {
      const el = labelRefs.current.get(p.detection_id)
      if (el) {
        const actualW = el.offsetWidth / containerW
        next.set(p.detection_id, p.labelLeft + actualW / 2)
      }
    }
    setMeasuredX2(next)
  }, [placed])

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 9 }}
      >
        {/* DEBUG: one path outlining all face rows as a single shape */}
        {rows.length > 0 && (
          <path
            d={buildFramePath(rows)}
            fill="none"
            stroke="rgba(255,80,80,0.8)"
            strokeWidth="2"
            strokeDasharray="0.01 0.01"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {placed.map((p) => (
          <line
            key={p.detection_id}
            x1={p.lineX1}
            y1={p.lineY1}
            x2={measuredX2.get(p.detection_id) ?? p.lineX2}
            y2={p.lineY2}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {placed.map((p) => (
        <div
          key={p.detection_id}
          ref={(el) => {
            if (el) labelRefs.current.set(p.detection_id, el)
            else labelRefs.current.delete(p.detection_id)
          }}
          style={{
            position: 'absolute',
            left: `${p.labelLeft * 100}%`,
            ...(p.above
              ? { bottom: `${(1 - p.lineAnchorY) * 100}%` }
              : { top: `${p.lineAnchorY * 100}%` }),
            backgroundColor: 'var(--color-overlay-label)',
            color: '#fff',
            fontSize: 'var(--text-sm)',
            lineHeight: '1.2',
            padding: '3px 10px',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {p.display_name}
        </div>
      ))}
    </div>
  )
}
