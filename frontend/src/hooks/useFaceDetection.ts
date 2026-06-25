import { useRef, useState, useCallback } from 'react'
import type { Detection, Suggestion } from '../types/detection'

type ServerDetection = {
  id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  source: string
}

export function useFaceDetection() {
  const [detecting, setDetecting] = useState(false)
  const [detections, setDetections] = useState<Detection[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [error, setError] = useState<string | null>(null)
  const imageIdRef = useRef<string | null>(null)

  const detect = useCallback(async (_img: HTMLImageElement, file: File) => {
    setDetecting(true)
    setError(null)
    try {
      // Upload image to get an imageId
      const formData = new FormData()
      formData.append('image', file)
      const uploadRes = await fetch('/api/images', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      })
      if (uploadRes.status === 401) {
        throw new Error('Not logged in — please sign in to detect faces.')
      }
      if (!uploadRes.ok) {
        throw new Error(`Image upload failed (${uploadRes.status})`)
      }
      const uploadData = (await uploadRes.json()) as { id: string }
      const imageId = uploadData.id
      imageIdRef.current = imageId

      // Run server-side detection + embedding
      const detectRes = await fetch(`/api/images/${imageId}/detect`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!detectRes.ok) {
        throw new Error(`Face detection failed (${detectRes.status})`)
      }
      const detectData = (await detectRes.json()) as {
        detections: ServerDetection[]
        suggestions: Suggestion[]
      }

      const dets: Detection[] = detectData.detections.map((d) => ({
        id: d.id,
        bbox_x: d.bbox_x,
        bbox_y: d.bbox_y,
        bbox_w: d.bbox_w,
        bbox_h: d.bbox_h,
        source: 'server' as const,
      }))

      setDetections(dets)
      setSuggestions(detectData.suggestions ?? [])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('face detection failed:', err)
      setError(msg)
    } finally {
      setDetecting(false)
    }
  }, [])

  return {
    detections,
    setDetections,
    detect,
    detecting,
    error,
    suggestions,
    imageId: imageIdRef.current,
  }
}
