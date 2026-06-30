import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { FriendlyError, toUserMessage } from '../lib/errorMessages'
import type { Detection, Suggestion } from '../types/detection'

type Props = {
  file: File
  imgSrc: string
  detections: Detection[]
  imageId?: string
  suggestions?: Suggestion[]
  onDone?: () => void
}

type SavedDetection = { id: string; bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number; source: string }

const CROP_SIZE = 96

function sortedDetections(dets: Detection[], suggestionMap: Record<string, Suggestion>): Detection[] {
  return [...dets].sort((a, b) => {
    const aKnown = suggestionMap[a.id]?.display_name ? 1 : 0
    const bKnown = suggestionMap[b.id]?.display_name ? 1 : 0
    return aKnown - bKnown || a.bbox_y - b.bbox_y || a.bbox_x - b.bbox_x
  })
}

export default function FaceNameList({ file, imgSrc, detections, imageId, suggestions = [], onDone }: Props) {
  const suggestionMap = Object.fromEntries(suggestions.map((s) => [s.detection_id, s]))
  const sorted = sortedDetections(detections, suggestionMap)
  const [crops, setCrops] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(detections.map((d) => [d.id, suggestionMap[d.id]?.display_name ?? ''])),
  )
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkInput, setBulkInput] = useState('')
  const [done, setDone] = useState(false)
  const [savedImageId, setSavedImageId] = useState<string | null>(imageId ?? null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      const result: Record<string, string> = {}
      for (const det of detections) {
        const c = document.createElement('canvas')
        c.width = CROP_SIZE
        c.height = CROP_SIZE
        const ctx = c.getContext('2d')
        if (!ctx) continue
        ctx.drawImage(
          img,
          det.bbox_x * img.naturalWidth,
          det.bbox_y * img.naturalHeight,
          det.bbox_w * img.naturalWidth,
          det.bbox_h * img.naturalHeight,
          0, 0, CROP_SIZE, CROP_SIZE,
        )
        result[det.id] = c.toDataURL('image/jpeg', 0.85)
      }
      setCrops(result)
    }
    img.src = imgSrc
  }, [imgSrc, detections])

  const namedCount = Object.values(names).filter((n) => n.trim() !== '').length

  function parseBulkNames(input: string): string[] {
    return input
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function applyBulkNames() {
    const parsed = parseBulkNames(bulkInput)
    setNames((prev) => {
      const next = { ...prev }
      sorted.forEach((det, i) => {
        if (i < parsed.length) next[det.id] = parsed[i]
      })
      return next
    })
    setBulkOpen(false)
    setBulkInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, idx: number) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const next = inputRefs.current[idx + 1]
      if (next) next.focus()
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      let resolvedImageId: string
      let savedDets: SavedDetection[]

      if (imageId) {
        resolvedImageId = imageId
        savedDets = sorted.map((d) => ({
          id: d.id,
          bbox_x: d.bbox_x,
          bbox_y: d.bbox_y,
          bbox_w: d.bbox_w,
          bbox_h: d.bbox_h,
          source: d.source,
        }))
      } else {
        const formData = new FormData()
        formData.append('image', file)
        const imgRes = await api('/api/images', { method: 'POST', body: formData, credentials: 'include' })
        if (imgRes.status === 401) throw new FriendlyError('Not logged in — please sign in to save.')
        if (!imgRes.ok) throw new FriendlyError("Couldn't upload your photo — try again.")
        const imgData = (await imgRes.json()) as { id: string }
        resolvedImageId = imgData.id

        const batchRes = await api('/api/detections/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            image_id: resolvedImageId,
            detections: sorted.map((d) => ({
              bbox_x: d.bbox_x,
              bbox_y: d.bbox_y,
              bbox_w: d.bbox_w,
              bbox_h: d.bbox_h,
              source: d.source,
            })),
          }),
        })
        if (!batchRes.ok) throw new FriendlyError("Couldn't save the detected faces — try again.")
        const batchData = (await batchRes.json()) as { detections: SavedDetection[] }
        savedDets = batchData.detections
      }

      for (let i = 0; i < sorted.length; i++) {
        const name = names[sorted[i].id]?.trim()
        if (!name) continue
        const detId = savedDets[i]?.id
        if (!detId) continue

        const personRes = await api('/api/persons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ display_name: name }),
        })
        if (!personRes.ok) throw new FriendlyError(`Couldn't save the name "${name}" — try again.`)
        const personData = (await personRes.json()) as { id: string }

        const tagRes = await api('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ detection_id: detId, person_id: personData.id, status: 'confirmed' }),
        })
        if (!tagRes.ok) throw new FriendlyError(`Couldn't save the name "${name}" — try again.`)
      }

      setSavedImageId(resolvedImageId)
      setDone(true)
      void handleShare(resolvedImageId)
    } catch (err) {
      setError(toUserMessage(err, 'Could not save — try again.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleShare(id?: string) {
    const imageId = id ?? savedImageId
    if (!imageId) return
    setSharing(true)
    try {
      const res = await api(`/api/images/${imageId}/share`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error()
      const data = (await res.json()) as { share_url: string }
      setShareUrl(data.share_url)
    } catch {
      setError('Could not generate share link.')
    } finally {
      setSharing(false)
    }
  }

  async function handleCopy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const primaryBtn: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-5)',
    background: 'var(--color-blue)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    fontSize: 'var(--text-base)',
    fontWeight: 600,
    minHeight: 'var(--tap-target)',
  }

  const disabledBtn: React.CSSProperties = {
    ...primaryBtn,
    background: 'rgba(120,120,128,0.20)',
    color: 'rgba(60,60,67,0.40)',
    cursor: 'not-allowed',
  }

  if (done) {
    return (
      <div style={{ padding: 'var(--space-6) 0', textAlign: 'center' }}>
        <img
          src={imgSrc}
          alt=""
          style={{
            width: 120,
            height: 120,
            objectFit: 'cover',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}
        />
        <p style={{ fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Saved!</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>
          {namedCount} of {sorted.length} faces named.
        </p>

        {sharing ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Generating link…</p>
        ) : shareUrl ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Anyone with this link can tap faces to see names.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%', maxWidth: 360 }}>
              <input
                readOnly
                value={shareUrl}
                style={{ flex: 1, minWidth: 0, padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-sm)' }}
              />
              <button
                onClick={() => void handleCopy()}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: copied ? 'rgba(0,122,255,0.12)' : 'var(--color-fill)',
                  color: 'var(--color-blue)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  flexShrink: 0,
                  transition: 'background 0.15s',
                  minHeight: 'var(--tap-target)',
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>
        ) : null}

        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
          <button
            onClick={onDone}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--space-3) var(--space-5)',
              background: 'var(--color-fill)',
              color: 'var(--color-blue)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              minHeight: 'var(--tap-target)',
              border: 'none',
              cursor: 'pointer',
              width: '100%',
              maxWidth: 360,
            }}
          >
            View in your gallery
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: '120px' }}>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', lineHeight: 1.5 }}>
        Type each person's full name. Tab or Enter moves to the next face.
        Unnamed faces will be saved without a label.
      </p>

      {/* Progress counter + bulk entry toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: 0 }}>
          {namedCount} of {sorted.length} named
        </p>
        <button
          disabled
          style={{
            padding: '4px 12px',
            background: 'transparent',
            color: 'var(--color-text-muted)',
            border: 'none',
            borderRadius: 'var(--radius-pill)',
            cursor: 'not-allowed',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            opacity: 0.35,
            pointerEvents: 'none',
          }}
        >
          Paste names
        </button>
      </div>

      {/* Bulk name entry */}
      {bulkOpen && (
        <div style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea
            autoFocus
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setBulkOpen(false); setBulkInput('') } }}
            placeholder="Alice, Bob, 张三, 李四, …"
            rows={3}
            style={{ resize: 'vertical' }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={applyBulkNames}
              disabled={!bulkInput.trim()}
              style={bulkInput.trim() ? { ...primaryBtn, padding: 'var(--space-2) var(--space-4)' } : { ...disabledBtn, padding: 'var(--space-2) var(--space-4)' }}
            >
              Apply
            </button>
            <button
              onClick={() => { setBulkOpen(false); setBulkInput('') }}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                border: 'none',
                borderRadius: 'var(--radius-pill)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Face list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-5)' }}>
        {sorted.map((det, idx) => {
          const named = names[det.id]?.trim() !== ''
          return (
            <div
              key={det.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: named ? 'var(--color-accent-tint)' : '#fff',
                boxShadow: named
                  ? `0 0 0 1.5px var(--color-accent-tint-border), 0 1px 4px rgba(0,0,0,0.05)`
                  : '0 1px 4px rgba(0,0,0,0.06)',
              }}
            >
              {/* Crop thumbnail */}
              <div
                style={{
                  width: CROP_SIZE,
                  height: CROP_SIZE,
                  flexShrink: 0,
                  background: 'var(--color-surface)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                {crops[det.id] && (
                  <img
                    src={crops[det.id]}
                    alt=""
                    width={CROP_SIZE}
                    height={CROP_SIZE}
                    style={{ display: 'block', objectFit: 'cover' }}
                  />
                )}
              </div>

              {/* Name input + suggestion chip */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <input
                  ref={(el) => { inputRefs.current[idx] = el }}
                  type="text"
                  placeholder="Name"
                  value={names[det.id] ?? ''}
                  onChange={(e) => setNames((prev) => ({ ...prev, [det.id]: e.target.value }))}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                />
                {(() => {
                  const suggestion = suggestionMap[det.id]
                  if (!suggestion || dismissed.has(det.id) || names[det.id]?.trim()) return null
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        Suggested:
                      </span>
                      <button
                        onClick={() => setNames((prev) => ({ ...prev, [det.id]: suggestion.display_name }))}
                        style={{
                          padding: '2px 10px',
                          background: 'rgba(0,122,255,0.10)',
                          color: 'var(--color-blue)',
                          border: 'none',
                          borderRadius: 'var(--radius-pill)',
                          cursor: 'pointer',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 600,
                        }}
                      >
                        ✓ {suggestion.display_name}
                      </button>
                      <button
                        onClick={() => setDismissed((prev) => new Set([...prev, det.id]))}
                        style={{
                          padding: '2px 8px',
                          background: 'transparent',
                          color: 'var(--color-text-muted)',
                          border: 'none',
                          borderRadius: 'var(--radius-pill)',
                          cursor: 'pointer',
                          fontSize: 'var(--text-sm)',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  )
                })()}
              </div>
            </div>
          )
        })}
      </div>

      {/* Sticky footer — named counter + save */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--color-bg)',
        borderTop: '1px solid var(--color-separator)',
        padding: 'var(--space-3) 0 var(--space-4)',
        marginTop: 'var(--space-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>
            {namedCount} of {sorted.length} named
          </span>
          {namedCount === sorted.length && sorted.length > 0 && (
            <span style={{ color: 'var(--color-blue)', fontWeight: 700 }}>✓</span>
          )}
        </div>
        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', margin: `0 0 var(--space-2)` }}>{error}</p>
        )}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          style={{ ...(saving ? disabledBtn : primaryBtn), width: '100%' }}
        >
          {saving ? 'Saving…' : 'Save names'}
        </button>
      </div>
    </div>
  )
}
