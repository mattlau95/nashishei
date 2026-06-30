import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import './DetectingFacesOverlay.css'

type Props = {
  label: string
  progress?: number
}

export default function DetectingFacesOverlay({ label, progress }: Props) {
  const reducedMotion = usePrefersReducedMotion()
  const [dots, setDots] = useState(1)

  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => setDots((n) => (n % 3) + 1), 400)
    return () => clearInterval(id)
  }, [reducedMotion])

  return (
    <div className="df-overlay" role="status" aria-live="polite">
      {!reducedMotion && <div className="df-sweep" aria-hidden="true" />}
      <div className="df-badge">
        <span className={`df-spinner${reducedMotion ? ' df-spinner--static' : ''}`} aria-hidden="true" />
        <span className="df-label">
          {label}
          {typeof progress === 'number' && progress > 0 ? ` ${Math.round(progress)}%` : ''}
          <span aria-hidden="true">{'.'.repeat(reducedMotion ? 3 : dots)}</span>
        </span>
      </div>
    </div>
  )
}
