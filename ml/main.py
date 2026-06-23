from fastapi import FastAPI

app = FastAPI(title="nashishei-ml")


@app.get("/health")
def health():
    return {"status": "ok"}
