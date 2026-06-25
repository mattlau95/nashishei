import { useState } from 'react'
import ImageDetector from '../components/ImageDetector'
import FaceNameList from '../components/FaceNameList'
import type { Detection, Suggestion } from '../types/detection'

type Step = 'pick' | 'qc' | 'name'

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE_MB = 50

export default function Home() {
  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [confirmedDetections, setConfirmedDetections] = useState<Detection[]>([])
  const [confirmedImageId, setConfirmedImageId] = useState<string | null>(null)
  const [confirmedSuggestions, setConfirmedSuggestions] = useState<Suggestion[]>([])
  const [pickError, setPickError] = useState<string | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setPickError('Please choose a JPEG, PNG, or WebP image.')
      return
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setPickError(`File is too large — maximum is ${MAX_SIZE_MB} MB.`)
      return
    }
    setPickError(null)
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setFile(f)
    setImageSrc(URL.createObjectURL(f))
    setStep('qc')
  }

  function handleConfirm(dets: Detection[], imageId: string, suggestions: Suggestion[]) {
    setConfirmedDetections(dets)
    setConfirmedImageId(imageId)
    setConfirmedSuggestions(suggestions)
    setStep('name')
  }

  function reset() {
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setFile(null)
    setImageSrc(null)
    setConfirmedDetections([])
    setConfirmedImageId(null)
    setConfirmedSuggestions([])
    setStep('pick')
  }

  return (
    <main>
      <h1>nàshìshéi</h1>

      {step === 'pick' && (
        <>
          <p style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text)', marginBottom: 'var(--space-1)' }}>
            Who Is That? 那是谁
          </p>
          <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-5)' }}>
            Put a name to every face.
          </p>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
          />
          {pickError && (
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>
              {pickError}
            </p>
          )}
        </>
      )}

      {(step === 'qc' || step === 'name') && (
        <button
          onClick={step === 'name' ? () => setStep('qc') : reset}
          style={{ marginBottom: 'var(--space-3)' }}
        >
          ← Back
        </button>
      )}

      {step === 'qc' && imageSrc && file && (
        <ImageDetector src={imageSrc} file={file} onConfirm={handleConfirm} />
      )}

      {step === 'name' && imageSrc && file && (
        <>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
            Step 2 of 2 — name the faces
          </p>
          <FaceNameList
            file={file}
            imgSrc={imageSrc}
            detections={confirmedDetections}
            imageId={confirmedImageId ?? undefined}
            suggestions={confirmedSuggestions}
          />
        </>
      )}
    </main>
  )
}
