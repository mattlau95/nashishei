import * as ort from 'onnxruntime-web'

const MODEL_URL = '/models/w600k_r50.onnx'
const DB_NAME = 'arcface-spike'
const STORE = 'models'
const MODEL_KEY = 'w600k_r50'

// ── IndexedDB cache ────────────────────────────────────────────────────────

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

// ── Model loading ──────────────────────────────────────────────────────────

export type EP = 'webgpu' | 'wasm'

export async function loadArcFace(
  onProgress: (pct: number, source: 'cache' | 'network') => void,
): Promise<{ session: ort.InferenceSession; ep: EP; fromCache: boolean }> {
  const ep: EP = 'gpu' in navigator ? 'webgpu' : 'wasm'

  const cached = await getCached()
  if (cached) {
    onProgress(100, 'cache')
    const session = await ort.InferenceSession.create(cached, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    })
    // warmup
    await warmup(session)
    return { session, ep, fromCache: true }
  }

  const resp = await fetch(MODEL_URL)
  if (!resp.ok) throw new Error(`Model download failed: ${resp.status}`)
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

  const session = await ort.InferenceSession.create(arrayBuf, {
    executionProviders: [ep],
    graphOptimizationLevel: 'all',
  })
  await warmup(session)
  return { session, ep, fromCache: false }
}

async function warmup(session: ort.InferenceSession) {
  const dummy = new ort.Tensor('float32', new Float32Array(3 * 112 * 112), [1, 3, 112, 112])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[session.inputNames[0]] = dummy
  await session.run(feeds)
}

// ── Face alignment ─────────────────────────────────────────────────────────

// InsightFace canonical 5-point positions for 112×112 ArcFace input.
// Order: left-eye, right-eye, nose-tip, left-mouth, right-mouth.
const ARCFACE_TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

// MediaPipe FaceLandmarker indices for the same 5 points.
// Indices 468 / 473 are the iris-center landmarks (always present in the 478-point output).
const MP_IDX = { leftEye: 468, rightEye: 473, nose: 1, leftMouth: 61, rightMouth: 291 }

type Lm = { x: number; y: number; z: number }

// Closed-form similarity transform estimation (scale + rotation + translation).
// Maps srcPts → dstPts in the least-squares sense.
// Returns canvas setTransform args [a, b, c, d, e, f].
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
  // Affine: x' = a·x − b·y + tx,  y' = b·x + a·y + ty
  // canvas setTransform(a, b, c, d, e, f): x' = a·x + c·y + e, y' = b·x + d·y + f
  return [a, b, -b, a, tx, ty]
}

export function alignAndPreprocess(img: HTMLImageElement, landmarks: Lm[]): Float32Array {
  const W = img.naturalWidth, H = img.naturalHeight
  const src: [number, number][] = [
    [landmarks[MP_IDX.leftEye].x  * W, landmarks[MP_IDX.leftEye].y  * H],
    [landmarks[MP_IDX.rightEye].x * W, landmarks[MP_IDX.rightEye].y * H],
    [landmarks[MP_IDX.nose].x     * W, landmarks[MP_IDX.nose].y     * H],
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
  const tensor = new Float32Array(3 * 112 * 112)
  const N = 112 * 112
  for (let i = 0; i < N; i++) {
    tensor[i]         = (data[i * 4]     - 127.5) / 128
    tensor[N + i]     = (data[i * 4 + 1] - 127.5) / 128
    tensor[N * 2 + i] = (data[i * 4 + 2] - 127.5) / 128
  }
  return tensor
}

// ── Inference ──────────────────────────────────────────────────────────────

export async function embed(
  session: ort.InferenceSession,
  faceData: Float32Array,
): Promise<Float32Array> {
  const tensor = new ort.Tensor('float32', faceData, [1, 3, 112, 112])
  const feeds: Record<string, ort.Tensor> = {}
  feeds[session.inputNames[0]] = tensor
  const out = await session.run(feeds)
  return out[session.outputNames[0]].data as Float32Array
}

// ── Math ───────────────────────────────────────────────────────────────────

export function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
