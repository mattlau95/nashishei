import { useRef, useEffect, useState } from 'react'
import QCOverlay from './QCOverlay'
import { useFaceDetection } from '../hooks/useFaceDetection'
import { useZoomPan } from '../hooks/useZoomPan'
import type { Detection, Suggestion } from '../types/detection'
import './ImageDetector.css'

type Props = {
  src: string
  file: File
  onConfirm: (detections: Detection[], imageId: string, suggestions: Suggestion[]) => void
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

export default function ImageDetector({ src, file, onConfirm }: Props) {
  const imgRef = useRef<HTMLImageElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const { detections, setDetections, detect, detecting, error, suggestions, imageId } = useFaceDetection()
  const [addMode, setAddMode] = useState(false)

  const { scale: zoomScale, transformStyle, handlers, reset } = useZoomPan({
    containerRef: viewportRef,
    disabled: addMode,
  })

  useEffect(() => {
    const img = imgRef.current
    if (!img) return

    if (img.complete && img.naturalWidth > 0) {
      void detect(img, file)
      return
    }

    const onLoad = () => void detect(img, file)
    img.addEventListener('load', onLoad)
    return () => img.removeEventListener('load', onLoad)
  }, [src, detect])

  // Reset zoom whenever a new image is loaded
  useEffect(() => { reset() }, [src, reset])

  return (
    <div className="qc-layout">
      <div className="qc-viewport" ref={viewportRef}>
        <div
          style={{ position: 'relative', display: 'inline-block', width: '100%', ...transformStyle }}
          {...handlers}
        >
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
            scale={zoomScale}
          />
        </div>
      </div>

      {!detecting && (
        <div className="qc-sticky-bar">
          <button onClick={() => setAddMode((v) => !v)} style={ADD_BTN_STYLE(addMode)}>
            {addMode ? 'Cancel' : '+ Add face'}
          </button>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', flex: 1 }}>
            {addMode
              ? 'Tap the photo to place a face box. Tap Cancel when done.'
              : 'Tap a box to select — drag to move, drag handles to resize, × to delete.'}
          </p>
          <button
            onClick={() => onConfirm(detections, imageId ?? '', suggestions)}
            disabled={detections.length === 0}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: detections.length > 0 ? 'var(--color-blue)' : 'rgba(120,120,128,0.20)',
              color: detections.length > 0 ? '#fff' : 'rgba(60,60,67,0.40)',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              cursor: detections.length > 0 ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              minHeight: 'var(--tap-target)',
            }}
          >
            Name faces →
          </button>
        </div>
      )}
    </div>
  )
}
