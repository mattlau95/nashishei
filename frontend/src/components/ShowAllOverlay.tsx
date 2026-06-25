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
const ABOVE_THRESHOLD = 0.25
const LABEL_H_EST = 0.06

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

const MAX_PASSES = 8

function resolveCollisions(labels: PlacedLabel[]): void {
  labels.sort((a, b) => a.labelLeft - b.labelLeft)
  let changed = true
  let pass = 0
  while (changed && pass < MAX_PASSES) {
    changed = false
    pass++
    for (let i = 1; i < labels.length; i++) {
      const prev = labels[i - 1]
      const cur = labels[i]
      const minLeft = prev.labelLeft + prev.estWidth + NUDGE_GAP
      if (minLeft > cur.labelLeft) {
        cur.labelLeft = Math.min(minLeft, 1 - cur.estWidth)
        changed = true
      }
    }
    for (let i = labels.length - 2; i >= 0; i--) {
      const next = labels[i + 1]
      const cur = labels[i]
      const maxRight = next.labelLeft - NUDGE_GAP
      if (cur.labelLeft + cur.estWidth > maxRight) {
        cur.labelLeft = Math.max(maxRight - cur.estWidth, 0)
        changed = true
      }
    }
  }
  for (const label of labels) {
    label.labelLeft = Math.max(0, Math.min(label.labelLeft, 1 - label.estWidth))
    label.lineX2 = label.labelLeft + label.estWidth / 2
  }
}

function labelHitsFace(
  labelLeft: number, estWidth: number, anchorY: number, above: boolean, faces: Label[], ownId: string
): boolean {
  const lx1 = labelLeft
  const lx2 = labelLeft + estWidth
  const ly1 = above ? anchorY - LABEL_H_EST : anchorY
  const ly2 = above ? anchorY : anchorY + LABEL_H_EST
  return faces.some(
    (f) =>
      f.detection_id !== ownId &&
      lx1 < f.bbox_x + f.bbox_w &&
      lx2 > f.bbox_x &&
      ly1 < f.bbox_y + f.bbox_h &&
      ly2 > f.bbox_y
  )
}

function computeLayout(labels: Label[]): PlacedLabel[] {
  const placed: PlacedLabel[] = labels.map((l) => {
    const estWidth = Math.max(l.display_name.length * CHAR_W + LABEL_PAD, 0.08)
    const centerX = l.bbox_x + l.bbox_w / 2
    const labelLeft = Math.min(Math.max(centerX - estWidth / 2, 0), 1 - estWidth)

    let above = l.bbox_y >= ABOVE_THRESHOLD
    const anchorAbove = l.bbox_y - LINE_GAP
    const anchorBelow = l.bbox_y + l.bbox_h + LINE_GAP
    const hitsAbove = labelHitsFace(labelLeft, estWidth, anchorAbove, true, labels, l.detection_id)
    const hitsBelow = labelHitsFace(labelLeft, estWidth, anchorBelow, false, labels, l.detection_id)
    if (above && hitsAbove && !hitsBelow) above = false
    else if (!above && hitsBelow && !hitsAbove) above = true

    const lineAnchorY = above ? anchorAbove : anchorBelow
    const lineX1 = centerX
    const lineY1 = above ? l.bbox_y : l.bbox_y + l.bbox_h
    const lineX2 = labelLeft + estWidth / 2
    const lineY2 = lineAnchorY

    return { ...l, above, estWidth, labelLeft, lineAnchorY, lineX1, lineY1, lineX2, lineY2 }
  })

  const aboveGroup = placed.filter((p) => p.above)
  const belowGroup = placed.filter((p) => !p.above)
  resolveCollisions(aboveGroup)
  resolveCollisions(belowGroup)

  return [...aboveGroup, ...belowGroup]
}

export default function ShowAllOverlay({ labels }: { labels: Label[] }) {
  const placed = useMemo(() => computeLayout(labels), [labels])

  const containerRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // lineX2 overrides keyed by detection_id, set after measuring actual label widths
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
      {/* Leader lines in SVG */}
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 9 }}
      >
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

      {/* Label pills in HTML */}
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
