import type { Detection } from '../types/detection'

export default function FaceOverlay({ detections }: { detections: Detection[] }) {
  if (detections.length === 0) return null

  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      overflow="hidden"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      {detections.map((d) => (
        <rect
          key={d.id}
          x={d.bbox_x}
          y={d.bbox_y}
          width={d.bbox_w}
          height={d.bbox_h}
          fill="none"
          stroke="rgba(250, 220, 0, 0.9)"
          strokeWidth={0.003}
        />
      ))}
    </svg>
  )
}
