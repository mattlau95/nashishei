import { useRef, useState, useCallback } from 'react'
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import type { Detection } from '../types/detection'

const WASM_URL = '/mediapipe-wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite'

function iou(a: Detection, b: Detection): number {
  const x1 = Math.max(a.bbox_x, b.bbox_x)
  const y1 = Math.max(a.bbox_y, b.bbox_y)
  const x2 = Math.min(a.bbox_x + a.bbox_w, b.bbox_x + b.bbox_w)
  const y2 = Math.min(a.bbox_y + a.bbox_h, b.bbox_y + b.bbox_h)
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  if (intersection === 0) return 0
  return intersection / (a.bbox_w * a.bbox_h + b.bbox_w * b.bbox_h - intersection)
}

// Greedy NMS: MediaPipe returns results highest-confidence first.
// Keep a detection only if it doesn't heavily overlap one we already kept.
function dedup(dets: Detection[], threshold = 0.35): Detection[] {
  const kept: Detection[] = []
  for (const d of dets) {
    if (!kept.some((k) => iou(k, d) > threshold)) kept.push(d)
  }
  return kept
}

export function useFaceDetection() {
  const detectorRef = useRef<FaceDetector | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detections, setDetections] = useState<Detection[]>([])
  const [error, setError] = useState<string | null>(null)

  const detect = useCallback(async (img: HTMLImageElement) => {
    setDetecting(true)
    setError(null)
    try {
      if (!detectorRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        detectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.2,
        })
      }

      // Draw to canvas: applies EXIF orientation and caps to 1920px.
      const { naturalWidth: origW, naturalHeight: origH } = img
      const MAX_DIM = 1920
      const scale = Math.min(1, MAX_DIM / Math.max(origW, origH))
      const cw = Math.round(origW * scale)
      const ch = Math.round(origH * scale)
      const canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas 2d context unavailable')
      ctx.drawImage(img, 0, 0, cw, ch)

      const raw = detectorRef.current.detect(canvas)

      const dets = dedup(
        raw.detections.map((d) => ({
          id: crypto.randomUUID(),
          bbox_x: Math.max(0, (d.boundingBox?.originX ?? 0) / cw),
          bbox_y: Math.max(0, (d.boundingBox?.originY ?? 0) / ch),
          bbox_w: Math.min(1, (d.boundingBox?.width ?? 0) / cw),
          bbox_h: Math.min(1, (d.boundingBox?.height ?? 0) / ch),
          source: 'auto' as const,
        })),
      )

      console.log(`detected ${dets.length} faces`)
      setDetections(dets)
      return dets
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('face detection failed:', err)
      setError(msg)
    } finally {
      setDetecting(false)
    }
  }, [])

  return { detections, setDetections, detect, detecting, error }
}
