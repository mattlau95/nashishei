import { useRef, useState, useCallback } from 'react'
import type { Detection, Suggestion } from '../types/detection'
import { api } from '../lib/api'
import { detectAndEmbed } from '../lib/mlBrowser'
import { FriendlyError, toUserMessage } from '../lib/errorMessages'

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

  const detect = useCallback(async (img: HTMLImageElement, file: File) => {
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
      if (uploadRes.status === 401) throw new FriendlyError('Not logged in — please sign in.')
      if (!uploadRes.ok) throw new FriendlyError("Couldn't upload your photo — try again.")
      const { id: imageId } = (await uploadRes.json()) as { id: string }
      imageIdRef.current = imageId

      // 2. Detect landmarks + embed in-browser
      const faces = await detectAndEmbed(img)

      // 3. Submit embeddings to backend for pgvector storage + name suggestions
      const detectRes = await api(`/api/images/${imageId}/detect-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          faces: faces.map((f) => ({
            bbox_x: f.bboxNorm.x,
            bbox_y: f.bboxNorm.y,
            bbox_w: f.bboxNorm.w,
            bbox_h: f.bboxNorm.h,
            embedding: f.embedding,
          })),
        }),
      })
      if (!detectRes.ok) throw new FriendlyError("Couldn't save the detected faces — try again.")
      const { detections: serverDets, suggestions: serverSuggestions } = (await detectRes.json()) as {
        detections: ServerDetection[]
        suggestions: Suggestion[]
      }

      setDetections(
        serverDets.map((d) => ({
          id: d.id,
          bbox_x: d.bbox_x,
          bbox_y: d.bbox_y,
          bbox_w: d.bbox_w,
          bbox_h: d.bbox_h,
          source: 'server' as const,
        })),
      )
      setSuggestions(serverSuggestions ?? [])
    } catch (err) {
      setError(toUserMessage(err, "Couldn't detect faces — try again."))
    } finally {
      setDetecting(false)
    }
  }, [])

  return { detections, setDetections, detect, detecting, error, suggestions, imageId: imageIdRef.current }
}
