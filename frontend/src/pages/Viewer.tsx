import { useEffect, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ShowAllOverlay from '../components/ShowAllOverlay'
import CastGrid from '../components/CastGrid'
import SpotlightPlayer, { SpotlightOverlay } from '../components/SpotlightPlayer'
import { useFaceCrops } from '../hooks/useFaceCrops'
import { api } from '../lib/api'

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
const SHOW_ALL_MAX = 12
const PULSE_DURATION_MS = 700

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
      const res = await api(`/api/share/${token}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detection_id: label.detection_id, display_name: name }),
      })
      if (res.status === 409) {
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
        aria-label="Name for this person"
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
          aria-label="Close"
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

function PulseBox({ label }: { label: SharedLabel }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${label.bbox_x * 100}% - 6px)`,
        top: `calc(${label.bbox_y * 100}% - 6px)`,
        width: `calc(${label.bbox_w * 100}% + 12px)`,
        height: `calc(${label.bbox_h * 100}% + 12px)`,
        border: '3px solid var(--color-blue)',
        borderRadius: 'var(--radius-sm)',
        pointerEvents: 'none',
        zIndex: 12,
        animation: `pulseRing ${PULSE_DURATION_MS}ms ease-in-out`,
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
  const [showGrid, setShowGrid] = useState(false)
  const [spotlightOpen, setSpotlightOpen] = useState(false)
  const [spotlightLabel, setSpotlightLabel] = useState<SharedLabel | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pulseKey, setPulseKey] = useState(0)
  const [linkCopied, setLinkCopied] = useState(false)
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const crops = useFaceCrops(data?.thumbnail_url ?? null, data?.labels ?? [])

  function handleToggleShowAll() {
    setShowAll((v) => !v)
    setShowGrid(false)
    setActiveId(null)
    setNamingId(null)
  }

  function handleGridSelect(id: string | null) {
    setSelectedId(id)
    if (id) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = setTimeout(() => setPulseKey((k) => k + 1), 400)
    }
  }

  useEffect(() => {
    if (!token) return
    api(`/api/share/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true))
  }, [token])

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    }
  }, [])

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
  const selectedLabel = selectedId ? data.labels.find((l) => l.detection_id === selectedId) : null
  const canShowAll = namedLabels.length <= SHOW_ALL_MAX

  function handleFaceTap(label: SharedLabel) {
    if (label.display_name !== null) {
      setNamingId(null)
      setActiveId(activeId === label.detection_id ? null : label.detection_id)
    } else {
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

  const pillStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-overlay-label)',
    color: '#fff',
    fontSize: 'var(--text-base)',
    padding: `var(--space-2) var(--space-5)`,
    borderRadius: '9999px',
    border: 'none',
    cursor: 'pointer',
    minWidth: '88px',
    minHeight: 'var(--tap-target)',
  }

  return (
    <main
      style={{
        margin: 0,
        padding: 0,
        backgroundColor: '#000',
        minHeight: '100dvh',
        paddingBottom: spotlightOpen ? 330 : 0,
      }}
    >
      {/* Sticky block: photo + action bar pin to top while names list scrolls below */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>

      {/* Photo + overlays */}
      <div
        style={{
          position: 'relative',
          userSelect: 'none',
          touchAction: 'manipulation',
        }}
        onClick={() => {
          if (!showAll && !spotlightOpen) {
            setActiveId(null)
            setNamingId(null)
          }
        }}
      >
        <img
          src={data.thumbnail_url}
          alt=""
          draggable={false}
          crossOrigin="anonymous"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />

        <Link
          to="/"
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 20,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 14px',
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: '#fff',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          ← Home
        </Link>

        {/* Show-all overlay (count-gated) */}
        {showAll && canShowAll && <ShowAllOverlay labels={namedLabels} />}

        {/* Spotlight scrim + ring — dims photo outside the active face */}
        {spotlightOpen && spotlightLabel && <SpotlightOverlay label={spotlightLabel} />}

        {/* Slideshow — coverflow carousel sheet */}
        {spotlightOpen && (
          <SpotlightPlayer
            labels={namedLabels}
            crops={crops}
            highlightedId={selectedId}
            onHighlight={handleGridSelect}
            onActiveChange={setSpotlightLabel}
            onClose={() => { setSpotlightOpen(false); setSpotlightLabel(null) }}
          />
        )}

        {/* Tap-to-reveal targets (hidden during show-all and spotlight) */}
        {!showAll && !spotlightOpen && (
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

        {/* Pulse ring when a grid row is tapped — key remounts to restart animation */}
        {selectedLabel && !spotlightOpen && <PulseBox key={pulseKey} label={selectedLabel} />}
      </div>

      {/* Action bar */}
      {namedLabels.length > 0 && (
        <div
          style={{
            padding: 'var(--space-5) var(--space-4)',
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'center',
            flexWrap: 'wrap',
            backgroundColor: '#000',
          }}
        >
          {/* Show all labels — ≤12 faces only */}
          {canShowAll && (
            <button onClick={handleToggleShowAll} style={pillStyle}>
              {showAll ? 'Hide labels' : 'Show all labels'}
            </button>
          )}

          {/* Browse/Edit Names — both modes */}
          <button
            onClick={() => { setShowAll(false); setShowGrid((v) => !v) }}
            style={{
              ...pillStyle,
              backgroundColor: showGrid ? 'rgba(255,255,255,0.15)' : 'var(--color-overlay-label)',
            }}
          >
            {showGrid ? 'Hide names' : 'Browse/Edit Names'}
          </button>

          {/* Slideshow — always available when names exist */}
          <button
            onClick={() => {
              setShowAll(false)
              setSpotlightOpen(true)
            }}
            style={pillStyle}
          >
            Slideshow
          </button>

          {/* Copy link */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setLinkCopied(true)
                setTimeout(() => setLinkCopied(false), 2000)
              })
            }}
            style={pillStyle}
          >
            {linkCopied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      )}

      {/* Cast grid header — stays visible with the image */}
      {showGrid && (
        <p style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: 'var(--text-sm)',
          margin: 0,
          padding: 'var(--space-2) var(--space-4)',
          textAlign: 'center',
          backgroundColor: '#111',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          {data.labels.length > namedLabels.length
            ? `${namedLabels.length} of ${data.labels.length} named — tap a name to find them in the photo`
            : `${namedLabels.length} named — tap a name to find them in the photo`}
        </p>
      )}

      </div>{/* end sticky block */}

      {/* Cast grid — normal page scroll below the sticky image + action bar */}
      {showGrid && (
        <CastGrid
          labels={namedLabels}
          crops={crops}
          highlightedId={selectedId}
          onHighlight={handleGridSelect}
          token={token}
          onRename={handleNamed}
        />
      )}
    </main>
  )
}
