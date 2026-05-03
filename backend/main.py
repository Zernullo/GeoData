"""
GeoData backend API.

The API is intentionally staged for responsiveness:
- extraction endpoints return fast EXIF + heuristic risk analysis
- a separate enrichment endpoint runs the slower local metadata model
"""

from __future__ import annotations

import io
import json
import os
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from PIL import Image

from extract_exif import analyze_image, extract_exif
from local_LLM import (
    OLLAMA_BASE_URL,
    PrivacyAnalysis,
    VisualPrivacyAnalysis,
    analyze_image_privacy_with_vision,
    analyze_exif_with_llm,
    build_initial_analysis,
    get_active_ollama_model,
    get_active_vision_model,
    is_ollama_model_available,
    is_vision_model_available,
    merge_privacy_analyses,
    prewarm_ollama_model_async,
)
from sanitize_image import router as sanitize_router

# ==============================================================================
# Configuration Constants
# ==============================================================================

# EXIF field priority order for truncation
PRIORITY_EXIF_KEYS = [
    "Make",
    "Model",
    "DateTime",
    "DateTimeOriginal",
    "Software",
    "GPSLatitude",
    "GPSLongitude",
    "GPSLatitudeRef",
    "GPSLongitudeRef",
    "GPSAltitude",
    "GPSTimestamp",
    "GPSDateStamp",
    "SerialNumber",
    "LensSerialNumber",
]

# String truncation limits for EXIF model values
EXIF_VALUE_TRUNCATION = {
    "list_item_max": 4,  # max items in a list to preserve
    "dict_entry_max": 4,  # max entries in a dict to preserve
    "string_max": 80,  # max characters for string values
}

# Default filename for uploaded images
DEFAULT_UPLOAD_FILENAME = "upload-image"

# Maximum number of EXIF fields to include in analysis
MAX_EXIF_FIELDS_FOR_ANALYSIS = 10

# CORS configuration
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")

app = FastAPI(title="GeoData API", version="1.2.0")


def resolve_images_dir() -> Path:
    backend_dir = Path(__file__).parent
    candidates = [
        backend_dir / "Images" / "control",
        backend_dir / "images" / "control",
    ]

    for candidate in candidates:
        if candidate.exists():
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate

    preferred = candidates[0]
    preferred.mkdir(parents=True, exist_ok=True)
    return preferred


IMAGES_DIR = resolve_images_dir()


def elapsed_millis(started_at: float) -> int:
    return int((time.perf_counter() - started_at) * 1000)


def build_extract_payload(saved_path: Path, result: dict[str, Any]) -> ExtractExifPayload:
    raw_exif = result.get("raw_exif", {})
    return ExtractExifPayload.model_validate(
        {
            "image_path": str(saved_path.resolve()),
            **result,
            "raw_exif": raw_exif,
            "total_tags": len(raw_exif),
        }
    )


def build_rapid_analysis(exif_data: dict[str, Any], latency_ms: int) -> PrivacyAnalysis:
    return build_initial_analysis(truncate_exif_data(exif_data)).model_copy(update={"latency_ms": latency_ms})


def build_rapid_pipeline(extract_ms: int) -> PipelineMeta:
    return PipelineMeta(extract_ms=extract_ms, analysis_pending=True, profile="rapid")


@app.on_event("startup")
async def warm_llm_model() -> None:
    prewarm_ollama_model_async()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PipelineMeta(BaseModel):
    extract_ms: int = Field(ge=0)
    analysis_pending: bool
    profile: Literal["rapid", "deep"]


class AnalysisMeta(BaseModel):
    duration_ms: int = Field(ge=0)
    cached: bool = False
    profile: Literal["rapid", "deep"] = "deep"


class ExifJsonPayload(BaseModel):
    image_path: str
    total_tags: int = Field(ge=0)
    exif_data: dict[str, Any]


