"""
GeoData local LLM integration.

The backend uses a staged metadata-only analysis pipeline:
1. A deterministic heuristic analysis returns immediately.
2. A slower Ollama text pass can enrich the EXIF review in a second request.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from typing import Any, Literal
from urllib import error, request

from pydantic import BaseModel, Field, ValidationError

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "768"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "320"))
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
DEFAULT_TEXT_MODELS = ("qwen:7b")

_analysis_cache: dict[str, "PrivacyAnalysis"] = {}
_cache_lock = threading.Lock()
_prewarm_lock = threading.Lock()
_prewarm_started = False


class PrivacyAnalysis(BaseModel):
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    risk_score: int = Field(ge=0, le=100)
    summary: str = Field(min_length=1, max_length=420)
    key_findings: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    sensitive_fields: list[str] = Field(default_factory=list)
    attacker_simulation: str = Field(default="", max_length=520)
    model: str = "heuristic"
    provider: str = "heuristic"
    analysis_mode: Literal["heuristic", "ollama"] = "heuristic"
    fallback_reason: str | None = None
    cached: bool = False
    latency_ms: int = 0


def fetch_available_models() -> set[str]:
    req = request.Request(
        f"{OLLAMA_BASE_URL}/api/tags",
        method="GET",
    )

    try:
        with request.urlopen(req, timeout=min(OLLAMA_TIMEOUT_SECONDS, 10)) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, error.URLError, error.HTTPError, TimeoutError, json.JSONDecodeError):
        return set()

    models = body.get("models", [])
    names: set[str] = set()
    for model in models:
        for key in ("name", "model"):
            value = model.get(key)
            if value:
                names.add(str(value))
    return names


def get_active_ollama_model() -> str:
    if OLLAMA_MODEL:
        return OLLAMA_MODEL

    available = fetch_available_models()
    for model_name in DEFAULT_TEXT_MODELS:
        if model_name in available:
            return model_name

    for model_name in sorted(available):
        if "vl" not in model_name.lower() and "vision" not in model_name.lower():
            return model_name

    return DEFAULT_TEXT_MODELS[0]


def is_ollama_model_available(model_name: str | None = None) -> bool:
    target_model = model_name or get_active_ollama_model()
    return target_model in fetch_available_models()


def prewarm_ollama_model_async() -> None:
    global _prewarm_started

    with _prewarm_lock:
        if _prewarm_started:
            return
        _prewarm_started = True

    threading.Thread(target=_prewarm_ollama_model, daemon=True).start()


def _prewarm_ollama_model() -> None:
    model_name = get_active_ollama_model()
    payload = json.dumps(
        {
            "model": model_name,
            "keep_alive": OLLAMA_KEEP_ALIVE,
        }
    ).encode("utf-8")

    req = request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with request.urlopen(req, timeout=max(OLLAMA_TIMEOUT_SECONDS, 45)):
            return
    except (OSError, error.URLError, error.HTTPError, TimeoutError):
        return


def get_cache_key(exif_json: dict[str, Any], model_name: str) -> str:
    canonical = json.dumps(exif_json, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(model_name.encode("utf-8"))
    digest.update(canonical.encode("utf-8"))
    return digest.hexdigest()


def build_initial_analysis(exif_json: dict[str, Any]) -> PrivacyAnalysis:
    return build_heuristic_analysis(exif_json, latency_ms=0, cached=False)


def analyze_exif_with_llm(exif_json: dict[str, Any], image_path: str | None = None) -> PrivacyAnalysis:
    """
    Run the deeper Ollama-backed metadata analysis using the EXIF payload only.
    The optional image_path argument is ignored and kept only for API compatibility.
    """

    del image_path

    model_name = get_active_ollama_model()
    if not is_ollama_model_available(model_name):
        return build_initial_analysis(exif_json).model_copy(
            update={"fallback_reason": "No text-based Ollama model is installed for metadata analysis."}
        )

    cache_key = get_cache_key(exif_json, model_name)

    with _cache_lock:
        cached = _analysis_cache.get(cache_key)

    if cached is not None:
        return cached.model_copy(update={"cached": True, "latency_ms": 0})

    started_at = time.perf_counter()
    heuristic = build_heuristic_analysis(exif_json, latency_ms=0, cached=False)

    try:
        response_text = generate_with_ollama(build_prompt(exif_json), model_name=model_name)
        analysis = parse_analysis_response(response_text, model_name=model_name)
    except (OSError, ValidationError, ValueError, error.URLError, error.HTTPError, TimeoutError):
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        return heuristic.model_copy(
            update={
                "latency_ms": elapsed_ms,
                "fallback_reason": "The AI review failed, so this result only reflects metadata.",
            }
        )

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    enriched = analysis.model_copy(
        update={
            "provider": "ollama",
            "model": model_name,
            "analysis_mode": "ollama",
            "cached": False,
            "latency_ms": elapsed_ms,
        }
    )

    with _cache_lock:
        _analysis_cache[cache_key] = enriched

    return enriched


def generate_with_ollama(prompt: str, model_name: str) -> str:
    payload = json.dumps(
        {
            "model": model_name,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "keep_alive": OLLAMA_KEEP_ALIVE,
            "options": {
                "temperature": 0,
                "top_p": 0.85,
                "num_ctx": OLLAMA_NUM_CTX,
                "num_predict": OLLAMA_NUM_PREDICT,
            },
        }
    ).encode("utf-8")

    req = request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with request.urlopen(req, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
        body = json.loads(response.read().decode("utf-8"))
        return str(body.get("response", "")).strip()


def build_prompt(exif_json: dict[str, Any]) -> str:
    example = {
        "risk_level": "HIGH",
        "risk_score": 84,
        "summary": "The metadata reveals where and when the image was captured, what device produced it, and enough context to link the file to a person, routine, or location.",
        "key_findings": [
            "GPS coordinates reveal the capture location precisely enough to identify a home, workplace, or repeated route.",
            "Camera details identify the device type and can help link multiple uploads to the same source.",
            "Timestamps reveal when the image was captured and can expose routines or travel patterns.",
            "Software metadata may reveal how the file was processed or what device ecosystem it came from.",
        ],
        "recommendations": [
            "Share a sanitized copy instead of the original.",
            "Remove GPS and device metadata before posting.",
            "Avoid posting originals publicly when location data is present.",
        ],
        "sensitive_fields": ["GPSLatitude", "GPSLongitude", "Make", "Model"],
        "attacker_simulation": "An attacker could pinpoint where the image was taken, map the owner’s routine from timestamps, link multiple uploads from the same device, and combine that context with social posts or public maps to identify the owner or predict future movements.",
    }

    compact_exif = json.dumps(exif_json, ensure_ascii=False, separators=(",", ":"))

    return (
        "You audit EXIF privacy risk using metadata only.\n"
        "Return strict JSON only. No markdown. No explanation outside the schema.\n"
        "Do not show reasoning or thinking. Keep it informative and explain the privacy impact clearly.\n"
        "Focus on privacy risk from metadata such as GPS, device identifiers, timestamps, software, and serial numbers.\n"
        "Explain what the metadata can reveal, why it matters, and how it could be misused. Be concrete instead of generic when possible.\n"
        "Write a fuller summary with 2 to 4 sentences, not just one short sentence.\n"
        "Make the attacker simulation specific and realistic. Describe how an attacker could combine the fields together rather than naming the fields only.\n"
        "If metadata is limited, say so briefly instead of inventing details.\n"
        "Constraints: summary <= 360 chars, max 4 key_findings, max 4 recommendations, max 5 sensitive_fields, attacker_simulation <= 420 chars.\n"
        "Schema example:\n"
        f"{json.dumps(example, ensure_ascii=False)}\n"
        f"EXIF:{compact_exif}"
    )


def parse_analysis_response(raw_response: str, model_name: str) -> PrivacyAnalysis:
    cleaned = re.sub(r"<think>.*?</think>", "", raw_response, flags=re.DOTALL | re.IGNORECASE).strip()

    if not cleaned:
        raise ValueError("Empty response from Ollama")

    json_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not json_match:
        raise ValueError("No JSON object found in model response")

    parsed = json.loads(json_match.group(0))
    sanitized = sanitize_model_payload(parsed)
    return PrivacyAnalysis.model_validate(
        {
            **sanitized,
            "provider": "ollama",
            "model": model_name,
            "analysis_mode": "ollama",
        }
    )


def sanitize_model_payload(payload: dict[str, Any]) -> dict[str, Any]:
    risk_level = str(payload.get("risk_level", "MEDIUM")).upper()
    if risk_level not in {"LOW", "MEDIUM", "HIGH"}:
        risk_level = "MEDIUM"

    try:
        risk_score = int(payload.get("risk_score", 50))
    except (TypeError, ValueError):
        risk_score = 50
    risk_score = max(0, min(risk_score, 100))

    summary = compact_text(payload.get("summary"), 360)
    key_findings = compact_list(payload.get("key_findings"), max_items=4, max_chars=160)
    recommendations = compact_list(payload.get("recommendations"), max_items=4, max_chars=140)
    sensitive_fields = compact_list(payload.get("sensitive_fields"), max_items=5, max_chars=32)
    attacker_simulation = compact_text(payload.get("attacker_simulation"), 420)

    if not summary:
        summary = "The metadata contains privacy-relevant details that should be reviewed before sharing."

    if not key_findings:
        key_findings = ["Potentially sensitive metadata is present."]

    if not recommendations:
        recommendations = ["Share a sanitized copy instead of the original."]

    if not attacker_simulation:
        attacker_simulation = "An attacker could use this metadata to infer location, device identity, or temporal patterns about your activities."

    return {
        "risk_level": risk_level,
        "risk_score": risk_score,
        "summary": summary,
        "key_findings": key_findings,
        "recommendations": recommendations,
        "sensitive_fields": sensitive_fields,
        "attacker_simulation": attacker_simulation,
    }


def compact_text(value: Any, max_chars: int) -> str:
    text = str(value or "").strip().replace("\n", " ")
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip(" ,.;:-") + "..."


def compact_list(value: Any, max_items: int, max_chars: int) -> list[str]:
    if not isinstance(value, list):
        return []

    items: list[str] = []
    for item in value:
        compact = compact_text(item, max_chars)
        if compact:
            items.append(compact)
        if len(items) >= max_items:
            break
    return items


def build_heuristic_analysis(exif_json: dict[str, Any], latency_ms: int, cached: bool) -> PrivacyAnalysis:
    sensitive_fields = sorted(
        key
        for key in exif_json.keys()
        if any(
            marker in key
            for marker in ("GPS", "Latitude", "Longitude", "DateTime", "Serial", "Model", "Make", "Software")
        )
    )

    score = 0
    findings: list[str] = []
    recommendations: list[str] = []

    has_gps = bool(exif_json.get("GPSLatitude") or exif_json.get("GPSLongitude"))
    has_camera = bool(exif_json.get("Make") or exif_json.get("Model"))
    has_time = bool(exif_json.get("DateTime") or exif_json.get("DateTimeOriginal"))
    has_software = bool(exif_json.get("Software"))
    has_serial = any("Serial" in key for key in exif_json.keys())
    camera_label = " ".join(part for part in [str(exif_json.get("Make") or "").strip(), str(exif_json.get("Model") or "").strip()] if part).strip()
    timestamp_value = str(exif_json.get("DateTimeOriginal") or exif_json.get("DateTime") or "").strip()
    software_value = str(exif_json.get("Software") or "").strip()

    if has_gps:
        score += 45
        findings.append("Precise GPS metadata is embedded in the file, which can reveal the exact place where the image was captured.")
        recommendations.append("Remove GPS fields before posting or sharing the original.")
        recommendations.append("Do not publish the original file if the image was taken at a home, workplace, school, or another sensitive location.")

    if has_camera:
        score += 20
        if camera_label:
            findings.append(f"Device-identifying camera metadata is present and points to a {camera_label}.")
        else:
            findings.append("Device-identifying camera metadata is present and can help link this file to a specific device type.")
        recommendations.append("Strip camera make and model fields if you do not want uploads linked back to the same device family.")

    if has_time:
        score += 15
        if timestamp_value:
            findings.append(f"Capture timestamps are present ({timestamp_value}) and can reveal routines, travel timing, or when you were at a specific place.")
        else:
            findings.append("Capture timestamps are present and can reveal routines, travel timing, or when you were at a specific place.")
        recommendations.append("Remove capture timestamps when sharing publicly if timing could reveal a routine, event attendance, or travel history.")

    if has_software:
        score += 10
        if software_value:
            findings.append(f"Software metadata is present ({software_value}), which may expose the editing app, device ecosystem, or export workflow.")
        else:
            findings.append("Software metadata is present and may expose the editing app, device ecosystem, or export workflow.")
        recommendations.append("Remove software metadata if you do not want to reveal what app or platform created the file.")

    if has_serial:
        score += 15
        findings.append("Serial-like metadata is present and may uniquely identify the device or lens used to create the image.")
        recommendations.append("Strip serial-number fields from shared copies.")

    score = min(score, 100)

    if score >= 60:
        risk_level = "HIGH"
    elif score >= 30:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    if not findings:
        findings.append("No major privacy-sensitive EXIF fields were detected.")
        findings.append("The available metadata appears limited in this file.")

    if not recommendations:
        recommendations.append("Use a sanitized copy if the image will be posted publicly.")
        recommendations.append("Review the file again after editing or exporting it.")
        recommendations.append("Keep the original private when the image is associated with personal routines, private spaces, or identifiable equipment.")

    exposed_signals: list[str] = []
    if has_gps:
        exposed_signals.append("where the image was taken")
    if has_time:
        exposed_signals.append("when it was captured")
    if has_camera:
        exposed_signals.append("what device was used")
    if has_software:
        exposed_signals.append("what software or ecosystem handled it")
    if has_serial:
        exposed_signals.append("which exact device or lens may have produced it")

    if risk_level == "HIGH":
        summary = (
            "This file exposes multiple strong privacy signals through its metadata, making it possible to infer "
            f"{', '.join(exposed_signals[:-1]) + ', and ' + exposed_signals[-1] if len(exposed_signals) > 1 else exposed_signals[0]}."
            if exposed_signals
            else "This file exposes multiple strong privacy signals through its metadata and should be sanitized before sharing."
        )
    elif risk_level == "MEDIUM":
        summary = (
            "This file contains identifying metadata that could reveal "
            f"{', '.join(exposed_signals[:-1]) + ', and ' + exposed_signals[-1] if len(exposed_signals) > 1 else exposed_signals[0]}."
            if exposed_signals
            else "This file contains identifying metadata and should be reviewed before sharing."
        )
    else:
        summary = "Only limited privacy-sensitive metadata was detected, but the remaining fields can still reveal small pieces of context about the file."

    attacker_parts: list[str] = []
    if has_gps and has_time:
        attacker_parts.append("combine location and time to reconstruct where you were and when")
    elif has_gps:
        attacker_parts.append("use GPS coordinates to pinpoint a home, workplace, school, or recurring route")
    elif has_time:
        attacker_parts.append("use timestamps to infer routines, travel windows, or event attendance")

    if has_camera:
        attacker_parts.append("link multiple uploads together through shared device details")
    if has_software:
        attacker_parts.append("infer what editing workflow or device ecosystem you use")
    if has_serial:
        attacker_parts.append("tie the file back to a uniquely identifying serial-like field")

    if attacker_parts:
        attacker_scenario = (
            "An attacker could "
            + "; ".join(attacker_parts[:-1] + [attacker_parts[-1]])
            + ". This can make it easier to profile your habits, correlate separate posts, or target the same device or location again."
        )
    else:
        attacker_scenario = "Limited metadata is available, reducing the risk of targeted attacks based on EXIF data alone."

    return PrivacyAnalysis(
        risk_level=risk_level,
        risk_score=score,
        summary=compact_text(summary, 320),
        key_findings=findings[:4],
        recommendations=recommendations[:4],
        sensitive_fields=sensitive_fields,
        attacker_simulation=compact_text(attacker_scenario, 420),
        provider="heuristic",
        model="rules-engine",
        analysis_mode="heuristic",
        cached=cached,
        latency_ms=latency_ms,
    )
