import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { Link } from 'react-router-dom'
import ImageDetector from '../components/ImageDetector'
import FaceNameList from '../components/FaceNameList'
import type { Detection, Suggestion } from '../types/detection'

type Step = 'pick' | 'qc' | 'name'
type GalleryImage = { id: string; thumbnail_url: string; share_token: string | null }

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_MB = 50

export default function Home({ onLogout }: { onLogout: () => void }) {
  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [confirmedDetections, setConfirmedDetections] = useState<Detection[]>([])
  const [confirmedImageId, setConfirmedImageId] = useState<string | null>(null)
  const [confirmedSuggestions, setConfirmedSuggestions] = useState<Suggestion[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [gallery, setGallery] = useState<GalleryImage[]>([])
  const [galleryLoaded, setGalleryLoaded] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step !== 'pick') return
    api('/api/images')
      .then((r) => (r.ok ? r.json() : []))
      .then((items: GalleryImage[]) => { setGallery(items); setGalleryLoaded(true) })
      .catch(() => setGalleryLoaded(true))
  }, [step])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setPickError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setPickError(`File is too large — maximum is ${MAX_SIZE_MB} MB.`)
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
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click() }}
            style={{
              border: '2px dashed var(--color-separator)',
              borderRadius: 'var(--radius-lg)',
              padding: '48px 24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 'var(--space-3)',
              cursor: 'pointer',
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
              JPEG, PNG or WebP · up to {MAX_SIZE_MB} MB
            </p>
          </div>

          {/* Gallery of previous uploads */}
          {galleryLoaded && gallery.length > 0 && (
            <section>
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text)', margin: `0 0 var(--space-3)` }}>
                Your photos
              </h2>
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
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </div>
                  )
                  return img.share_token ? (
                    <Link key={img.id} to={`/s/${img.share_token}`} style={{ display: 'block', textDecoration: 'none' }}>
                      {thumb}
                    </Link>
                  ) : (
                    <div key={img.id} style={{ opacity: 0.55 }}>{thumb}</div>
                  )
                })}
              </div>
            </section>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

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
          />
        </div>
      )}
    </main>
  )
}
