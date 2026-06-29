# SPIKE — Browser ArcFace viability (onnxruntime-web)

**Type:** Spike · **Timebox:** ~1 day · **Owner:** Claude Code
**Output:** go/no-go decision + DEVLOG entry + a throwaway demo page

---

## Why this exists

We want recognition (ArcFace embeddings) to run **in the author's browser**, not
on a rented ML server. If this works, the cloud shrinks to Postgres + Go API +
object storage (~$5–15/mo, no ML RAM) and the **Tauri desktop pivot is
unnecessary** — Nashishei stays a pure web app, authoring and viewing both in the
browser, one codebase.

This spike proves the one fact everything rides on: **can we generate a usable
512-dim face embedding in a browser tab at acceptable speed?**

## What the recon already settled (so don't re-litigate)

- **No ONNX export needed.** InsightFace ships recognition models *already in
  ONNX* (the `buffalo_l` / `w600k_r50` recognition model). Input: cropped RGB
  face, 112×112, normalized `(px - 127.5) / 128.0`. Output: 512-dim embedding.
- **Runtime exists:** `onnxruntime-web` runs ONNX in-browser. Execution
  providers: `webgpu` (fast, Chrome/Edge default; Firefox shipping; Safari
  trailing) and `wasm` (universal fallback, slower).
- **Detection is already browser-side** in Phase 1 (MediaPipe). This spike is
  ONLY about the recognition/embedding step.

## ⚠️ License flag (surface to Matthew, do not bury)

InsightFace's pretrained models (`buffalo_l` etc.) are licensed **non-commercial
research only**. Fine for a private church project. **Not** fine if Nashishei
ever ships as a product. If commercial use is ever on the table, we need a
differently-licensed recognition model. Note it; don't let it block the spike.

---

## Build (throwaway — this is a spike, not production code)

A single static page or minimal Vite route that:

1. Loads the ArcFace ONNX model via `onnxruntime-web`.
2. Detects WebGPU (`'gpu' in navigator`); uses `webgpu` EP, falls back to `wasm`.
3. Takes a test group photo, runs the **existing MediaPipe** detection to get
   face boxes, crops + aligns each to 112×112, preprocesses, and runs ArcFace
   per face to get embeddings.
4. Sanity-checks the embeddings: same person across two photos → high cosine
   similarity; different people → low. (Prove the vectors are real, not noise.)
5. Logs timing: model load time, and per-face + total embedding time.

```js
// EP selection — the golden rule: detect, don't assume
const ep = ('gpu' in navigator) ? 'webgpu' : 'wasm';
const session = await ort.InferenceSession.create('/models/arcface.onnx', {
  executionProviders: [ep],
  graphOptimizationLevel: 'all',
});
// warmup run before timing (compiles pipelines)
```

## Things that will bite (pre-flagged so they don't eat the timebox)

- **COOP/COEP headers.** WASM multithreading needs
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Set them on the dev server or
  WASM silently falls back to single-thread (slow). This bites everyone once.
- **Model caching.** The model is tens of MB. Cache it (Cache API / IndexedDB)
  so it downloads once, not every load. Show a progress UI on first fetch.
- **Preprocessing must match exactly.** RGB order, 112×112, `(x-127.5)/128.0`.
  Wrong normalization → garbage embeddings that *look* plausible. The
  same-person/different-person cosine test is how you catch this.
- **The VBS stress case (150–200 faces).** A tab gets a few GB, not the whole
  machine. Don't benchmark only on a 10-face photo. Run a dense one and watch
  memory. Batching/streaming crops softens it. §10 already says recognition
  degrades on tiny crops regardless — set expectations, don't chase perfection.

## Acceptance criteria

- [ ] ArcFace ONNX loads and runs in-browser via `onnxruntime-web`.
- [ ] WebGPU path works on Chrome/Edge; **graceful WASM fallback** verified
      (test by forcing `wasm`).
- [ ] Embeddings are real: same-person cosine clearly higher than
      different-person, on actual test faces.
- [ ] Timing recorded for both EPs on: (a) a ~20-face photo, (b) a dense
      ~100+-face photo.
- [ ] Memory behavior on the dense photo noted (does the tab survive?).
- [ ] Model caches after first load (second load doesn't re-download).
- [ ] **Decision recorded in DEVLOG:** browser ArcFace is viable →
      kill the Tauri pivot and keep recognition client-side in the web app;
      OR it's too slow/heavy → fall back to hosted ML (or Tauri local sidecar).

## Out of scope

- pgvector / similarity search wiring (that's cloud-side, separate, cheap).
- Production UI, error states, model-swap for licensing.
- Detection changes (MediaPipe stays as-is for Phase 1).
- Anything past "prove the embedding works in a tab."

## Decision this unblocks

If **viable**: revert §6 to the pure-web architecture, drop the two Tauri spikes
and all signing costs, add recognition to the browser. If **not**: the desktop
pivot (or a hosted ML tier) is back on the table, and we pick based on the
timing/memory numbers this spike produced.
