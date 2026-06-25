import io
import numpy as np
import insightface
from fastapi import FastAPI, File, UploadFile, HTTPException
from PIL import Image, ImageOps

app = FastAPI(title="nashishei-ml")

_face_app: insightface.app.FaceAnalysis | None = None


def get_face_app() -> insightface.app.FaceAnalysis:
    global _face_app
    if _face_app is None:
        _face_app = insightface.app.FaceAnalysis(name="buffalo_l")
        _face_app.prepare(ctx_id=-1, det_size=(1280, 1280))
    return _face_app


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/detect-and-embed")
async def detect_and_embed(image: UploadFile = File(...)):
    data = await image.read()
    try:
        pil_img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot decode image")

    img_w, img_h = pil_img.size
    # InsightFace expects BGR
    img_array = np.array(pil_img)[:, :, ::-1]

    face_app = get_face_app()
    # Dynamically set detection size to match the image (rounded to 32, capped at 1920)
    det_w = min(1920, (img_w + 31) // 32 * 32)
    det_h = min(1920, (img_h + 31) // 32 * 32)
    face_app.models['detection'].input_size = (det_w, det_h)
    faces = face_app.get(img_array)

    print(f"image {img_w}x{img_h} det_size=({det_w},{det_h}) found {len(faces)} face(s)", flush=True)
    for i, f in enumerate(faces):
        print(f"  face {i}: bbox={f.bbox.tolist()} det_score={getattr(f, 'det_score', '?')}", flush=True)

    result = []
    for face in faces:
        x1, y1, x2, y2 = face.bbox
        bbox_x = max(0.0, min(1.0, float(x1) / img_w))
        bbox_y = max(0.0, min(1.0, float(y1) / img_h))
        bbox_w = max(0.0, min(1.0, float(x2 - x1) / img_w))
        bbox_h = max(0.0, min(1.0, float(y2 - y1) / img_h))
        embedding = face.embedding.tolist()
        result.append(
            {
                "bbox_x": bbox_x,
                "bbox_y": bbox_y,
                "bbox_w": bbox_w,
                "bbox_h": bbox_h,
                "embedding": embedding,
            }
        )

    return {"faces": result}
