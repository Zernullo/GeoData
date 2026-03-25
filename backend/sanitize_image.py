from fastapi import APIRouter, UploadFile, File, Response
from fastapi.responses import StreamingResponse
from PIL import Image
import io

router = APIRouter()

@router.post("/sanitize-image")
def sanitize_image(file: UploadFile = File(...)):
    # Open the uploaded image
    image = Image.open(file.file)
    # Save to a new BytesIO buffer with no EXIF
    buf = io.BytesIO()
    # Remove EXIF by not passing exif param
    image.save(buf, format=image.format)
    buf.seek(0)
    # Set correct content type
    return StreamingResponse(buf, media_type=file.content_type, headers={
        "Content-Disposition": f"attachment; filename=\"sanitized_{file.filename}\""
    })
