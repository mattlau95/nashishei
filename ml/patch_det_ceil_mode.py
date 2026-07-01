"""Patch det_10g_sim.onnx's AveragePool ceil_mode 1 -> 0 (MAT-541).

onnxruntime-web's WebGPU backend can't compute shapes for AveragePool nodes
with ceil_mode=1 ("using ceil() in shape computation is not yet supported").
ceil_mode only changes output shape when the pooling input dimension is odd;
this model is always fed a fixed 640x640 input (frontend/src/lib/mlBrowser.ts,
DET_INPUT), and every tensor reaching these 3 nodes is even at that input size
(160, 80, 40), so floor and ceil rounding agree and flipping the attribute is
a no-op for this app's real usage. Verified in the 2026-07-01 session: patched
output was bit-for-bit identical to the original across 3 random-input trials.

Run from ml/ with the venv active: python patch_det_ceil_mode.py
"""

import onnx
import onnxruntime as ort
import numpy as np

SRC = "../frontend/public/models/det_10g_sim.onnx"
BACKUP = "../frontend/public/models/det_10g_sim.PRE_MAT541_BACKUP.onnx"

m = onnx.load(SRC)
patched = 0
for n in m.graph.node:
    if n.op_type == "AveragePool":
        for a in n.attribute:
            if a.name == "ceil_mode" and a.i == 1:
                a.i = 0
                patched += 1
                print(f"patched {n.name}: ceil_mode 1 -> 0")

if patched == 0:
    print("no ceil_mode=1 AveragePool nodes found — already patched?")
    raise SystemExit(0)

onnx.checker.check_model(m)

import shutil
shutil.copy(SRC, BACKUP)
print(f"backed up original to {BACKUP}")

patched_bytes = m.SerializeToString()

# Verify bit-identical output vs the pre-patch model before overwriting it.
sess_orig = ort.InferenceSession(BACKUP, providers=["CPUExecutionProvider"])
sess_patched = ort.InferenceSession(patched_bytes, providers=["CPUExecutionProvider"])
inp_name = sess_orig.get_inputs()[0].name
out_names = [o.name for o in sess_orig.get_outputs()]

rng = np.random.default_rng(42)
for trial in range(3):
    x = rng.normal(0, 1, size=(1, 3, 640, 640)).astype(np.float32)
    out_orig = sess_orig.run(out_names, {inp_name: x})
    out_patched = sess_patched.run(out_names, {inp_name: x})
    for name, o1, o2 in zip(out_names, out_orig, out_patched):
        if not np.array_equal(o1, o2):
            raise SystemExit(f"MISMATCH on trial {trial}, output {name} — not overwriting {SRC}")

onnx.save(m, SRC)
print(f"verified bit-identical output; wrote patched model to {SRC}")
