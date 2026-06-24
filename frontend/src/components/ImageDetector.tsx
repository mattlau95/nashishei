import { useRef, useEffect, useState } from 'react'
import QCOverlay from './QCOverlay'
import { useFaceDetection } from '../hooks/useFaceDetection'
import type { Detection } from '../types/detection'

type Props = {
  src: string
  onConfirm: (detections: Detection[]) => void
}

const ADD_BTN_STYLE = (addMode: boolean): React.CSSProperties => ({
  padding: '0.35rem 0.75rem',
  background: addMode ? 'var(--color-text-muted)' : 'var(--color-accent)',
  color: addMode ? '#fff' : 'var(--color-text)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap',
})

export default function ImageDetector({ src, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const { detections, setDetections, detect, detecting, error } = useFaceDetection()
  const [addMode, setAddMode] = useState(false)

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    if (img.complete && img.naturalWidth > 0) {
      void detect(img)
      return
    }

    const onLoad = () => void detect(img)
    img.addEventListener('load', onLoad)
    return () => img.removeEventListener('load', onLoad)
  }, [src, detect])

  return (
    <div>
      <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
        <img
          ref={imgRef}
          src={src}
          alt="Group photo for labelling"
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
        {detecting && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-scrim)',
              color: '#fff',
              fontSize: 'var(--text-base)',
              letterSpacing: '0.02em',
            }}
          >
            Detecting faces…
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-overlay-label)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Detection error: {error}
          </div>
        )}
        <QCOverlay
          detections={detections}
          setDetections={setDetections}
          addMode={addMode}
        />
        {/* Floating add button anchored to top of image — visible without scrolling on tall portrait photos */}
        {!detecting && (
          <button
            onClick={() => setAddMode((v) => !v)}
            style={{
              position: 'absolute',
              top: 'var(--space-2)',
              left: 'var(--space-2)',
              zIndex: 20,
              ...ADD_BTN_STYLE(addMode),
            }}
          >
            {addMode ? 'Cancel' : '+ Add face'}
          </button>
        )}
      </div>

      {!detecting && (
        <div style={{ marginTop: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {/* Duplicate add button below the image — matches the one above */}
          <button
            onClick={() => setAddMode((v) => !v)}
            style={ADD_BTN_STYLE(addMode)}
          >
            {addMode ? 'Cancel' : '+ Add face'}
          </button>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', flex: 1 }}>
            {addMode
              ? 'Tap the photo to place a face box. Tap Cancel when done.'
              : 'Tap a box to select — drag to move, drag handles to resize, × to delete.'}
          </p>
          <button
            onClick={() => onConfirm(detections)}
            disabled={detections.length === 0}
            style={{
              padding: '0.35rem 0.9rem',
              background: detections.length > 0 ? '#333' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: detections.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            Name faces →
          </button>
        </div>
      )}
    </div>
  )
}
