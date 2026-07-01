import * as ort from 'onnxruntime-web'

// Singletons live at module scope; HMR swapping would leave mlState='ready'
// while sessions are null. Force a full reload on any edit to this file.
if (import.meta.hot) import.meta.hot.invalidate()

// ── Singletons ─────────────────────────────────────────────────────────────

let _arcSession: ort.InferenceSession | null = null
let _detSession: ort.InferenceSession | null = null
export type EP = 'webgpu' | 'wasm'
// Tracked separately, each recovered independently, so a WebGPU failure in one
// session can't force the other off WebGPU unnecessarily (MAT-541). det_10g_sim
// previously failed every run (AveragePool ceil_mode unsupported by WebGPU's
// shape computation) — fixed at the source by patching ceil_mode 1→0 on its 3
// AveragePool nodes (verified bit-identical output: this model always sees
// even-dimensioned inputs at those nodes, where ceil/floor rounding agree).
// That fix also incidentally resolved a second bug where w600k_r50_sim threw
// `kernel "[Transpose] Transpose" is not allowed to be called recursively` —
// only ever observed when the detector's WASM fallback recreated a session
// mid-pipeline while the WebGPU ArcFace session was live.
let _detEp: EP | null = null
let _arcEp: EP | null = null
// Kept after init so either session can be recreated on WASM if WebGPU fails at runtime
let _detBuf: ArrayBuffer | null = null
let _arcBuf: ArrayBuffer | null = null

// ── IndexedDB model cache ───────────────────────────────────────────────────

const DB_NAME = 'nashishei-ml'
const STORE = 'models'

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = (e) => (e.target as IDBOpenDBRequest).result.createObjectStore(STORE)
    req.onsuccess = (e) => res((e.target as IDBOpenDBRequest).result)
    req.onerror = () => rej(req.error)
  })
}

async function getFromCache(key: string): Promise<ArrayBuffer | null> {
  const db = await openDb()
  return new Promise((res) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => res((req.result as ArrayBuffer) ?? null)
    req.onerror = () => res(null)
  })
}

async function putToCache(key: string, buf: ArrayBuffer): Promise<void> {
  const db = await openDb()
  return new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(buf, key)
    tx.oncomplete = () => res()
    tx.onerror = () => res()
  })
}

// ── Model fetching with optional progress ───────────────────────────────────

