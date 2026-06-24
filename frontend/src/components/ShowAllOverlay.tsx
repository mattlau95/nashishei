import { useMemo } from 'react'

type Label = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  display_name: string
}

// Normalized-coordinate constants (0–1 relative to image dimensions)
const LABEL_H = 0.06
const LINE_GAP = 0.015
const NUDGE_GAP = 0.008
// Rough per-character width in normalized units at a ~375px viewport.
// Chinese chars are wider per glyph so we use a slightly higher value.
const CHAR_W = 0.024
const LABEL_PAD = 0.06

type PlacedLabel = Label & {
  above: boolean
  estWidth: number
  labelLeft: number
  labelTopY: number
  lineX1: number
  lineY1: number
  lineX2: number
  lineY2: number
}

function computeLayout(labels: Label[]): PlacedLabel[] {
  const placed: PlacedLabel[] = labels.map((l) => {
    const above = l.bbox_y >= 0.25
    const estWidth = Math.max(l.display_name.length * CHAR_W + LABEL_PAD, 0.1)
    const centerX = l.bbox_x + l.bbox_w / 2
    const labelLeft = Math.min(Math.max(centerX - estWidth / 2, 0), 1 - estWidth)
    const labelTopY = above
      ? l.bbox_y - LINE_GAP - LABEL_H
      : l.bbox_y + l.bbox_h + LINE_GAP

    const lineX1 = centerX
    const lineY1 = above ? l.bbox_y : l.bbox_y + l.bbox_h
    const lineX2 = labelLeft + estWidth / 2
    const lineY2 = above ? labelTopY + LABEL_H : labelTopY

    return { ...l, above, estWidth, labelLeft, labelTopY, lineX1, lineY1, lineX2, lineY2 }
  })

  // Sort left → right for the nudge pass
  placed.sort((a, b) => a.labelLeft - b.labelLeft)

  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1]
    const cur = placed[i]
    const minLeft = prev.labelLeft + prev.estWidth + NUDGE_GAP
    if (minLeft > cur.labelLeft) {
      cur.labelLeft = Math.min(minLeft, 1 - cur.estWidth)
      // Update leader line x2 to match nudged position
      cur.lineX2 = cur.labelLeft + cur.estWidth / 2
    }
  }

  return placed
}

export default function ShowAllOverlay({ labels }: { labels: Label[] }) {
  const placed = useMemo(() => computeLayout(labels), [labels])

  return (
    <>
      {/* Leader lines in SVG */}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 9,
        }}
      >
        {placed.map((p) => (
          <line
            key={p.detection_id}
            x1={p.lineX1}
            y1={p.lineY1}
            x2={p.lineX2}
            y2={p.lineY2}
            stroke="rgba(255,255,255,0.65)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* Label pills in HTML */}
      {placed.map((p) => (
        <div
          key={p.detection_id}
          style={{
            position: 'absolute',
            left: `${p.labelLeft * 100}%`,
            top: `${p.labelTopY * 100}%`,
            width: `${p.estWidth * 100}%`,
            backgroundColor: 'var(--color-overlay-label)',
            color: '#fff',
            fontSize: 'var(--text-sm)',
            lineHeight: '1.2',
            padding: '3px 10px',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: 10,
            boxSizing: 'border-box',
          }}
        >
          {p.display_name}
        </div>
      ))}
    </>
  )
}
