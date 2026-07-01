import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Link } from 'react-router-dom'
import ImageDetector from '../components/ImageDetector'
import FaceNameList from '../components/FaceNameList'
import { MLProvider, useML } from '../contexts/MLContext'
import type { Detection, Suggestion } from '../types/detection'

type Step = 'pick' | 'qc' | 'name'
type GalleryImage = { id: string; title: string | null; thumbnail_url: string; share_token: string | null }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const HEIC_TYPES = ['image/heic', 'image/heif']
const MAX_SIZE_MB = 50

// Many browsers (Chrome/Firefox on desktop, most non-Apple pickers) report an empty or
// generic MIME type for HEIC files — the extension is the only reliable signal there.
function isHeic(f: File): boolean {
  return HEIC_TYPES.includes(f.type) || /\.hei[cf]$/i.test(f.name)
}

// MLProvider lives here (not in App.tsx) so its onnxruntime-web import chain is only
// fetched once this module is dynamically loaded — never on the login/viewer routes.
export default function Home(props: { onLogout: () => void }) {
  return (
    <MLProvider>
      <HomeContent {...props} />
    </MLProvider>
  )
}

function HomeContent({ onLogout }: { onLogout: () => void }) {
  const { mlState, loadProgress, mlError } = useML()
  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [confirmedDetections, setConfirmedDetections] = useState<Detection[]>([])
  const [confirmedImageId, setConfirmedImageId] = useState<string | null>(null)
  const [confirmedSuggestions, setConfirmedSuggestions] = useState<Suggestion[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const [gallery, setGallery] = useState<GalleryImage[]>([])
  const [galleryLoaded, setGalleryLoaded] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [galleryError, setGalleryError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => {
    if (step !== 'pick') return
    const url = debouncedQuery ? `/api/images?q=${encodeURIComponent(debouncedQuery)}` : '/api/images'
    api(url, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then((items: GalleryImage[]) => { setGallery(items); setGalleryLoaded(true) })
      .catch(() => setGalleryLoaded(true))
  }, [step, debouncedQuery])

  async function handleTitleSave(id: string) {
    const next = titleDraft.trim()
    setEditingTitleId(null)
    const current = gallery.find((img) => img.id === id)?.title ?? null
    if (next === (current ?? '')) return
    setGallery((g) => g.map((img) => (img.id === id ? { ...img, title: next || null } : img)))
    try {
      const res = await api(`/api/images/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: next || null }),
      })
      if (!res.ok) throw new Error('failed')
    } catch {
      setGallery((g) => g.map((img) => (img.id === id ? { ...img, title: current } : img)))
      setGalleryError('Could not save title — please try again.')
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setGalleryError(null)
    setDeletingId(id)
    try {
      const res = await api(`/api/images/${id}`, { method: 'DELETE', credentials: 'include' })
      if (res.ok || res.status === 404) {
        setGallery((g) => g.filter((img) => img.id !== id))
      } else {
        setGalleryError('Could not delete photo — please try again.')
      }
    } catch {
      setGalleryError('Could not delete photo — please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0]
    if (!picked) return
    if (picked.size > MAX_SIZE_MB * 1024 * 1024) {
      setPickError(`File is too large — maximum is ${MAX_SIZE_MB} MB.`)
      return
    }

    let f = picked
    if (isHeic(picked)) {
      setPickError(null)
      setConverting(true)
      try {
        const { default: heic2any } = await import('heic2any')
        const result = await heic2any({ blob: picked, toType: 'image/jpeg', quality: 0.9 })
        const jpegBlob = Array.isArray(result) ? result[0] : result
        f = new File([jpegBlob], picked.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' })
      } catch {
        setConverting(false)
        setPickError("Couldn't convert this HEIC photo — try again, or switch your iPhone's camera format to \"Most Compatible\" under Settings > Camera > Formats.")
        return
      }
      setConverting(false)
    } else if (!ACCEPTED_TYPES.includes(f.type)) {
      setPickError('Please choose a JPEG, PNG, WebP, or HEIC image.')
      return
    }

    setPickError(null)
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setFile(f)
    setImageSrc(URL.createObjectURL(f))
    setStep('qc')
  }

  function handleConfirm(dets: Detection[], imageId: string, suggestions: Suggestion[]) {
    setConfirmedDetections(dets)
    setConfirmedImageId(imageId)
    setConfirmedSuggestions(suggestions)
    setStep('name')
  }

  function reset() {
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setFile(null)
    setImageSrc(null)
    setConfirmedDetections([])
    setConfirmedImageId(null)
    setConfirmedSuggestions([])
    setStep('pick')
  }

  return (
    <main style={{ padding: step === 'pick' ? 'var(--space-6)' : 0 }}>
      {step === 'pick' && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <h1 style={{ margin: 0 }}>nàshìshéi</h1>
            <button
              onClick={onLogout}
              style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 0 }}
            >
              Sign out
            </button>
          </div>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-6)' }}>
            那是谁 — Put a name to every face.
          </p>

          {/* Tap zone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => !converting && fileInputRef.current?.click()}
            onKeyDown={(e) => { if (!converting && (e.key === 'Enter' || e.key === ' ')) fileInputRef.current?.click() }}
            style={{
              border: '2px dashed var(--color-separator)',
              borderRadius: 'var(--radius-lg)',
              padding: '48px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              cursor: converting ? 'default' : 'pointer',
              opacity: converting ? 0.6 : 1,
              userSelect: 'none',
              marginBottom: galleryLoaded && gallery.length > 0 ? 'var(--space-6)' : undefined,
            }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
              <rect width="40" height="40" rx="10" fill="var(--color-fill)"/>
              <path d="M20 12v16M12 20h16" stroke="var(--color-blue)" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-blue)', margin: 0 }}>
              {gallery.length > 0 ? 'Upload new photo' : 'Choose photo'}
            </p>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
              JPEG, PNG, WebP or HEIC · up to {MAX_SIZE_MB} MB
            </p>
          </div>

          {/* Gallery of previous uploads */}
          {galleryLoaded && (gallery.length > 0 || debouncedQuery !== '') && (
            <section>
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', margin: `0 0 var(--space-3)` }}>
                Your photos
              </h2>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or title"
                aria-label="Search photos by person or title"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 14px',
                  marginBottom: 'var(--space-3)',
                  border: '1px solid var(--color-separator)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 'var(--text-base)',
                  background: 'var(--color-fill)',
                  color: 'var(--color-text)',
                }}
              />
              {gallery.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  No photos match &ldquo;{debouncedQuery}&rdquo;.
                </p>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 'var(--space-2)',
                }}>
                  {gallery.map((img) => {
                    const thumb = (
                      <div style={{
                        aspectRatio: '1',
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                        background: 'var(--color-fill)',
                      }}>
                        <img
                          src={img.thumbnail_url}
                          alt=""
                          crossOrigin="anonymous"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      </div>
                    )
                    return (
                      <div key={img.id}>
                        <div style={{ position: 'relative' }}>
                          {img.share_token ? (
                            <Link to={`/s/${img.share_token}`} style={{ display: 'block', textDecoration: 'none' }}>
                              {thumb}
                            </Link>
                          ) : (
                            <div style={{ opacity: 0.55 }}>{thumb}</div>
                          )}
                          <button
                            type="button"
                            aria-label="Delete photo"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(img.id) }}
                            disabled={deletingId === img.id}
                            style={{
                              position: 'absolute',
                              top: 'var(--space-2)',
                              right: 'var(--space-2)',
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              border: 'none',
                              background: 'rgba(0, 0, 0, 0.55)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: deletingId === img.id ? 'default' : 'pointer',
                              opacity: deletingId === img.id ? 0.5 : 1,
                              padding: 0,
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M3 6h18" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        </div>
                        {editingTitleId === img.id ? (
                          <input
                            autoFocus
                            value={titleDraft}
                            onChange={(e) => setTitleDraft(e.target.value)}
                            onBlur={() => handleTitleSave(img.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                              if (e.key === 'Escape') setEditingTitleId(null)
                            }}
                            style={{
                              width: '100%',
                              boxSizing: 'border-box',
                              marginTop: 'var(--space-1)',
                              fontSize: 'var(--text-sm)',
                              padding: '4px 6px',
                              border: '1px solid var(--color-separator)',
                              borderRadius: 'var(--radius-sm)',
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setEditingTitleId(img.id); setTitleDraft(img.title ?? '') }}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              marginTop: 'var(--space-1)',
                              padding: '2px 0',
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 'var(--text-sm)',
                              color: img.title ? 'var(--color-text)' : 'var(--color-text-muted)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {img.title || 'Add a title'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {galleryError && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
              {galleryError}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {converting && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
              Converting HEIC photo…
            </p>
          )}
          {mlState === 'loading' && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
              Preparing face detection{loadProgress > 0 ? ` · ${Math.round(loadProgress)}%` : '…'}
            </p>
          )}
          {mlState === 'error' && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
              {mlError || 'Face detection failed to load — refresh to retry.'}
            </p>
          )}

          {pickError && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
              {pickError}
            </p>
          )}
        </>
      )}

      {(step === 'qc' || step === 'name') && (
        <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
          <button
            onClick={step === 'name' ? () => setStep('qc') : reset}
            style={{ background: 'none', border: 'none', color: 'var(--color-blue)', padding: 0, fontSize: 'var(--text-base)', fontWeight: 500 }}
          >
            ← Back
          </button>
        </div>
      )}

      {step === 'qc' && imageSrc && file && (
        <ImageDetector src={imageSrc} file={file} onConfirm={handleConfirm} />
      )}

      {step === 'name' && imageSrc && file && (
        <div style={{ padding: '0 var(--space-4)' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'var(--color-fill)',
            borderRadius: 'var(--radius-pill)',
            padding: '4px 12px',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            marginBottom: 'var(--space-4)',
          }}>
            Step 2 of 2 — name the faces
          </div>
          <FaceNameList
            file={file}
            imgSrc={imageSrc}
            detections={confirmedDetections}
            imageId={confirmedImageId ?? undefined}
            suggestions={confirmedSuggestions}
            onDone={reset}
          />
        </div>
      )}
    </main>
  )
}
