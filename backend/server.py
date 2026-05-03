from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import cv2
import numpy as np

app = FastAPI(title="Hand Vocoder OpenCV Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/process")
async def process(frame: UploadFile = File(...)) -> Response:
    data = await frame.read()
    np_buffer = np.frombuffer(data, np.uint8)
    image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if image is None:
        return Response(content=b"Invalid image payload", status_code=400)

    # Simple, visible transform for quick verification.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 100, 200)
    rendered = cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR)

    ok, encoded = cv2.imencode(".jpg", rendered)
    if not ok:
        return Response(content=b"Encode failed", status_code=500)
    return Response(content=encoded.tobytes(), media_type="image/jpeg")