class ExtractExifPayload(BaseModel):
    image_path: str
    camera_make: str | None = None
    camera_model: str | None = None
    datetime: str | None = None
    software: str | None = None
    gps: dict[str, float] | None = None
    raw_exif: dict[str, Any]
    total_tags: int = Field(ge=0)


class ExtractExifResponse(BaseModel):
    success: bool
    filename: str | None = None
    data: ExtractExifPayload | None = None
    llm_analysis: PrivacyAnalysis | None = None
    pipeline: PipelineMeta | None = None
    error: str | None = None


class ExtractExifJsonResponse(BaseModel):
    success: bool
    filename: str | None = None
    json_file: str | None = None
    json_path: str | None = None
    data: ExifJsonPayload | None = None
    llm_analysis: PrivacyAnalysis | None = None
    pipeline: PipelineMeta | None = None
    error: str | None = None


class AnalyzeExifRequest(BaseModel):
    exif_data: dict[str, Any]
    image_path: str | None = None
    profile: Literal["rapid", "deep"] = "deep"


class AnalyzeExifResponse(BaseModel):
    success: bool
    llm_analysis: PrivacyAnalysis | None = None
    visual_analysis: VisualPrivacyAnalysis | None = None
    combined_analysis: PrivacyAnalysis | None = None
    meta: AnalysisMeta | None = None
    error: str | None = None


class LlmHealthResponse(BaseModel):
    available: bool
    model: str
    base_url: str
    recommended_profile: Literal["rapid", "deep"] = "deep"
    text_available: bool = False
    text_model: str
    vision_available: bool = False
    vision_model: str


def safe_filename(name: str | None) -> str:
    return Path(name or DEFAULT_UPLOAD_FILENAME).name


async def save_upload(file: UploadFile) -> Path:
    filename = safe_filename(file.filename)
    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    target_path = IMAGES_DIR / filename
    with open(target_path, "wb") as output_file:
        output_file.write(contents)

    return target_path


@app.post("/api/preview-image")
async def preview_image(file: UploadFile = File(...)) -> StreamingResponse:
    try:
        source_image = Image.open(file.file)
        source_image.load()
    except Exception as exc:  # pragma: no cover - file parsing guard
        raise HTTPException(status_code=400, detail=f"Unable to read image: {exc}") from exc

    preview_image = source_image.convert("RGBA") if source_image.mode not in ("RGB", "L", "RGBA") else source_image.copy()

    buffer = io.BytesIO()
    preview_image.save(buffer, format="PNG")
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="preview-{safe_filename(file.filename)}.png"'},
    )


def truncate_exif_data(exif_dict: dict[str, Any], max_fields: int | None = None) -> dict[str, Any]:
    if max_fields is None:
        max_fields = MAX_EXIF_FIELDS_FOR_ANALYSIS

    truncated: dict[str, Any] = {}

    for key in PRIORITY_EXIF_KEYS:
        if key in exif_dict:
            truncated[key] = stringify_model_value(exif_dict[key])

    if len(truncated) < max_fields:
        for key, value in exif_dict.items():
            if key in truncated:
                continue
            truncated[key] = stringify_model_value(value)
            if len(truncated) >= max_fields:
                break

    return truncated


def stringify_model_value(value: Any) -> Any:
    if isinstance(value, list):
        return [stringify_model_value(item) for item in value[: EXIF_VALUE_TRUNCATION["list_item_max"]]]
    if isinstance(value, dict):
        return {
            str(key): stringify_model_value(item)
            for key, item in list(value.items())[: EXIF_VALUE_TRUNCATION["dict_entry_max"]]
        }
    if isinstance(value, str):
        return value[: EXIF_VALUE_TRUNCATION["string_max"]]
    return value


def build_json_payload(image_path: Path, output_filename: str) -> ExifJsonPayload:
    json_output_path = IMAGES_DIR / safe_filename(output_filename)
    exif_data = extract_exif(str(image_path), str(json_output_path))

    with open(json_output_path, "r", encoding="utf-8") as json_file:
        payload = json.load(json_file)

    payload["exif_data"] = exif_data
    payload["total_tags"] = len(exif_data)
    return ExifJsonPayload.model_validate(payload)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "GeoData API is running"}


