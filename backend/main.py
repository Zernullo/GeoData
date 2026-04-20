"""
GeoData backend API.

The API is intentionally staged for responsiveness:
- extraction endpoints return fast EXIF + heuristic risk analysis
- a separate enrichment endpoint runs the slower local metadata model
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from extract_exif import analyze_image, extract_exif
from local_LLM import (
    OLLAMA_BASE_URL,
    PrivacyAnalysis,
    analyze_exif_with_llm,
    build_initial_analysis,
    get_active_ollama_model,
    is_ollama_model_available,
    prewarm_ollama_model_async,
)
from sanitize_image import router as sanitize_router

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


@app.on_event("startup")
async def warm_llm_model() -> None:
    prewarm_ollama_model_async()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
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
    meta: AnalysisMeta | None = None
    error: str | None = None


class LlmHealthResponse(BaseModel):
    available: bool
    model: str
    base_url: str
    recommended_profile: Literal["rapid", "deep"] = "deep"


def safe_filename(name: str | None) -> str:
    return Path(name or "upload-image").name


async def save_upload(file: UploadFile) -> Path:
    filename = safe_filename(file.filename)
    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    target_path = IMAGES_DIR / filename
    with open(target_path, "wb") as output_file:
        output_file.write(contents)

    return target_path


def truncate_exif_data(exif_dict: dict[str, Any], max_fields: int = 10) -> dict[str, Any]:
    priority_keys = [
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

    truncated: dict[str, Any] = {}

    for key in priority_keys:
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
        return [stringify_model_value(item) for item in value[:4]]
    if isinstance(value, dict):
        return {str(key): stringify_model_value(item) for key, item in list(value.items())[:4]}
    if isinstance(value, str):
        return value[:80]
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
    if is_ollama_model_available(active_model):
        prewarm_ollama_model_async()

    return LlmHealthResponse(
        available=is_ollama_model_available(active_model),
        model=active_model,
        base_url=OLLAMA_BASE_URL,
    )


@app.post("/api/analyze-exif", response_model=AnalyzeExifResponse)
def analyze_exif_endpoint(request_body: AnalyzeExifRequest) -> AnalyzeExifResponse:
    try:
        if not request_body.exif_data:
            return AnalyzeExifResponse(
                success=False,
                error="No metadata found for AI analysis.",
            )

        model_input = truncate_exif_data(request_body.exif_data)
        if request_body.profile == "rapid":
            analysis = build_initial_analysis(model_input)
        else:
            analysis = analyze_exif_with_llm(model_input)

        return AnalyzeExifResponse(
            success=True,
            llm_analysis=analysis,
            meta=AnalysisMeta(
                duration_ms=analysis.latency_ms,
                cached=analysis.cached,
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
        raw_exif = result.get("raw_exif", {})
        payload = ExtractExifPayload.model_validate(
            {
                "image_path": str(saved_path.resolve()),
                **result,
                "raw_exif": raw_exif,
                "total_tags": len(raw_exif),
            }
        )
        heuristic = build_initial_analysis(truncate_exif_data(raw_exif))
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)

        return ExtractExifResponse(
            success=True,
            filename=safe_filename(file.filename),
            data=payload,
            llm_analysis=heuristic.model_copy(update={"latency_ms": elapsed_ms}),
            pipeline=PipelineMeta(extract_ms=elapsed_ms, analysis_pending=True, profile="rapid"),
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
        heuristic = build_initial_analysis(truncate_exif_data(payload.exif_data))
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)

        return ExtractExifJsonResponse(
            success=True,
            filename=safe_filename(file.filename),
            json_file=safe_filename(output_filename),
            json_path=str(IMAGES_DIR / safe_filename(output_filename)),
            data=payload,
            llm_analysis=heuristic.model_copy(update={"latency_ms": elapsed_ms}),
            pipeline=PipelineMeta(extract_ms=elapsed_ms, analysis_pending=True, profile="rapid"),
        )
    except HTTPException as exc:
        return ExtractExifJsonResponse(success=False, error=exc.detail)
    except Exception as exc:  # pragma: no cover - defensive API fallback
        return ExtractExifJsonResponse(success=False, error=str(exc))


app.include_router(sanitize_router, prefix="/api")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
