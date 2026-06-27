import { useEffect, useState } from 'react'
import { api } from '../lib/api'

const CROP_SIZE = 96

type CropLabel = {
  detection_id: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
}

export function useFaceCrops(
  imgSrc: string | null,
  labels: CropLabel[],
): Record<string, string> {
  const [crops, setCrops] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!imgSrc || labels.length === 0) return
    let cancelled = false

    async function load() {
      // Use only the pathname so the request goes through Vite's /files proxy
      // (same-origin). This avoids CORS entirely — the canvas is never tainted.
      const path = new URL(imgSrc!, window.location.href).pathname
      const resp = await api(path)
      if (!resp.ok) return
      const blob = await resp.blob()
      const blobUrl = URL.createObjectURL(blob)

      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(blobUrl)
        if (cancelled) return
        const result: Record<string, string> = {}
        for (const l of labels) {
          const c = document.createElement('canvas')
          c.width = CROP_SIZE
          c.height = CROP_SIZE
          const ctx = c.getContext('2d')
          if (!ctx) continue
          ctx.drawImage(
            img,
            l.bbox_x * img.naturalWidth,
            l.bbox_y * img.naturalHeight,
            l.bbox_w * img.naturalWidth,
            l.bbox_h * img.naturalHeight,
            0, 0, CROP_SIZE, CROP_SIZE,
          )
          result[l.detection_id] = c.toDataURL('image/jpeg', 0.85)
        }
        if (!cancelled) setCrops(result)
      }
      img.onerror = () => URL.revokeObjectURL(blobUrl)
      img.src = blobUrl
    }

    load().catch(() => {/* network errors are silent — crops stay empty */})
    return () => { cancelled = true }
  }, [imgSrc, labels])

  return crops
}