async function loadModel(
  url: string,
  cacheKey: string,
  onProgress?: (pct: number, source: 'cache' | 'network') => void,
): Promise<ArrayBuffer> {
  const cached = await getFromCache(cacheKey)
  if (cached) {
    onProgress?.(100, 'cache')
    return cached
  }
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Model fetch failed: ${url} (${resp.status})`)
  const total = Number(resp.headers.get('content-length') ?? 0)
  const reader = resp.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value!)
    received += value!.length
    if (total > 0) onProgress?.((received / total) * 100, 'network')
  }
  const buf = new Uint8Array(received)
  let off = 0
  for (const c of chunks) { buf.set(c, off); off += c.length }
  const ab = buf.buffer
  await putToCache(cacheKey, ab)
  return ab
}

// ── ort session creation with WebGPU → WASM fallback ───────────────────────

async function createSession(buf: ArrayBuffer, ep: EP): Promise<[ort.InferenceSession, EP]> {
  try {
    return [await ort.InferenceSession.create(buf, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all',
    }), ep]
  } catch (e) {
    if (ep === 'webgpu') {
      console.warn('[ML] WebGPU EP failed, falling back to WASM:', e)
      return [await ort.InferenceSession.create(buf, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }), 'wasm']
    }
    throw e
  }
}

// ── SCRFD face detection (det_10g.onnx) ────────────────────────────────────

const DET_INPUT = 640
const DET_STRIDES = [8, 16, 32]
const DET_NUM_ANCHORS = 2
const SCORE_THRESH = 0.35
const NMS_THRESH = 0.4

interface DetFace {
  bbox: [number, number, number, number]  // x1,y1,x2,y2 in original image pixels
  kps: [number, number][]                 // 5 keypoints in original image pixels
  score: number
}

function generateAnchors(fmH: number, fmW: number, stride: number): Float32Array {
  const out = new Float32Array(fmH * fmW * DET_NUM_ANCHORS * 2)
  let i = 0
  for (let r = 0; r < fmH; r++) {
    for (let c = 0; c < fmW; c++) {
      for (let a = 0; a < DET_NUM_ANCHORS; a++) {
        out[i++] = c * stride
        out[i++] = r * stride
      }
    }
  }
  return out
}

function iou(a: DetFace, b: DetFace): number {
  const ix1 = Math.max(a.bbox[0], b.bbox[0])
  const iy1 = Math.max(a.bbox[1], b.bbox[1])
  const ix2 = Math.min(a.bbox[2], b.bbox[2])
  const iy2 = Math.min(a.bbox[3], b.bbox[3])
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1)
  if (inter === 0) return 0
  const aArea = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1])
  const bArea = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
  return inter / (aArea + bArea - inter)
}

function nms(faces: DetFace[]): DetFace[] {
  faces.sort((a, b) => b.score - a.score)
  const keep: DetFace[] = []
  const suppressed = new Uint8Array(faces.length)
  for (let i = 0; i < faces.length; i++) {
    if (suppressed[i]) continue
    keep.push(faces[i])
    for (let j = i + 1; j < faces.length; j++) {
      if (!suppressed[j] && iou(faces[i], faces[j]) > NMS_THRESH) suppressed[j] = 1
    }
  }
  return keep
}

async function detectFaces(bmp: ImageBitmap): Promise<DetFace[]> {
  if (!_detSession) throw new Error('Detection session not initialized')

  // Use ImageBitmap dimensions — these are EXIF-corrected (unlike img.naturalWidth/Height)
  const W = bmp.width, H = bmp.height
  const imRatio = H / W
  let newW: number, newH: number
  if (imRatio > 1) { newH = DET_INPUT; newW = Math.round(DET_INPUT / imRatio) }
  else             { newW = DET_INPUT; newH = Math.round(DET_INPUT * imRatio) }
  const scale = newH / H

  const canvas = document.createElement('canvas')
  canvas.width = DET_INPUT; canvas.height = DET_INPUT
  const ctx = canvas.getContext('2d')!
  // Black letterbox padding — black (0) normalises to -127.5/128 which is OOD for faces
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, DET_INPUT, DET_INPUT)
  ctx.drawImage(bmp, 0, 0, newW, newH)

  const { data } = ctx.getImageData(0, 0, DET_INPUT, DET_INPUT)
  const N = DET_INPUT * DET_INPUT
  const tensor = new Float32Array(3 * N)
  for (let i = 0; i < N; i++) {
    tensor[i]       = (data[i * 4]     - 127.5) / 128
    tensor[N + i]   = (data[i * 4 + 1] - 127.5) / 128
    tensor[N*2 + i] = (data[i * 4 + 2] - 127.5) / 128
  }

  const feeds: Record<string, ort.Tensor> = {}
  feeds[_detSession.inputNames[0]] = new ort.Tensor('float32', tensor, [1, 3, DET_INPUT, DET_INPUT])
  const outs = await _detSession.run(feeds)
  const outNames = _detSession.outputNames  // [score8,score16,score32, bbox8..., kps8...]

  const candidates: DetFace[] = []
  for (let si = 0; si < DET_STRIDES.length; si++) {
    const stride = DET_STRIDES[si]
    const fmH = Math.ceil(DET_INPUT / stride)
    const fmW = Math.ceil(DET_INPUT / stride)
    const n = fmH * fmW * DET_NUM_ANCHORS

    const scores = outs[outNames[si]].data as Float32Array
    const bboxes = outs[outNames[si + DET_STRIDES.length]].data as Float32Array
    const kpss   = outs[outNames[si + DET_STRIDES.length * 2]].data as Float32Array
    const anchors = generateAnchors(fmH, fmW, stride)

    for (let p = 0; p < n; p++) {
      const score = scores[p]
      if (score < SCORE_THRESH) continue

      const cx = anchors[p * 2], cy = anchors[p * 2 + 1]

      const x1 = Math.max(0, (cx - bboxes[p*4]   * stride) / scale)
      const y1 = Math.max(0, (cy - bboxes[p*4+1] * stride) / scale)
      const x2 = Math.min(W,  (cx + bboxes[p*4+2] * stride) / scale)
      const y2 = Math.min(H,  (cy + bboxes[p*4+3] * stride) / scale)

      const kps: [number, number][] = []
      for (let k = 0; k < 5; k++) {
        kps.push([
          Math.min(W, Math.max(0, (cx + kpss[p*10 + k*2]   * stride) / scale)),
          Math.min(H, Math.max(0, (cy + kpss[p*10 + k*2+1] * stride) / scale)),
        ])
      }
      candidates.push({ bbox: [x1, y1, x2, y2], kps, score })
    }
  }

  return nms(candidates)
}

// ── ArcFace alignment + preprocessing ──────────────────────────────────────

// InsightFace canonical 5-point positions for 112×112 ArcFace input.
// Order matches SCRFD keypoint output: leftEye, rightEye, nose, leftMouth, rightMouth.
const ARCFACE_TEMPLATE: [number, number][] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
]

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
  return [a, b, -b, a, vx - (a * ux - b * uy), vy - (b * ux + a * uy)]
}

function alignAndPreprocess(bmp: ImageBitmap, kps: [number, number][]): Float32Array {
  const canvas = document.createElement('canvas')
  canvas.width = 112; canvas.height = 112
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(...similarityTransform(kps, ARCFACE_TEMPLATE))
  ctx.drawImage(bmp, 0, 0)
  ctx.resetTransform()
  const { data } = ctx.getImageData(0, 0, 112, 112)
  const t = new Float32Array(3 * 112 * 112)
  const P = 112 * 112
  for (let i = 0; i < P; i++) {
    t[i]       = (data[i * 4]     - 127.5) / 128
    t[P + i]   = (data[i * 4 + 1] - 127.5) / 128
    t[P*2 + i] = (data[i * 4 + 2] - 127.5) / 128
  }
  return t
}

// ── Public detect + embed ───────────────────────────────────────────────────

export interface FaceResult {
  bboxNorm: { x: number; y: number; w: number; h: number }
  embedding: number[]
}

async function embedFaces(bmp: ImageBitmap, faces: DetFace[], W: number, H: number): Promise<FaceResult[]> {
  const results: FaceResult[] = []
  for (const face of faces) {
    const [x1, y1, x2, y2] = face.bbox
    const faceData = alignAndPreprocess(bmp, face.kps)
    const feeds: Record<string, ort.Tensor> = {}
    feeds[_arcSession!.inputNames[0]] = new ort.Tensor('float32', faceData, [1, 3, 112, 112])
    const out = await _arcSession!.run(feeds)
    const embedding = Array.from(out[_arcSession!.outputNames[0]].data as Float32Array)
    results.push({
      bboxNorm: { x: x1 / W, y: y1 / H, w: (x2 - x1) / W, h: (y2 - y1) / H },
      embedding,
    })
  }
  return results
}

async function runPipeline(bmp: ImageBitmap, W: number, H: number): Promise<FaceResult[]> {
  let faces: DetFace[]
  try {
    faces = await detectFaces(bmp)
  } catch (e) {
    // Defensive: WebGPU can still fail at run() time for reasons outside our
    // control (driver quirks, unsupported ops in a future model swap). The
    // known ceil_mode cause (MAT-541) is patched at the model level and
    // shouldn't hit this path anymore. Reinitialize only the detector on WASM
    // and retry; ArcFace is a different graph and is recovered independently.
    if (_detEp === 'webgpu' && _detBuf) {
      console.warn('[ML] WebGPU runtime failure on detector, reinitializing detector on WASM (ArcFace unaffected):', (e as Error).message)
      _detSession = await ort.InferenceSession.create(_detBuf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      _detEp = 'wasm'
      faces = await detectFaces(bmp)
    } else {
      throw e
    }
  }
  console.log('[detect] faces found:', faces.length)

  try {
    return await embedFaces(bmp, faces, W, H)
  } catch (e) {
    // Defensive, same as the detector's catch above — MAT-543's Transpose
    // recursion only ever reproduced when the detector's WASM fallback fired
    // mid-pipeline (MAT-541), which no longer happens now that's patched.
    if (_arcEp === 'webgpu' && _arcBuf) {
      console.warn('[ML] WebGPU runtime failure on ArcFace, reinitializing ArcFace on WASM (detector unaffected):', (e as Error).message)
      _arcSession = await ort.InferenceSession.create(_arcBuf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
      _arcEp = 'wasm'
      return await embedFaces(bmp, faces, W, H)
    }
    throw e
  }
}

export async function detectAndEmbed(img: HTMLImageElement): Promise<FaceResult[]> {
  if (!_arcSession || !_detSession) throw new Error('ML not initialized')

  // One bitmap for the whole pipeline — EXIF-corrected dimensions and pixels
  const bmp = await createImageBitmap(img)
  const W = bmp.width, H = bmp.height
  console.log('[detect] img', W, 'x', H)

  try {
    return await runPipeline(bmp, W, H)
  } finally {
    bmp.close()
  }
}

// ── Public init ─────────────────────────────────────────────────────────────

let _initPromise: Promise<EP> | null = null

export function initML(
  onProgress: (pct: number, source: 'cache' | 'network') => void,
): Promise<EP> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    ort.env.wasm.numThreads = 1
    const ep: EP = 'gpu' in navigator ? 'webgpu' : 'wasm'

    // Load both models (ArcFace shows progress; det is small)
    const [arcBuf, detBuf] = await Promise.all([
      loadModel('/models/w600k_r50_sim.onnx', 'w600k_r50_sim', onProgress),
      loadModel('/models/det_10g_sim.onnx',   'det_10g_sim'),
    ])
    // Keep both buffers for WASM re-init if WebGPU fails at runtime
    _detBuf = detBuf
    _arcBuf = arcBuf

    // Create sessions independently — a detector-side runtime failure (MAT-541)
    // must not force ArcFace onto WASM too, so their EPs are tracked separately.
    const [[arcSession, arcChosenEp], [detSession, detChosenEp]] = await Promise.all([
      createSession(arcBuf, ep),
      createSession(detBuf, ep),
    ])
    _arcSession = arcSession
    _detSession = detSession
    _arcEp = arcChosenEp
    _detEp = detChosenEp

    // Warmup ArcFace (small 112×112 — compiles its GPU shaders now so first embed is fast)
    const arcDummy = new ort.Tensor('float32', new Float32Array(3 * 112 * 112), [1, 3, 112, 112])
    const arcFeeds: Record<string, ort.Tensor> = {}
    arcFeeds[_arcSession.inputNames[0]] = arcDummy
    await _arcSession.run(arcFeeds)

    // det (SCRFD 640×640) shaders compile on first real detect — covered by the "Detecting…" spinner
    console.log('[ML] ready, arcEP=', arcChosenEp, 'detEP=', detChosenEp)
    console.log('[ML] det output names:', _detSession.outputNames)
    return arcChosenEp
  })().catch((e) => { _initPromise = null; throw e })
  return _initPromise
}

export function getEP(): EP | null { return _arcEp }
export function getDetEP(): EP | null { return _detEp }
