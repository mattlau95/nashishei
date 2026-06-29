import { useState, useRef, useCallback } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { loadArcFace, alignAndPreprocess, embed, cosineSim, type EP } from '../lib/arcfaceSpike'
import type { InferenceSession } from 'onnxruntime-web'

// ── Types ──────────────────────────────────────────────────────────────────

interface FaceResult {
  imageLabel: string
  faceIndex: number
  cropDataUrl: string
  embedding: Float32Array | null
  embedMs: number
}

interface RunResult {
  faces: FaceResult[]
  detectMs: number
  totalEmbedMs: number
  ep: EP
  memoryMb: number | null
}

// ── Helpers ────────────────────────────────────────────────────────────────

function memoryMb(): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mem = (performance as any).memory
  return mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : null
}

function fmt(n: number) { return n.toFixed(1) }
function simColor(v: number) {
  if (v >= 0.5) return '#22c55e'
  if (v >= 0.3) return '#f59e0b'
  return '#ef4444'
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ArcFaceSpike() {
  const [modelState, setModelState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [modelPct, setModelPct] = useState(0)
  const [modelSource, setModelSource] = useState<'cache' | 'network' | null>(null)
  const [ep, setEp] = useState<EP | null>(null)
  const sessionRef = useRef<InferenceSession | null>(null)
  const detectorRef = useRef<FaceLandmarker | null>(null)

  const [images, setImages] = useState<{ label: string; file: File; url: string }[]>([])
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Load model ────────────────────────────────────────────────────────

  const handleLoadModel = useCallback(async () => {
    setModelState('loading')
    setModelPct(0)
    setError(null)
    try {
      const { session, ep: chosenEp, fromCache } = await loadArcFace((pct, src) => {
        setModelPct(pct)
        setModelSource(src)
      })
      sessionRef.current = session
      setEp(chosenEp)
      setModelSource(fromCache ? 'cache' : 'network')

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
      )
      detectorRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'IMAGE',
        numFaces: 20,
        minFaceDetectionConfidence: 0.5,
        outputFaceBlendshapes: false,
      })

      setModelState('ready')
    } catch (e) {
      setModelState('error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // ── Image selection ───────────────────────────────────────────────────

  function addImages(files: FileList | null) {
    if (!files) return
    const next = Array.from(files).map((f, i) => ({
      label: `Image ${images.length + i + 1}`,
      file: f,
      url: URL.createObjectURL(f),
    }))
    setImages((prev) => [...prev, ...next])
    setResult(null)
  }

  function removeImage(i: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, j) => j !== i)
    })
    setResult(null)
  }

  // ── Run ───────────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (!sessionRef.current || !detectorRef.current || images.length === 0) return
    setRunning(true)
    setError(null)
    try {
      const session = sessionRef.current
      const detector = detectorRef.current
      const faces: FaceResult[] = []
      let detectAccMs = 0
      let embedAccMs = 0

      for (const { label, url } of images) {
        // Load image element
        const img = await new Promise<HTMLImageElement>((res, rej) => {
          const el = new Image()
          el.onload = () => res(el)
          el.onerror = rej
          el.src = url
        })

        // Detect + landmark
        const t0 = performance.now()
        const detection = detector.detect(img)
        detectAccMs += performance.now() - t0

        if (detection.faceLandmarks.length === 0) {
          faces.push({ imageLabel: label, faceIndex: 0, cropDataUrl: '', embedding: null, embedMs: 0 })
          continue
        }

        for (let fi = 0; fi < detection.faceLandmarks.length; fi++) {
          const landmarks = detection.faceLandmarks[fi]
          const W = img.naturalWidth, H = img.naturalHeight

          // Bounding box from landmark extents (for display crop only)
          const xs = landmarks.map(l => l.x), ys = landmarks.map(l => l.y)
          const xMin = Math.min(...xs), xMax = Math.max(...xs)
          const yMin = Math.min(...ys), yMax = Math.max(...ys)
          const cropCanvas = document.createElement('canvas')
          cropCanvas.width = 96; cropCanvas.height = 96
          cropCanvas.getContext('2d')!.drawImage(
            img,
            xMin * W, yMin * H, (xMax - xMin) * W, (yMax - yMin) * H,
            0, 0, 96, 96,
          )
          const cropDataUrl = cropCanvas.toDataURL('image/jpeg', 0.8)

          // Aligned preprocess + embed
          const faceData = alignAndPreprocess(img, landmarks)
          const t1 = performance.now()
          const embedding = await embed(session, faceData)
          const embedMs = performance.now() - t1
          embedAccMs += embedMs

          faces.push({ imageLabel: label, faceIndex: fi, cropDataUrl, embedding, embedMs })
        }
      }

      setResult({
        faces,
        detectMs: detectAccMs,
        totalEmbedMs: embedAccMs,
        ep: ep!,
        memoryMb: memoryMb(),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [images, ep])

  // ── Render ────────────────────────────────────────────────────────────

  const embeddedFaces = result?.faces.filter((f) => f.embedding) ?? []

  return (
    <div style={{ fontFamily: 'monospace', maxWidth: 900, margin: '0 auto', padding: '1rem 1.5rem', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', marginBottom: 4 }}>
        SPIKE — Browser ArcFace (onnxruntime-web)
      </h1>
      <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1.5rem' }}>
        ⚠️ InsightFace models are <strong>non-commercial research only</strong>. Fine for a private church project.
      </p>

      {/* ── Step 1: Model ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>1 · Load ArcFace model</h2>
        {modelState === 'idle' && (
          <button onClick={handleLoadModel} style={btnStyle}>Load model (~166 MB, cached after first run)</button>
        )}
        {modelState === 'loading' && (
          <div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: 6 }}>
              {modelSource === 'cache' ? 'Loading from IndexedDB cache…' : `Downloading… ${fmt(modelPct)}%`}
            </div>
            <div style={{ background: '#1e293b', borderRadius: 4, height: 6, width: '100%' }}>
              <div style={{ background: '#6366f1', height: 6, borderRadius: 4, width: `${modelPct}%`, transition: 'width 0.2s' }} />
            </div>
          </div>
        )}
        {modelState === 'ready' && (
          <div style={{ fontSize: '0.8rem', color: '#22c55e' }}>
            ✓ ArcFace ready &nbsp;|&nbsp; EP: <strong>{ep}</strong> &nbsp;|&nbsp; source: <strong>{modelSource}</strong>
          </div>
        )}
        {modelState === 'error' && (
          <div>
            <div style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: 8 }}>✗ {error}</div>
            <button onClick={handleLoadModel} style={btnStyle}>Retry</button>
          </div>
        )}
      </section>

      {/* ── Step 2: Images ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>2 · Upload test photos (2–4 recommended)</h2>
        <p style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 8 }}>
          Tip: upload two photos of the same person + one of someone else to verify similarity scores.
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          style={{ fontSize: '0.8rem', marginBottom: 10 }}
          onChange={(e) => addImages(e.target.files)}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative', textAlign: 'center' }}>
              <img src={img.url} alt={img.label} style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4, border: '1px solid #334155' }} />
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginTop: 2 }}>{img.label}</div>
              <button
                onClick={() => removeImage(i)}
                style={{ position: 'absolute', top: 2, right: 2, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 2, cursor: 'pointer', fontSize: '0.65rem', padding: '1px 4px' }}
              >×</button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Step 3: Run ── */}
      <section style={sectionStyle}>
        <h2 style={h2Style}>3 · Run</h2>
        <button
          onClick={handleRun}
          disabled={modelState !== 'ready' || images.length === 0 || running}
          style={{ ...btnStyle, opacity: (modelState !== 'ready' || images.length === 0 || running) ? 0.4 : 1 }}
        >
          {running ? 'Running…' : 'Detect + Embed'}
        </button>
        {error && modelState !== 'error' && (
          <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 8 }}>✗ {error}</div>
        )}
      </section>

      {/* ── Results ── */}
      {result && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Results</h2>

          {/* Timing */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <Stat label="EP" value={result.ep} />
            <Stat label="Detect (all images)" value={`${fmt(result.detectMs)} ms`} />
            <Stat label="Embed (all faces)" value={`${fmt(result.totalEmbedMs)} ms`} />
            <Stat label="Per face (avg)" value={embeddedFaces.length ? `${fmt(result.totalEmbedMs / embeddedFaces.length)} ms` : '—'} />
            <Stat label="JS heap" value={result.memoryMb ? `${result.memoryMb} MB` : 'n/a'} />
          </div>

          {/* Face crops */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 8 }}>Detected faces</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {result.faces.map((f, i) => (
                <div key={i} style={{ textAlign: 'center' }}>
                  {f.cropDataUrl
                    ? <img src={f.cropDataUrl} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4, border: '1px solid #334155' }} />
                    : <div style={{ width: 64, height: 64, background: '#1e293b', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#64748b' }}>no face</div>
                  }
                  <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 2 }}>
                    {f.imageLabel}<br />face {f.faceIndex + 1}
                    {f.embedding && <><br />{fmt(f.embedMs)} ms</>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cosine similarity matrix */}
          {embeddedFaces.length >= 2 && (
            <div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 8 }}>
                Cosine similarity matrix &nbsp;
                <span style={{ color: '#22c55e' }}>≥ 0.5 same-person likely</span>,&nbsp;
                <span style={{ color: '#f59e0b' }}>0.3–0.5 uncertain</span>,&nbsp;
                <span style={{ color: '#ef4444' }}>{"< 0.3"} different</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}></th>
                      {embeddedFaces.map((f, j) => (
                        <th key={j} style={thStyle}>{f.imageLabel} f{f.faceIndex + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {embeddedFaces.map((fA, i) => (
                      <tr key={i}>
                        <td style={thStyle}>{fA.imageLabel} f{fA.faceIndex + 1}</td>
                        {embeddedFaces.map((fB, j) => {
                          const sim = cosineSim(fA.embedding!, fB.embedding!)
                          return (
                            <td key={j} style={{ ...tdStyle, color: i === j ? '#475569' : simColor(sim), fontWeight: i !== j ? 600 : 400 }}>
                              {fmt(sim)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Acceptance checklist */}
          <div style={{ marginTop: 20, fontSize: '0.75rem', color: '#94a3b8' }}>
            <div style={{ fontWeight: 600, marginBottom: 6, color: '#64748b' }}>Acceptance criteria</div>
            {[
              ['ArcFace ONNX loads and runs in-browser', modelState === 'ready'],
              [`WebGPU path active (EP = ${ep})`, ep === 'webgpu'],
              ['Faces detected and embedded', embeddedFaces.length > 0],
              ['Model cached (reload page to test cache hit)', modelSource === 'cache'],
            ].map(([label, pass], i) => (
              <div key={i} style={{ color: pass ? '#22c55e' : '#64748b' }}>
                {pass ? '✓' : '○'} {label as string}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Micro-components ───────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#1e293b', borderRadius: 6, padding: '6px 12px', minWidth: 80 }}>
      <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: 8,
  padding: '1rem 1.25rem',
  marginBottom: '1rem',
}

const h2Style: React.CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '0.75rem',
}

const btnStyle: React.CSSProperties = {
  background: '#6366f1',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 16px',
  fontSize: '0.85rem',
  cursor: 'pointer',
  fontFamily: 'monospace',
}

const thStyle: React.CSSProperties = {
  padding: '4px 10px',
  textAlign: 'left',
  color: '#64748b',
  borderBottom: '1px solid #334155',
}

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  textAlign: 'right',
  borderBottom: '1px solid #1e293b',
}
