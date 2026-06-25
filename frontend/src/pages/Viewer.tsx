import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ShowAllOverlay from '../components/ShowAllOverlay'

type SharedLabel = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  display_name: string | null
}

type SharedImage = {
  id: string
  width: number
  height: number
  thumbnail_url: string
  labels: SharedLabel[]
}

const HIT_PAD = 8
// Faces below this Y get labels above; faces above it (top 25%) get labels below.
// Minimum safe value is ~0.085 (label height / image height); 0.25 gives comfortable margin.
const ABOVE_THRESHOLD = 0.25

function NameLabel({ label }: { label: SharedLabel }) {
  const above = label.bbox_y >= ABOVE_THRESHOLD
  const centerX = (label.bbox_x + label.bbox_w / 2) * 100

  return (
    <div
      style={{
        position: 'absolute',
        // Center on face; clamp keeps label inside container at both edges.
        // Assumes max label width ~200px (100px half-width in the preferred calc).
        left: `clamp(8px, calc(${centerX}% - 100px), calc(100% - 208px))`,
        ...(above
          ? { bottom: `calc(${(1 - label.bbox_y) * 100}% + 6px)` }
          : { top: `calc(${(label.bbox_y + label.bbox_h) * 100}% + 6px)` }),
        maxWidth: '200px',
        backgroundColor: 'var(--color-overlay-label)',
        color: '#fff',
        fontSize: 'var(--text-lg)',
        lineHeight: '1.2',
        padding: '4px 12px',
        borderRadius: 'var(--radius-sm)',
        wordBreak: 'break-word',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {label.display_name}
    </div>
  )
}

function FaceHitTarget({
  label,
  onTap,
}: {
  label: SharedLabel
  onTap: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label.display_name ?? undefined}
      style={{
        position: 'absolute',
        left: `calc(${label.bbox_x * 100}% - ${HIT_PAD}px)`,
        top: `calc(${label.bbox_y * 100}% - ${HIT_PAD}px)`,
        width: `calc(${label.bbox_w * 100}% + ${HIT_PAD * 2}px)`,
        height: `calc(${label.bbox_h * 100}% + ${HIT_PAD * 2}px)`,
        cursor: 'pointer',
      }}
      onClick={(e) => {
        e.stopPropagation()
        onTap()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onTap()
        }
      }}
    />
  )
}

export default function Viewer() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<SharedImage | null>(null)
  const [error, setError] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  function handleToggleShowAll() {
    setShowAll((v) => !v)
    setActiveId(null)
  }

  useEffect(() => {
    if (!token) return
    fetch(`/api/share/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
  }, [token])

  if (error) {
    return (
      <main style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-base)' }}>
          Photo not found or link has expired.
        </p>
      </main>
    )
  }

  if (!data) {
    return (
      <main style={{ padding: 'var(--space-6)', textAlign: 'center' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-base)' }}>
          Loading…
        </p>
      </main>
    )
  }

  const namedLabels = data.labels.filter(
    (l): l is SharedLabel & { display_name: string } => l.display_name !== null
  )
  const activeLabel = namedLabels.find((l) => l.detection_id === activeId)

  return (
    <main
      style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#000',
        minHeight: '100dvh',
      }}
    >
      <div
        style={{
          position: 'relative',
          userSelect: 'none',
          touchAction: 'manipulation',
        }}
        onClick={() => !showAll && setActiveId(null)}
      >
        <img
          src={data.thumbnail_url}
          alt=""
          draggable={false}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        {showAll ? (
          <ShowAllOverlay labels={namedLabels} />
        ) : (
          <>
            {namedLabels.map((label) => (
              <FaceHitTarget
                key={label.detection_id}
                label={label}
                onTap={() =>
                  setActiveId(activeId === label.detection_id ? null : label.detection_id)
                }
              />
            ))}
            {activeLabel && <NameLabel label={activeLabel} />}
          </>
        )}
      </div>

      {namedLabels.length > 0 && (
        <div style={{ padding: 'var(--space-5) 0', textAlign: 'center' }}>
          <button
            onClick={handleToggleShowAll}
            style={{
              backgroundColor: 'var(--color-overlay-label)',
              color: '#fff',
              fontSize: 'var(--text-base)',
              padding: `var(--space-2) var(--space-5)`,
              borderRadius: '9999px',
              border: 'none',
              cursor: 'pointer',
              minWidth: '88px',
            }}
          >
            {showAll ? 'Hide names' : 'Show all names'}
          </button>
        </div>
      )}
    </main>
  )
}
