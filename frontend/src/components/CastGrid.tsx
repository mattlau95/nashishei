import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'

const CROP_SIZE = 72

type CastLabel = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  display_name: string
}

type Props = {
  labels: CastLabel[]
  totalFaces?: number
  crops: Record<string, string>
  highlightedId: string | null
  onHighlight: (id: string | null) => void
  token?: string
  onRename?: (detectionId: string, newName: string) => void
}

function sortLabels(labels: CastLabel[]): CastLabel[] {
  return [...labels].sort((a, b) => a.bbox_y - b.bbox_y || a.bbox_x - b.bbox_x)
}

export default function CastGrid({ labels, totalFaces, crops, highlightedId, onHighlight, token, onRename }: Props) {
  const sorted = sortLabels(labels)
  const total = totalFaces ?? labels.length
  const headerText = total > labels.length
    ? `${labels.length} of ${total} named — tap a name to find them in the photo`
    : `${labels.length} named — tap a name to find them in the photo`

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId) editInputRef.current?.focus()
  }, [editingId])

  function startEdit(label: CastLabel) {
    setEditingId(label.detection_id)
    setEditValue(label.display_name)
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function saveEdit() {
    if (!token || !editingId || !onRename) return
    const name = editValue.trim()
    if (!name) return
    setSaving(true)
    setEditError(null)
    try {
      const res = await api(`/api/share/${token}/name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ detection_id: editingId, display_name: name }),
      })
      if (!res.ok) throw new Error('rename failed')
      onRename(editingId, name)
      setEditingId(null)
    } catch {
      setEditError('Could not save — try again')
    } finally {
      setSaving(false)
    }
  }

  const canEdit = Boolean(token && onRename)

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: '#111',
      }}
    >
      <p
        style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: 'var(--text-sm)',
          margin: '0 0 var(--space-3)',
          textAlign: 'center',
        }}
      >
        {headerText}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {sorted.map((label) => {
          const isHighlighted = label.detection_id === highlightedId
          const isEditing = label.detection_id === editingId

          const rowBase: React.CSSProperties = {
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-2)',
            minHeight: 'var(--tap-target)',
            background: isHighlighted
              ? 'var(--color-accent-tint)'
              : 'rgba(255,255,255,0.04)',
            border: '1px solid',
            borderColor: isHighlighted
              ? 'var(--color-accent-tint-border)'
              : 'rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius-md)',
            width: '100%',
            boxSizing: 'border-box',
          }

          const cropThumb = (
            <div
              style={{
                width: CROP_SIZE,
                height: CROP_SIZE,
                flexShrink: 0,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
              }}
            >
              {crops[label.detection_id] && (
                <img
                  src={crops[label.detection_id]}
                  alt=""
                  width={CROP_SIZE}
                  height={CROP_SIZE}
                  style={{ display: 'block', objectFit: 'cover' }}
                />
              )}
            </div>
          )

          if (isEditing) {
            return (
              <div key={label.detection_id} style={rowBase}>
                {cropThumb}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit()
                      if (e.key === 'Escape') cancelEdit()
                    }}
                    disabled={saving}
                    style={{
                      background: 'rgba(255,255,255,0.10)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.25)',
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-1) var(--space-2)',
                      fontSize: 'var(--text-base)',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                  />
                  {editError && (
                    <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{editError}</p>
                  )}
                </div>
                <button
                  onClick={() => void saveEdit()}
                  disabled={saving || !editValue.trim()}
                  aria-label="Save name"
                  style={{
                    flexShrink: 0, width: 36, height: 36, padding: 0,
                    background: 'rgba(0,122,255,0.85)', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: saving ? 'not-allowed' : 'pointer',
                    color: '#fff', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ✓
                </button>
                <button
                  onClick={cancelEdit}
                  aria-label="Cancel edit"
                  style={{
                    flexShrink: 0, width: 36, height: 36, padding: 0,
                    background: 'rgba(255,255,255,0.08)', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.7)', fontSize: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>
            )
          }

          return (
            <div
              key={label.detection_id}
              style={{ ...rowBase, cursor: 'pointer' }}
              role="button"
              tabIndex={0}
              onClick={() => onHighlight(isHighlighted ? null : label.detection_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onHighlight(isHighlighted ? null : label.detection_id)
                }
              }}
            >
              {cropThumb}

              <span
                style={{
                  flex: 1,
                  fontSize: 'var(--text-base)',
                  fontWeight: 600,
                  color: '#fff',
                  lineHeight: 1.3,
                  wordBreak: 'break-word',
                  minWidth: 0,
                }}
              >
                {label.display_name}
              </span>

              {canEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); startEdit(label) }}
                  aria-label={`Edit name for ${label.display_name}`}
                  style={{
                    flexShrink: 0, width: 36, height: 36, padding: 0,
                    background: 'transparent', border: 'none',
                    borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.4)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M11.5 2.5a1.414 1.414 0 012 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
