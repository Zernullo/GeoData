"""
Image sanitization endpoint.

Creates a clean copy of the uploaded image without carrying forward EXIF or
format-specific metadata blocks.
"""

from __future__ import annotations

import io

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from PIL import Image

router = APIRouter()

FORMAT_TO_MEDIA_TYPE = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "TIFF": "image/tiff",
    "WEBP": "image/webp",
    "BMP": "image/bmp",
    "GIF": "image/gif",
}


def clone_pixels_only(image: Image.Image) -> Image.Image:
    clean_image = Image.new(image.mode, image.size)
    clean_image.putdata(list(image.getdata()))
    return clean_image


@router.post("/sanitize-image")
def sanitize_image(file: UploadFile = File(...)) -> StreamingResponse:
    try:
        source_image = Image.open(file.file)
        source_image.load()
    except Exception as exc:  # pragma: no cover - file parsing guard
        raise HTTPException(status_code=400, detail=f"Unable to read image: {exc}") from exc

    output_format = (source_image.format or "PNG").upper()
    clean_image = clone_pixels_only(source_image)

    if output_format == "JPG":
        output_format = "JPEG"

    if output_format == "JPEG" and clean_image.mode not in ("RGB", "L"):
        clean_image = clean_image.convert("RGB")

    buffer = io.BytesIO()
    clean_image.save(buffer, format=output_format)
    buffer.seek(0)

    media_type = FORMAT_TO_MEDIA_TYPE.get(output_format, file.content_type or "application/octet-stream")

    return StreamingResponse(
        buffer,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="sanitized-{file.filename}"'},
    )
