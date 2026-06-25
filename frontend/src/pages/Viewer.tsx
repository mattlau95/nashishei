import { useEffect, useRef, useState } from 'react'
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
const ABOVE_THRESHOLD = 0.25

function NameLabel({ label }: { label: SharedLabel & { display_name: string } }) {
  const above = label.bbox_y >= ABOVE_THRESHOLD
  const centerX = (label.bbox_x + label.bbox_w / 2) * 100

  return (
    <div
      style={{
        position: 'absolute',
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

function NamePopover({
  label,
  token,
  onSaved,
  onClose,
}: {
  label: SharedLabel
  token: string
  onSaved: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const above = label.bbox_y >= ABOVE_THRESHOLD
  const centerX = (label.bbox_x + label.bbox_w / 2) * 100

  useEffect(() => { inputRef.current?.focus() }, [])

  async function handleSave() {
    const name = value.trim()
    if (!name) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/share/${token}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detection_id: label.detection_id, display_name: name }),
      })
      if (res.status === 409) {
        // Someone else named it first — re-fetch will show the name
        const data = await res.json().catch(() => ({}))
        onSaved(data.display_name ?? name)
        return
      }
      if (!res.ok) throw new Error('save failed')
      onSaved(name)
    } catch {
      setErr('Could not save — try again')
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: `clamp(8px, calc(${centerX}% - 100px), calc(100% - 208px))`,
        ...(above
          ? { bottom: `calc(${(1 - label.bbox_y) * 100}% + 6px)` }
          : { top: `calc(${(label.bbox_y + label.bbox_h) * 100}% + 6px)` }),
        width: 200,
        backgroundColor: 'var(--color-overlay-label)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Enter name…"
        style={{
          width: '100%',
          padding: '4px 8px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          fontSize: 'var(--text-sm)',
          boxSizing: 'border-box',
        }}
        disabled={saving}
      />
      {err && (
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{err}</p>
      )}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          style={{
            flex: 1,
            padding: '4px',
            background: 'var(--color-accent)',
            color: 'var(--color-text)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: saving || !value.trim() ? 'not-allowed' : 'pointer',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
          }}
        >
          {saving ? '…' : 'Save'}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          ✕
        </button>
      </div>
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
  const named = label.display_name !== null
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label.display_name ?? 'Unknown — tap to name'}
      style={{
        position: 'absolute',
        left: `calc(${label.bbox_x * 100}% - ${HIT_PAD}px)`,
        top: `calc(${label.bbox_y * 100}% - ${HIT_PAD}px)`,
        width: `calc(${label.bbox_w * 100}% + ${HIT_PAD * 2}px)`,
        height: `calc(${label.bbox_h * 100}% + ${HIT_PAD * 2}px)`,
        cursor: 'pointer',
        // Unnamed faces get a faint dashed outline so they're discoverable
        outline: named ? 'none' : '1.5px dashed rgba(255,255,255,0.45)',
        outlineOffset: `-${HIT_PAD}px`,
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
  const [namingId, setNamingId] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  function handleToggleShowAll() {
    setShowAll((v) => !v)
    setActiveId(null)
    setNamingId(null)
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
  const namingLabel = namingId ? data.labels.find((l) => l.detection_id === namingId) : null

  function handleFaceTap(label: SharedLabel) {
    if (label.display_name !== null) {
      // Named face — toggle label display
      setNamingId(null)
      setActiveId(activeId === label.detection_id ? null : label.detection_id)
    } else {
      // Unnamed face — open name input
      setActiveId(null)
      setNamingId(namingId === label.detection_id ? null : label.detection_id)
    }
  }

  function handleNamed(detectionId: string, name: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        labels: prev.labels.map((l) =>
          l.detection_id === detectionId ? { ...l, display_name: name } : l
        ),
      }
    })
    setNamingId(null)
    setActiveId(detectionId)
  }

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
        onClick={() => {
          if (!showAll) {
            setActiveId(null)
            setNamingId(null)
          }
        }}
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
            {data.labels.map((label) => (
              <FaceHitTarget
                key={label.detection_id}
                label={label}
                onTap={() => handleFaceTap(label)}
              />
            ))}
            {activeLabel && <NameLabel label={activeLabel} />}
            {namingLabel && token && (
              <NamePopover
                label={namingLabel}
                token={token}
                onSaved={(name) => handleNamed(namingLabel.detection_id, name)}
                onClose={() => setNamingId(null)}
              />
            )}
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
