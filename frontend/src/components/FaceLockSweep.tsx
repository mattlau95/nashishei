import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import type { Detection } from '../types/detection'
import './FaceLockSweep.css'

const SWEEP_MS = 900
const HOLD_MS = 450

type Props = {
  faces: Detection[]
  onDone: () => void
}

// Plays once after real detections come back: a sweep crosses the photo
// left-to-right and each face's bracket "locks" as the line passes its
// center, then a "N faces detected" label holds briefly before handing off
// to the interactive QCOverlay. The faces are already known — this is a
// reveal animation, not a measure of real detection progress.
export default function FaceLockSweep({ faces, onDone }: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const [prog, setProg] = useState(0)
  const [holding, setHolding] = useState(false)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (reducedMotion) {
      setHolding(true)
      const id = setTimeout(() => onDoneRef.current(), HOLD_MS)
      return () => clearTimeout(id)
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / SWEEP_MS)
      setProg(p)
      if (p >= 1) {
        setHolding(true)
        setTimeout(() => onDoneRef.current(), HOLD_MS)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  const label = holding
    ? `${faces.length} ${faces.length === 1 ? 'face' : 'faces'} detected`
    : 'Detecting faces'

  return (
    <div className="fls-root">
      {!reducedMotion && !holding && (
        <div
          className="fls-sweep-track"
          aria-hidden="true"
          style={{ transform: `translateX(${(4 + prog * 92).toFixed(2)}%)` }}
        >
          <div className="fls-sweep-line" />
        </div>
      )}
      {faces.map((f) => {
        const locked = holding || prog >= f.bbox_x + f.bbox_w / 2
        const shown = holding || prog >= f.bbox_x - 0.03
        if (!shown) return null
        return (
          <div
            key={f.id}
            aria-hidden="true"
            className={`fls-box${locked ? ' fls-box--locked' : ''}`}
            style={{
              left: `${f.bbox_x * 100}%`,
              top: `${f.bbox_y * 100}%`,
              width: `${f.bbox_w * 100}%`,
              height: `${f.bbox_h * 100}%`,
            }}
          >
            <span className="fls-corner fls-corner--tl" />
            <span className="fls-corner fls-corner--tr" />
            <span className="fls-corner fls-corner--bl" />
            <span className="fls-corner fls-corner--br" />
          </div>
        )
      })}
      <div className="fls-badge" role="status" aria-live="polite">
        {label}
      </div>
    </div>
  )
}
