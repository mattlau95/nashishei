import { useEffect, useState } from 'react'

const CENTER_SIZE = 128
const SPACING = Math.round(CENTER_SIZE * 0.82)
const CAROUSEL_H = 172
const TILE_RADIUS = Math.round(CENTER_SIZE * 0.22) + 'px'
const SCALE: Record<number, number> = { 0: 1, 1: 0.78, 2: 0.6, 3: 0.48 }
const OPACITY: Record<number, number> = { 0: 1, 1: 0.66, 2: 0.36, 3: 0 }
const Z: Record<number, number> = { 0: 30, 1: 20, 2: 10, 3: 5 }
const AVATAR_COLORS = ['#8E9BAE','#B08C84','#7FA890','#B3A678','#9488B0','#B07F9A','#7C9DAE','#A99A86']

type SpotlightLabel = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  display_name: string
}

type BBox = { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number }

export function SpotlightOverlay({ label }: { label: BBox }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${label.bbox_x * 100}% - 6px)`,
        top: `calc(${label.bbox_y * 100}% - 6px)`,
        width: `calc(${label.bbox_w * 100}% + 12px)`,
        height: `calc(${label.bbox_h * 100}% + 12px)`,
        border: '3px solid rgba(255,255,255,0.92)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: '0 0 0 2000px rgba(0,0,0,0.62)',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    />
  )
}

type Props = {
  labels: SpotlightLabel[]
  crops: Record<string, string>
  highlightedId: string | null
  onHighlight: (id: string | null) => void
  onClose: () => void
  onActiveChange?: (label: SpotlightLabel) => void
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts.length === 1
    ? (parts[0][0] ?? '?').toUpperCase()
    : ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

function sortLabels(labels: SpotlightLabel[]): SpotlightLabel[] {
  return [...labels].sort((a, b) => a.bbox_y - b.bbox_y || a.bbox_x - b.bbox_x)
}

export default function SpotlightPlayer({ labels, crops, highlightedId, onHighlight, onClose, onActiveChange }: Props) {
  const sorted = sortLabels(labels)
  const n = sorted.length
  const [activeIdx, setActiveIdx] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    if (sorted[activeIdx]) onActiveChange?.(sorted[activeIdx])
  }, [activeIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); setActiveIdx((i) => (i - 1 + n) % n) }
      if (e.key === 'ArrowRight') { e.preventDefault(); setActiveIdx((i) => (i + 1) % n) }
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n, onClose])

  const active = sorted[activeIdx]

  const navBtn: React.CSSProperties = {
    width: 46, height: 46, flexShrink: 0, borderRadius: '50%',
    background: '#f0f0f4', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', border: 'none', padding: 0,
  }

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70,
        background: '#fff',
        borderRadius: '30px 30px 0 0',
        boxShadow: '0 -14px 44px rgba(0,0,0,.3)',
        paddingBottom: 30,
        transform: mounted ? 'translateY(0)' : 'translateY(105%)',
        transition: 'transform .5s cubic-bezier(.32,.72,0,1)',
      }}
    >
      {/* Grabber */}
      <div style={{
        position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)',
        width: 38, height: 5, borderRadius: 3, background: 'rgba(60,60,67,.28)',
      }} />

      {/* Close */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '21px 20px 2px' }}>
        <button
          onClick={onClose}
          style={{ fontSize: 17, fontWeight: 600, color: '#007AFF', cursor: 'pointer', background: 'none', border: 'none' }}
        >
          Close
        </button>
      </div>

      {/* Coverflow carousel */}
      <div style={{ position: 'relative', width: '100%', height: CAROUSEL_H, overflow: 'hidden' }}>
        {sorted.map((label, i) => {
          let off = i - activeIdx
          if (off > n / 2) off -= n
          if (off < -n / 2) off += n
          const ab = Math.abs(off)
          if (ab > 3) return null
          const isCenter = off === 0
          const crop = crops[label.detection_id]
          const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
          const isPulsed = isCenter && highlightedId === label.detection_id

          return (
            <div
              key={label.detection_id}
              onClick={() =>
                isCenter
                  ? onHighlight(isPulsed ? null : label.detection_id)
                  : setActiveIdx(i)
              }
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: CENTER_SIZE, height: CENTER_SIZE,
                transform: `translate(-50%,-50%) translateX(${off * SPACING}px) scale(${SCALE[ab]})`,
                opacity: OPACITY[ab],
                zIndex: Z[ab],
                borderRadius: TILE_RADIUS,
                background: crop
                  ? undefined
                  : `radial-gradient(120% 90% at 30% 12%, rgba(255,255,255,.30), rgba(0,0,0,.16)), ${color}`,
                boxShadow: isCenter
                  ? `0 16px 36px rgba(0,0,0,.36), 0 0 0 ${isPulsed ? 4 : 3}px var(--color-accent)`
                  : '0 6px 16px rgba(0,0,0,.22)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'rgba(255,255,255,.96)', fontWeight: 600,
                fontSize: Math.round(CENTER_SIZE * 0.30),
                cursor: isCenter ? 'default' : 'pointer',
                transition: 'transform .5s cubic-bezier(.32,.72,0,1), opacity .4s ease, box-shadow .3s ease',
                userSelect: 'none', overflow: 'hidden',
                pointerEvents: ab > 2 ? 'none' : 'auto',
              }}
            >
              {crop
                ? <img src={crop} alt="" draggable={false} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                : initials(label.display_name)
              }
            </div>
          )
        })}
      </div>

      {/* Bottom row: prev | name + count | next */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '16px 20px 4px' }}>
        <button onClick={() => setActiveIdx((activeIdx - 1 + n) % n)} style={navBtn} aria-label="Previous">
          <svg width="11" height="18" viewBox="0 0 11 18" fill="none">
            <path d="M9 1L2 9l7 8" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#000', letterSpacing: '-.4px', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {active?.display_name}
          </div>
          <div style={{ fontSize: 13.5, color: 'rgba(60,60,67,.6)', marginTop: 3, fontWeight: 500 }}>
            {activeIdx + 1} of {n}
          </div>
        </div>

        <button onClick={() => setActiveIdx((activeIdx + 1) % n)} style={navBtn} aria-label="Next">
          <svg width="11" height="18" viewBox="0 0 11 18" fill="none">
            <path d="M2 1l7 8-7 8" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
