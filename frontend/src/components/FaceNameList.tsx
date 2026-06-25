import { useEffect, useRef, useState } from 'react'
import type { Detection } from '../types/detection'

type Props = {
  file: File
  imgSrc: string
  detections: Detection[]
}

type SavedDetection = { id: string; bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number; source: string }

const CROP_SIZE = 96

function sortedDetections(dets: Detection[]): Detection[] {
  return [...dets].sort((a, b) => a.bbox_y - b.bbox_y || a.bbox_x - b.bbox_x)
}

export default function FaceNameList({ file, imgSrc, detections }: Props) {
  const sorted = sortedDetections(detections)
  const [crops, setCrops] = useState<Record<string, string>>({})
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(detections.map((d) => [d.id, ''])),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkInput, setBulkInput] = useState('')
  const [done, setDone] = useState(false)
  const [savedImageId, setSavedImageId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Extract face crops from the image using canvas
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
      // 1. Upload image
      const formData = new FormData()
      formData.append('image', file)
      const imgRes = await fetch('/api/images', { method: 'POST', body: formData, credentials: 'include' })
      if (imgRes.status === 401) throw new Error('Not logged in — please sign in to save.')
      if (!imgRes.ok) throw new Error(`Image upload failed (${imgRes.status})`)
      const imgData = (await imgRes.json()) as { id: string }
      const imageId = imgData.id

      // 2. Save all detections in one batch
      const batchRes = await fetch('/api/detections/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          image_id: imageId,
          detections: sorted.map((d) => ({
            bbox_x: d.bbox_x,
            bbox_y: d.bbox_y,
            bbox_w: d.bbox_w,
            bbox_h: d.bbox_h,
            source: d.source,
          })),
        }),
      })
      if (!batchRes.ok) throw new Error(`Failed to save detections (${batchRes.status})`)
      const batchData = (await batchRes.json()) as { detections: SavedDetection[] }
      const savedDets = batchData.detections

      // 3. For each named face: create person + tag
      for (let i = 0; i < sorted.length; i++) {
        const name = names[sorted[i].id]?.trim()
        if (!name) continue
        const detId = savedDets[i]?.id
        if (!detId) continue

        const personRes = await fetch('/api/persons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ display_name: name }),
        })
        if (!personRes.ok) throw new Error(`Failed to create person "${name}" (${personRes.status})`)
        const personData = (await personRes.json()) as { id: string }

        const tagRes = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ detection_id: detId, person_id: personData.id, status: 'confirmed' }),
        })
        if (!tagRes.ok) throw new Error(`Failed to tag "${name}" (${tagRes.status})`)
      }

      setSavedImageId(imageId)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  async function handleShare() {
    if (!savedImageId) return
    setSharing(true)
    try {
      const res = await fetch(`/api/images/${savedImageId}/share`, {
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

  if (done) {
    return (
      <div style={{ padding: 'var(--space-6) 0', textAlign: 'center' }}>
        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>Saved!</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-5)' }}>
          {namedCount} of {sorted.length} faces named.
        </p>

        {!shareUrl ? (
          <button
            onClick={() => void handleShare()}
            disabled={sharing}
            style={{
              padding: 'var(--space-2) var(--space-5)',
              background: sharing ? '#aaa' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: '9999px',
              cursor: sharing ? 'not-allowed' : 'pointer',
              fontSize: 'var(--text-base)',
              fontWeight: 600,
            }}
          >
            {sharing ? 'Generating link…' : 'Share photo'}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Anyone with this link can tap faces to see names.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%', maxWidth: 360 }}>
              <input
                readOnly
                value={shareUrl}
                style={{
                  flex: 1,
                  padding: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  border: '1px solid #ccc',
                  borderRadius: 'var(--radius-sm)',
                  minWidth: 0,
                  background: 'var(--color-surface)',
                }}
              />
              <button
                onClick={() => void handleCopy()}
                style={{
                  padding: 'var(--space-2) var(--space-3)',
                  background: copied ? '#4caf50' : '#333',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  flexShrink: 0,
                  transition: 'background 0.15s',
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>{error}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Bulk-entry hint */}
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', lineHeight: 1.5 }}>
        Type each person's full name. Tab or Enter moves to the next face.
        Unnamed faces will be saved without a label.
      </p>

      {/* Progress counter + bulk entry toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: 0 }}>
          {namedCount} of {sorted.length} named
        </p>
        <button
          onClick={() => { setBulkOpen((v) => !v); setBulkInput('') }}
          style={{
            padding: '2px 10px',
            background: bulkOpen ? 'var(--color-text-muted)' : 'transparent',
            color: bulkOpen ? '#fff' : 'var(--color-text-muted)',
            border: '1px solid',
            borderColor: bulkOpen ? 'transparent' : 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
          }}
        >
          Paste names
        </button>
      </div>

      {/* Bulk name entry */}
      {bulkOpen && (
        <div style={{ marginBottom: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea
            autoFocus
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setBulkOpen(false); setBulkInput('') } }}
            placeholder="Alice, Bob, 张三, 李四, …"
            rows={3}
            style={{
              width: '100%',
              padding: 'var(--space-2)',
              fontSize: 'var(--text-base)',
              border: '1px solid #ccc',
              borderRadius: 'var(--radius-sm)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={applyBulkNames}
              disabled={!bulkInput.trim()}
              style={{
                padding: '4px 16px',
                background: bulkInput.trim() ? '#333' : '#ccc',
                color: '#fff',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: bulkInput.trim() ? 'pointer' : 'not-allowed',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
              }}
            >
              Apply
            </button>
            <button
              onClick={() => { setBulkOpen(false); setBulkInput('') }}
              style={{
                padding: '4px 12px',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                border: '1px solid #ccc',
                borderRadius: 'var(--radius-sm)',
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {sorted.map((det, idx) => {
          const named = names[det.id]?.trim() !== ''
          return (
            <div
              key={det.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-1) var(--space-2)',
                borderRadius: 'var(--radius-md)',
                background: named ? 'var(--color-accent-tint)' : 'transparent',
                border: '1px solid',
                borderColor: named ? 'var(--color-accent-tint-border)' : '#e0e0e0',
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

              {/* Name input — focus ring handled by index.css input:focus-visible rule */}
              <input
                ref={(el) => { inputRefs.current[idx] = el }}
                type="text"
                placeholder="Name"
                value={names[det.id] ?? ''}
                onChange={(e) => setNames((prev) => ({ ...prev, [det.id]: e.target.value }))}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                style={{
                  flex: 1,
                  padding: 'var(--space-2) var(--space-2)',
                  fontSize: 'var(--text-base)',
                  border: '1px solid #ccc',
                  borderRadius: 'var(--radius-sm)',
                  minWidth: 0,
                }}
              />
            </div>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-3)' }}>{error}</p>
      )}

      {/* Save button */}
      <button
        onClick={() => void handleSave()}
        disabled={saving}
        style={{
          padding: 'var(--space-2) var(--space-5)',
          background: saving ? '#aaa' : '#333',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: saving ? 'not-allowed' : 'pointer',
          fontWeight: 600,
          fontSize: 'var(--text-base)',
        }}
      >
        {saving ? 'Saving…' : 'Save names'}
      </button>
    </div>
  )
}