@app.get("/api/health/llm", response_model=LlmHealthResponse)
def llm_health() -> LlmHealthResponse:
    active_model = get_active_ollama_model()
    active_vision_model = get_active_vision_model()
    text_available = is_ollama_model_available(active_model)
    vision_available = is_vision_model_available(active_vision_model)

    if text_available or vision_available:
        prewarm_ollama_model_async()

    return LlmHealthResponse(
        available=text_available,
        model=active_model,
        base_url=OLLAMA_BASE_URL,
        text_available=text_available,
        text_model=active_model,
        vision_available=vision_available,
        vision_model=active_vision_model,
    )


@app.post("/api/analyze-exif", response_model=AnalyzeExifResponse)
def analyze_exif_endpoint(request_body: AnalyzeExifRequest) -> AnalyzeExifResponse:
    try:
        if not request_body.exif_data and not request_body.image_path:
            return AnalyzeExifResponse(
                success=False,
                error="No metadata or image path found for AI analysis.",
            )

        model_input = truncate_exif_data(request_body.exif_data or {})
        if request_body.profile == "rapid":
            analysis = build_initial_analysis(model_input)
            visual_analysis = None
            combined_analysis = analysis
        else:
            analysis = analyze_exif_with_llm(model_input, request_body.image_path)
            visual_analysis = analyze_image_privacy_with_vision(request_body.image_path)
            combined_analysis = merge_privacy_analyses(analysis, visual_analysis)

        return AnalyzeExifResponse(
            success=True,
            llm_analysis=analysis,
            visual_analysis=visual_analysis,
            combined_analysis=combined_analysis,
            meta=AnalysisMeta(
                duration_ms=combined_analysis.latency_ms,
                cached=combined_analysis.cached,
                profile=request_body.profile,
            ),
        )
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return AnalyzeExifResponse(success=False, error=str(exc))


@app.post("/api/extract-exif", response_model=ExtractExifResponse)
async def extract_exif_endpoint(file: UploadFile = File(...)) -> ExtractExifResponse:
    started_at = time.perf_counter()

    try:
        saved_path = await save_upload(file)
        result = analyze_image(saved_path)
        payload = build_extract_payload(saved_path, result)
        elapsed_ms = elapsed_millis(started_at)

        return ExtractExifResponse(
            success=True,
            filename=safe_filename(file.filename),
            data=payload,
            llm_analysis=build_rapid_analysis(payload.raw_exif, elapsed_ms),
            pipeline=build_rapid_pipeline(elapsed_ms),
        )
    except HTTPException as exc:
        return ExtractExifResponse(success=False, error=exc.detail)
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return ExtractExifResponse(success=False, error=str(exc))


@app.post("/api/extract-exif-json", response_model=ExtractExifJsonResponse)
async def extract_exif_json_endpoint(
    file: UploadFile = File(...),
    output_filename: str = "exif_data.json",
) -> ExtractExifJsonResponse:
    started_at = time.perf_counter()

    try:
        saved_path = await save_upload(file)
        payload = build_json_payload(saved_path, output_filename)
        elapsed_ms = elapsed_millis(started_at)

        return ExtractExifJsonResponse(
            success=True,
            filename=safe_filename(file.filename),
            json_file=safe_filename(output_filename),
            json_path=str(IMAGES_DIR / safe_filename(output_filename)),
            data=payload,
            llm_analysis=build_rapid_analysis(payload.exif_data, elapsed_ms),
            pipeline=build_rapid_pipeline(elapsed_ms),
        )
    except HTTPException as exc:
        return ExtractExifJsonResponse(success=False, error=exc.detail)
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return ExtractExifJsonResponse(success=False, error=str(exc))


app.include_router(sanitize_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
