import * as ort from 'onnxruntime-web'
import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'

// ── Singletons ─────────────────────────────────────────────────────────────

let _session: ort.InferenceSession | null = null
let _landmarker: FaceLandmarker | null = null
export type EP = 'webgpu' | 'wasm'
let _ep: EP | null = null

// ── IndexedDB cache ────────────────────────────────────────────────────────

const DB_NAME = 'nashishei-ml'
const STORE = 'models'
const MODEL_KEY = 'w600k_r50'

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => (e.target as IDBOpenDBRequest).result.createObjectStore(STORE)
    req.onsuccess = (e) => res((e.target as IDBOpenDBRequest).result)
    req.onerror = () => rej(req.error)
  })
}

async function getCached(): Promise<ArrayBuffer | null> {
  const db = await openDb()
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(MODEL_KEY)
    req.onsuccess = () => res((req.result as ArrayBuffer) ?? null)
    req.onerror = () => res(null)
  })
}

async function putCached(buf: ArrayBuffer): Promise<void> {
  const db = await openDb()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(buf, MODEL_KEY)
    tx.oncomplete = () => res()
    tx.onerror = () => res()
  })
}

// ── ArcFace model loading ──────────────────────────────────────────────────

async function loadArcFace(
  onProgress: (pct: number, source: 'cache' | 'network') => void,
): Promise<EP> {
  const ep: EP = 'gpu' in navigator ? 'webgpu' : 'wasm'

  const cached = await getCached()
  if (cached) {
    onProgress(100, 'cache')
    _session = await ort.InferenceSession.create(cached, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    })
  } else {
    const resp = await fetch('/models/w600k_r50.onnx')
    if (!resp.ok) throw new Error(`ArcFace model fetch failed (${resp.status})`)
    const total = Number(resp.headers.get('content-length') ?? 0)
    const reader = resp.body!.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value!)
      received += value!.length
      if (total > 0) onProgress((received / total) * 100, 'network')
    }
    const buf = new Uint8Array(received)
    let off = 0
    for (const c of chunks) { buf.set(c, off); off += c.length }
    const arrayBuf = buf.buffer
    await putCached(arrayBuf)
    _session = await ort.InferenceSession.create(arrayBuf, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    })
  }

  // warmup: compile GPU pipelines before first real inference
  const dummy = new ort.Tensor('float32', new Float32Array(3 * 112 * 112), [1, 3, 112, 112])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[_session.inputNames[0]] = dummy
  await _session.run(feeds)

  return ep
}

// ── FaceLandmarker loading ─────────────────────────────────────────────────

async function loadFaceLandmarker(): Promise<void> {
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  )
  _landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
      delegate: 'GPU',
    },
    runningMode: 'IMAGE',
    numFaces: 30,
    minFaceDetectionConfidence: 0.4,
    outputFaceBlendshapes: false,
  })
}

// ── Public init ────────────────────────────────────────────────────────────

export async function initML(
  onProgress: (pct: number, source: 'cache' | 'network') => void,
): Promise<EP> {
  const [ep] = await Promise.all([loadArcFace(onProgress), loadFaceLandmarker()])
  _ep = ep
  return ep
}

export function getEP(): EP | null { return _ep }

// ── Face alignment ─────────────────────────────────────────────────────────

// InsightFace canonical 5-point positions for 112×112 ArcFace input.
const ARCFACE_TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

// MediaPipe FaceLandmarker indices: iris centers (468/473) are part of the 478-point output.
const MP_IDX = { leftEye: 468, rightEye: 473, nose: 1, leftMouth: 61, rightMouth: 291 }

function similarityTransform(
  src: [number, number][],
  dst: [number, number][],
): [number, number, number, number, number, number] {
  const N = src.length
  let ux = 0, uy = 0, vx = 0, vy = 0
  for (let i = 0; i < N; i++) { ux += src[i][0]; uy += src[i][1]; vx += dst[i][0]; vy += dst[i][1] }
  ux /= N; uy /= N; vx /= N; vy /= N
  let sig2 = 0, aN = 0, bN = 0
  for (let i = 0; i < N; i++) {
    const qx = src[i][0] - ux, qy = src[i][1] - uy
    const rx = dst[i][0] - vx, ry = dst[i][1] - vy
    sig2 += qx * qx + qy * qy
    aN   += qx * rx + qy * ry
    bN   += qx * ry - qy * rx
  }
  sig2 /= N; aN /= N; bN /= N
  const a = aN / sig2, b = bN / sig2
  const tx = vx - (a * ux - b * uy)
  const ty = vy - (b * ux + a * uy)
  return [a, b, -b, a, tx, ty]
}

function alignAndPreprocess(img: HTMLImageElement, landmarks: NormalizedLandmark[]): Float32Array {
  const W = img.naturalWidth, H = img.naturalHeight
  const src: [number, number][] = [
    [landmarks[MP_IDX.leftEye].x   * W, landmarks[MP_IDX.leftEye].y   * H],
    [landmarks[MP_IDX.rightEye].x  * W, landmarks[MP_IDX.rightEye].y  * H],
    [landmarks[MP_IDX.nose].x      * W, landmarks[MP_IDX.nose].y      * H],
    [landmarks[MP_IDX.leftMouth].x  * W, landmarks[MP_IDX.leftMouth].y  * H],
    [landmarks[MP_IDX.rightMouth].x * W, landmarks[MP_IDX.rightMouth].y * H],
  ]
  const canvas = document.createElement('canvas')
  canvas.width = 112; canvas.height = 112
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(...similarityTransform(src, ARCFACE_TEMPLATE))
  ctx.drawImage(img, 0, 0)
  ctx.resetTransform()
  const { data } = ctx.getImageData(0, 0, 112, 112)
  const t = new Float32Array(3 * 112 * 112)
  const N = 112 * 112
  for (let i = 0; i < N; i++) {
    t[i]         = (data[i * 4]     - 127.5) / 128
    t[N + i]     = (data[i * 4 + 1] - 127.5) / 128
    t[N * 2 + i] = (data[i * 4 + 2] - 127.5) / 128
  }
  return t
}

// ── Public detect + embed ──────────────────────────────────────────────────

export interface FaceResult {
  bboxNorm: { x: number; y: number; w: number; h: number }
  embedding: number[]
}

export async function detectAndEmbed(img: HTMLImageElement): Promise<FaceResult[]> {
  if (!_session || !_landmarker) throw new Error('ML not initialized')
  const detection = _landmarker.detect(img)
  const results: FaceResult[] = []
  for (const landmarks of detection.faceLandmarks) {
    const xs = landmarks.map(l => l.x), ys = landmarks.map(l => l.y)
    const xMin = Math.min(...xs), xMax = Math.max(...xs)
    const yMin = Math.min(...ys), yMax = Math.max(...ys)
    const faceData = alignAndPreprocess(img, landmarks)
    const tensor = new ort.Tensor('float32', faceData, [1, 3, 112, 112])
    const feeds: Record<string, ort.Tensor> = {}
    feeds[_session.inputNames[0]] = tensor
    const out = await _session.run(feeds)
    const embedding = Array.from(out[_session.outputNames[0]].data as Float32Array)
    results.push({ bboxNorm: { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin }, embedding })
  }
  return results
}
