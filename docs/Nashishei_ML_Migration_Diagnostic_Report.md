# Diagnostic Report: Tauri to Browser-Native ML Migration

**Project:** nàshìshéi (Who Is That?)
**Context:** Transitioning from a Python/InsightFace Tauri sidecar to an in-browser `onnxruntime-web` execution stack using `det_10g.onnx` (SCRFD) and `w600k_r50.onnx` (ArcFace).

---

## 1. Immediate Blocker: `AveragePool` and `ceil_mode` 
**Symptom:** `using ceil() in shape computation is not yet supported for AveragePool`  
**Root Cause:** The WebGPU and WebGL Execution Providers (EPs) in `onnxruntime-web` lack complete ONNX specification support. ResNet-based models like `w600k_r50` rely on average pooling with `ceil_mode=True` at the end of their feature extraction networks, which crashes the WebGPU EP.

### Resolutions:
* **Run the ONNX Simplifier (Primary Fix):**
    Collapse dynamic shape computations into static graphs that the web backend can digest.
    ```bash
    pip install onnx onnxsim
    onnxsim det_10g.onnx det_10g_sim.onnx
    onnxsim w600k_r50.onnx w600k_r50_sim.onnx
    ```
* **Force the WASM Execution Provider (Diagnostic Fallback):**
    The WebAssembly CPU backend has broader operator support. Modify the session creation to bypass WebGPU temporarily:
    ```typescript
    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all'
    });
    ```
* **Evaluate Web-Optimized Embedding Models:**
    If `w600k_r50` remains unstable, consider swapping to **MobileFaceNet** or **WebFace**. These output the same 512-dimensional embeddings but utilize depthwise separable convolutions that WebGPU handles flawlessly, drastically reducing RAM footprints.

---

## 2. Canvas Desynchronization & EXIF Orientation
**Symptom:** Bounding boxes are shifted 90/270 degrees or drift off faces entirely.
**Root Cause:** Phone photos (especially from iPhones) are stored sideways with an EXIF rotation tag. The Python backend (`ImageOps.exif_transpose()`) handled this automatically. HTML5 Canvas does not inherently respect EXIF data when extracting raw pixel arrays for tensor conversion.
**Resolution:** Explicitly read EXIF orientation bits before passing the image to the canvas processing loop, or utilize CSS `image-orientation: from-image` and ensure the derived `ImageData` reflects the corrected layout.

---

## 3. Tensor Shape and Normalization Mismatches
**Symptom:** Shape mismatch errors during `session.run()` or zero face detections on group photos.
**Root Cause:** 1.  **Fixed vs. Dynamic Sizing:** The Python library dynamically updated `input_size` (up to 1920px) per request. Compiled ONNX files typically expect a strict, fixed shape (e.g., `[1, 3, 640, 640]`).
2.  **Pixel Formatting:** MediaPipe accepted raw `ImageData` natively. ONNX requires extracting the flat RGBA array, dropping the Alpha channel, reshaping from HWC (Height-Width-Channel) to CHW (Channel-Height-Width), and applying specific mathematical normalization (mean subtraction and standard deviation division).
**Resolution:** Pad the image (letterboxing) to fit the square ONNX tensor without stretching, ensuring the scaling factors are carefully stored so the absolute coordinates emitted by SCRFD can be mathematically translated back to the UI's normalized (0..1) coordinate space.

---

## 4. Client-Side Non-Maximum Suppression (NMS)
**Symptom:** Hundreds of overlapping bounding boxes per face.
**Root Cause:** The `FaceAnalysis` wrapper in Python handled NMS automatically. Raw `det_10g.onnx` outputs raw feature maps across multiple scales (typically 3 feature strides).
**Resolution:** Resurrect the "Client-side greedy NMS (IoU 0.35)" logic. The raw model output requires manual anchor generation math, softmax scoring, bounding box decoding, and an IoU filtering pass before updating React state.

---

## 5. UI Thread Freezes & iOS Safari Limits
**Symptom:** The browser main thread locks during the "pick → qc" state transition; silent tab crashes on iOS.
**Root Cause:** 1.  Compiling and executing heavy inference passes (especially WebGL/WebGPU) blocks the UI thread.
2.  iOS Safari enforces strict per-tab memory limits. Allocating WebGL textures for massive 1280x1280 tensors will crash the browser.
**Resolution:** * Move the ONNX session initialization and `session.run()` calls into a dedicated **Web Worker**. 
* Cap inference resolution dynamically based on device capabilities (`navigator.hardwareConcurrency` or user-agent sniffing), preserving the critical elder-user touch experience on mobile.

---

## 6. Development Workflow Enhancements
To smooth out this migration within the spec-driven workflow:
* **Custom `/issue` Command:** Draft a bash script for Claude Code that hits the Linear API, fetching the active ticket's acceptance criteria directly into the working context.
* **Strict Design Token Enforcement:** Configure the workspace `.claude.json` to strictly enforce established design tokens (e.g., `--color-overlay-label: rgba(20,20,20,0.92)`), prohibiting raw hex codes to maintain AAA accessibility contrast.
