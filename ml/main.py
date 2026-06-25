import io
import numpy as np
import insightface
from fastapi import FastAPI, File, UploadFile, HTTPException
from PIL import Image

app = FastAPI(title="nashishei-ml")

_face_app: insightface.app.FaceAnalysis | None = None


def get_face_app() -> insightface.app.FaceAnalysis:
    global _face_app
    if _face_app is None:
        _face_app = insightface.app.FaceAnalysis(name="buffalo_l")
        _face_app.prepare(ctx_id=-1)
    return _face_app


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/detect-and-embed")
async def detect_and_embed(image: UploadFile = File(...)):
    data = await image.read()
    try:
        pil_img = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot decode image")

    img_w, img_h = pil_img.size
    img_array = np.array(pil_img)

    faces = get_face_app().get(img_array)

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
