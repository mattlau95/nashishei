import { useRef, useState, useCallback } from 'react'
import type { Detection, Suggestion } from '../types/detection'
import { api } from '../lib/api'
import { mlApi } from '../lib/ml'

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
      // 1. Upload image to cloud backend for storage
      const formData = new FormData()
      formData.append('image', file)
      const uploadRes = await api('/api/images', {
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
      const { id: imageId } = (await uploadRes.json()) as { id: string }
      imageIdRef.current = imageId

      // 2. Run face detection + embedding on local ML sidecar
      const mlForm = new FormData()
      mlForm.append('image', file)
      const mlRes = await mlApi('/detect-and-embed', { method: 'POST', body: mlForm })
      if (!mlRes.ok) {
        throw new Error(`ML sidecar error (${mlRes.status})`)
      }
      const { faces } = (await mlRes.json()) as {
        faces: { bbox_x: number; bbox_y: number; bbox_w: number; bbox_h: number; embedding: number[] }[]
      }

      // 3. Submit detections + embeddings to backend for pgvector storage + suggestions
      const detectRes = await api(`/api/images/${imageId}/detect-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ faces }),
      })
      if (!detectRes.ok) {
        throw new Error(`Failed to save detections (${detectRes.status})`)
      }
      const detectData = (await detectRes.json()) as {
        detections: ServerDetection[]
        suggestions: Suggestion[]
      }

      setDetections(
        detectData.detections.map((d) => ({
          id: d.id,
          bbox_x: d.bbox_x,
          bbox_y: d.bbox_y,
          bbox_w: d.bbox_w,
          bbox_h: d.bbox_h,
          source: 'server' as const,
        })),
      )
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
