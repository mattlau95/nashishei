# WebGPU, ONNX, and ArcFace — Plain-Language Explainer

A tutorial for someone who knows code but hasn't worked with in-browser ML models before. Covers the MAT-541 / MAT-543 fix (2026-07-01).

---

## The Building Blocks

- Your app detects faces in a photo, then generates a "fingerprint" (a list of numbers) for each face so the app can tell people apart. Two separate AI models do this:
  - **det_10g** finds the faces (draws boxes around them).
  - **ArcFace** (`w600k_r50`) turns each face into that fingerprint.
- Both models run **in the visitor's browser**, not on a server — that's the whole point of the pivot away from Tauri / a hosted ML server (see [tauri-to-browser-ml-migration.md](tauri-to-browser-ml-migration.md)).
- To run an AI model in a browser, you need two things:
  - The model file itself, in a standard format called **ONNX** — think of it as a portable blueprint for the model's math.
  - A runtime that executes it — this app uses **onnxruntime-web**.
- That runtime can execute a model two ways:
  - **WebGPU** — uses the graphics card, fast.
  - **WASM** — uses the CPU, slower but almost always works.
  - The code tries WebGPU first and is supposed to fall back to WASM if WebGPU can't handle something.

---

## How It Started

In an earlier session, the original (huge, ~180MB) model files were deleted, keeping only smaller "simplified" versions. As a last check before deleting them, the plan was to confirm WebGPU actually worked. It didn't — **every single detection run**, WebGPU choked on one specific operation inside the face-detector model (called `AveragePool`) with an error about a setting called `ceil_mode`, and the code silently fell back to WASM every time. Filed as ticket **MAT-541**.

---

## What Got Done, Step by Step

1. **Noticed a wasteful fallback design.** When the *detector* failed on WebGPU, the code demoted *both* models to WASM — even though the fingerprint model (ArcFace) had nothing to do with the error. Since ArcFace runs once per **face** (could be 100+ per photo) while detection runs once per **photo**, keeping ArcFace fast mattered more. Rewired the code so each model recovers independently — a detector failure no longer drags ArcFace down with it. This was the cheapest option (no new tooling needed), so it went first.

2. **Tested it in a real browser with a real photo.** The rewiring worked as designed — but it exposed a *second*, previously invisible bug: the fingerprint model itself also crashed on WebGPU, with a completely different error. This had never been caught before, because the old code always killed WebGPU for both models the instant the detector failed, before the fingerprint model ever got a real turn to run. Fixed the same way (independent fallback) and filed the newly-found bug as **MAT-543**.

3. At this point, both models still ended up on the slower WASM path every time — just for cleaner, more honest reasons instead of one bug masking another.

4. **Went after the actual root cause instead of just working around it.** The "patch the model file" option had initially been skipped, assuming it needed new Python tooling to be set up. It turned out that tooling (the `onnx` package) was already sitting in an old, unused project folder from a prior phase of the project.

5. **Inspected the actual failing operation.** The `ceil_mode` setting on the detector's `AveragePool` operation only matters when an odd-sized image dimension is involved. The app always resizes photos to a fixed, *even* 640×640 before feeding this model, so that setting was completely irrelevant to how the app actually uses it. Flipped it off.

6. **Proved the fix was safe before shipping it.** Ran both the original and the patched model against the same test data and compared every output number — bit-for-bit identical, every time. Only after that passed was the patched file swapped in for the live model.

7. **Re-tested in the browser, several times.** Both bugs vanished. Detection and fingerprinting now both run on the fast GPU path with no fallback at all, every time.

**Bottom line:** what looked like two separate WebGPU bugs turned out to be one root cause and one masked symptom. Patching a single setting in the detector's model file fixed both — face detection and recognition now genuinely run on the graphics card in the browser, which is the speedup this whole browser-based architecture was supposed to deliver. Both tickets (MAT-541, MAT-543) are closed. The fix is reproducible via `ml/patch_det_ceil_mode.py` if the model ever needs to be regenerated.

---

## Side Question: Does Resizing to 640×640 Mean Some Photos Won't Work?

No image gets rejected because of this. It's not a hard crop or a "must be square" requirement — the code does a **letterbox**: it shrinks (or enlarges) the whole photo, keeping its original proportions, so the longer side fits into 640 pixels, then pads whatever's left over with black bars. A portrait photo gets black bars on the sides; a wide landscape gets them top and bottom. Nothing gets stretched or cut off. This step is only used to find *where* the faces are — see `detectFaces()` in `frontend/src/lib/mlBrowser.ts`.

Two things that can genuinely hurt results:

1. **Big, dense photos with tiny faces.** A 4000×3000 photo of 150 people gets shrunk to fit in 640×640 for the detection step, so each face becomes a much smaller cluster of pixels. If a face was already small in the original (someone far from the camera), it can shrink below the point where the detector can find it at all. Not a hard cutoff — just gradually worse odds as photos get larger/denser. Flagged as a known limitation back in the original feasibility spike ([SPIKE-browser-arcface.md](SPIKE-browser-arcface.md), the "VBS stress case").
2. **Very elongated photos** (e.g. a panorama) — most of the 640×640 canvas ends up as black padding, so the useful image area is smaller than for a normally-proportioned photo.

**Not a problem:** once a face is found, the fingerprint step (ArcFace) crops that face out of the **original, full-resolution photo** — not the shrunk 640×640 version — so recognition quality isn't affected by this resize at all. Only the "can we find the face in the first place" step uses the shrunk image.
