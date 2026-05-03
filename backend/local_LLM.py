"""
GeoData local LLM integration.

The backend uses a staged privacy-analysis pipeline:
1. A deterministic heuristic analysis returns immediately from EXIF.
2. A slower Ollama text pass enriches the EXIF review.
3. An optional Ollama vision pass inspects visible privacy leaks in the image.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Literal
from urllib import error, request

from pydantic import BaseModel, Field, ValidationError

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "")
OLLAMA_VISION_MODEL = os.getenv("OLLAMA_VISION_MODEL", "")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))
OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "768"))
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "320"))
OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m")
DEFAULT_TEXT_MODELS = ("gemma3:4b",)
DEFAULT_VISION_MODELS = ("gemma3:4b", "llava:7b", "llava:13b")

# Analysis payload constraints (field limits and character limits)
ANALYSIS_CONSTRAINTS = {
    # No truncation for `summary` and `attacker_simulation` (None = keep full LLM output)
    "summary_max_chars": None,
    "attacker_simulation_max_chars": None,
    "key_findings_max_items": 4,
    "key_findings_max_chars": 160,
    "recommendations_max_items": 4,
    "recommendations_max_chars": 140,
    "sensitive_fields_max_items": 5,
    "sensitive_fields_max_chars": 32,
    "exposed_elements_max_items": 5,
    "exposed_elements_max_chars": 40,
}

# Risk scoring constants for heuristic analysis
RISK_SCORE_WEIGHTS = {
    "gps": 45,
    "camera": 20,
    "timestamp": 15,
    "software": 10,
    "serial": 15,
}

# Risk level thresholds
RISK_LEVEL_THRESHOLDS = {
    "high": 60,
    "medium": 30,
}

_analysis_cache: dict[str, "PrivacyAnalysis | VisualPrivacyAnalysis"] = {}
_cache_lock = threading.Lock()
_prewarm_lock = threading.Lock()
_prewarm_started = False

OLLAMA_JSON_HEADERS = {"Content-Type": "application/json"}
THINK_TAG_PATTERN = re.compile(r"<think>.*?</think>", flags=re.DOTALL | re.IGNORECASE)


class PrivacyAnalysis(BaseModel):
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    risk_score: int = Field(ge=0, le=100)
    # Allow full LLM summary text (no hard max length enforced here)
    summary: str = Field(min_length=1)
    key_findings: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    sensitive_fields: list[str] = Field(default_factory=list)
    # Allow full attacker simulation prose
    attacker_simulation: str = Field(default="")
    model: str = "heuristic"
    provider: str = "heuristic"
    analysis_mode: Literal["heuristic", "ollama", "hybrid"] = "heuristic"
    fallback_reason: str | None = None
    cached: bool = False
    latency_ms: int = 0


class VisualPrivacyAnalysis(BaseModel):
    risk_level: Literal["LOW", "MEDIUM", "HIGH"]
    risk_score: int = Field(ge=0, le=100)
    # Allow full LLM visual summary text
    summary: str = Field(min_length=1)
    key_findings: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    exposed_elements: list[str] = Field(default_factory=list)
    # Allow full attacker simulation prose
    attacker_simulation: str = Field(default="")
    model: str = "vision-unavailable"
    provider: str = "heuristic"
    analysis_mode: Literal["vision", "unavailable"] = "unavailable"
    fallback_reason: str | None = None
    cached: bool = False
    latency_ms: int = 0


class HeuristicContext(BaseModel):
    has_gps: bool
    has_camera: bool
    has_time: bool
    has_software: bool
    has_serial: bool
    camera_label: str = ""
    timestamp_value: str = ""
    software_value: str = ""


def fetch_available_models() -> set[str]:
    try:
        body = send_ollama_request("/api/tags", method="GET", timeout=min(OLLAMA_TIMEOUT_SECONDS, 10))
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

    return select_available_model(
        preferred_models=DEFAULT_TEXT_MODELS,
        fallback_models=fetch_available_models(),
        matcher=lambda lowered: "vl" not in lowered and "vision" not in lowered and "llava" not in lowered,
        default_model=DEFAULT_TEXT_MODELS[0],
    )


def get_active_vision_model() -> str:
    if OLLAMA_VISION_MODEL:
        return OLLAMA_VISION_MODEL

    return select_available_model(
        preferred_models=DEFAULT_VISION_MODELS,
        fallback_models=fetch_available_models(),
        matcher=lambda lowered: any(marker in lowered for marker in ("vision", "vl", "llava", "gemma3")),
        default_model=DEFAULT_VISION_MODELS[0],
    )


def is_ollama_model_available(model_name: str | None = None) -> bool:
    target_model = model_name or get_active_ollama_model()
    return target_model in fetch_available_models()


def is_vision_model_available(model_name: str | None = None) -> bool:
    target_model = model_name or get_active_vision_model()
    return target_model in fetch_available_models()


def prewarm_ollama_model_async() -> None:
    global _prewarm_started

    with _prewarm_lock:
        if _prewarm_started:
            return
        _prewarm_started = True

    threading.Thread(target=_prewarm_ollama_model, daemon=True).start()


def _prewarm_ollama_model() -> None:
    for model_name in [get_active_ollama_model(), get_active_vision_model()]:
        try:
            send_ollama_request(
                "/api/generate",
                payload={"model": model_name, "keep_alive": OLLAMA_KEEP_ALIVE},
                timeout=max(OLLAMA_TIMEOUT_SECONDS, 45),
            )
        except (OSError, error.URLError, error.HTTPError, TimeoutError):
            continue


def get_cache_key(exif_json: dict[str, Any], model_name: str) -> str:
    canonical = json.dumps(exif_json, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(model_name.encode("utf-8"))
    digest.update(canonical.encode("utf-8"))
    return digest.hexdigest()


def get_visual_cache_key(image_path: Path, model_name: str) -> str:
    digest = hashlib.sha256(model_name.encode("utf-8"))
    digest.update(str(image_path.resolve()).encode("utf-8"))
    try:
        stat = image_path.stat()
        digest.update(str(stat.st_mtime_ns).encode("utf-8"))
        digest.update(str(stat.st_size).encode("utf-8"))
    except OSError:
        pass
    return digest.hexdigest()


def build_initial_analysis(exif_json: dict[str, Any]) -> PrivacyAnalysis:
    return build_heuristic_analysis(exif_json, latency_ms=0, cached=False)


def analyze_exif_with_llm(exif_json: dict[str, Any], image_path: str | None = None) -> PrivacyAnalysis:
    """
    Run the deeper Ollama-backed metadata analysis using the EXIF payload only.
    The optional image_path argument is kept for API compatibility with the hybrid path.
    """

    del image_path

    model_name = get_active_ollama_model()
    if not is_ollama_model_available(model_name):
        return build_initial_analysis(exif_json).model_copy(
            update={"fallback_reason": "No text-based Ollama model is installed for metadata analysis."}
        )

    cached_analysis = get_cached_analysis(get_cache_key(exif_json, model_name), PrivacyAnalysis)
    if cached_analysis is not None:
        return cached_analysis

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

    cache_analysis(get_cache_key(exif_json, model_name), enriched)

    return enriched


def analyze_image_privacy_with_vision(image_path: str | Path | None) -> VisualPrivacyAnalysis | None:
    if not image_path:
        return None

    path = Path(image_path)
    if not path.exists() or not path.is_file():
        return None

    model_name = get_active_vision_model()
    if not is_vision_model_available(model_name):
        return build_visual_unavailable_analysis(
            model_name=model_name,
            summary="No local vision model is available, so visible privacy cues in the image were not analyzed.",
            findings=["Visual inspection was skipped because no Ollama vision model is installed."],
            recommendations=["Install a small vision-capable model such as gemma3:4b to inspect the image itself."],
            attacker_simulation="Without a vision pass, the system cannot assess whether the background, signage, documents, or other visible objects leak context.",
            fallback_reason="No local vision-capable Ollama model is installed.",
        )

    cached_analysis = get_cached_analysis(get_visual_cache_key(path, model_name), VisualPrivacyAnalysis)
    if cached_analysis is not None:
        return cached_analysis

    started_at = time.perf_counter()

    try:
        response_text = generate_with_ollama_vision(build_vision_prompt(), path, model_name=model_name)
        analysis = parse_visual_analysis_response(response_text, model_name=model_name)
    except (OSError, ValidationError, ValueError, error.URLError, error.HTTPError, TimeoutError):
        elapsed_ms = int((time.perf_counter() - started_at) * 1000)
        return build_visual_unavailable_analysis(
            model_name=model_name,
            summary="The vision review failed, so only metadata-based privacy findings are available.",
            findings=["Visual inspection could not be completed for this image."],
            recommendations=["Review the image manually for backgrounds, signage, documents, badges, and other visible clues before sharing."],
            attacker_simulation="Visible context may still leak location or identity, but this run could not assess the pixels directly.",
            fallback_reason="The vision review failed, so this result does not include image-content analysis.",
            latency_ms=elapsed_ms,
        )

    elapsed_ms = int((time.perf_counter() - started_at) * 1000)
    enriched = analysis.model_copy(
        update={
            "provider": "ollama",
            "model": model_name,
            "analysis_mode": "vision",
            "cached": False,
            "latency_ms": elapsed_ms,
        }
    )

    cache_analysis(get_visual_cache_key(path, model_name), enriched)

    return enriched


def generate_with_ollama(prompt: str, model_name: str) -> str:
    body = send_ollama_request(
        "/api/generate",
        payload=build_generate_payload(prompt=prompt, model_name=model_name),
        timeout=OLLAMA_TIMEOUT_SECONDS,
    )
    return str(body.get("response", "")).strip()


def generate_with_ollama_vision(prompt: str, image_path: Path, model_name: str) -> str:
    body = send_ollama_request(
        "/api/generate",
        payload=build_generate_payload(
            prompt=prompt,
            model_name=model_name,
            images=[encode_image_file(image_path)],
            num_ctx=max(OLLAMA_NUM_CTX, 1024),
        ),
        timeout=OLLAMA_TIMEOUT_SECONDS,
    )
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
        "attacker_simulation": "An attacker could pinpoint where the image was taken, map the owner's routine from timestamps, link multiple uploads from the same device, and combine that context with social posts or public maps to identify the owner or predict future movements.",
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
        "Schema example:\n"
        f"{json.dumps(example, ensure_ascii=False)}\n"
        f"EXIF:{compact_exif}"
    )


def build_vision_prompt() -> str:
    example = {
        "risk_level": "HIGH",
        "risk_score": 78,
        "summary": "Sensitive: the image contains identifiable or context-rich elements that could expose personal or location information.",
        "key_findings": [
            "A visible document or object contains identifiable or personal information.",
            "Background or contextual elements may reveal location or identity clues.",
        ],
        "recommendations": [
            "Crop or blur sensitive objects before sharing.",
            "Avoid sharing images with identifiable documents or location clues.",
        ],
        "exposed_elements": ["driver's license", "face photo", "location landmark"],
        "attacker_simulation": "An attacker could extract identity details from the document and combine it with visible context to identify or target the individual."
    }

    return (
        "You are auditing the visual security and privacy risk of an image.\n"
        "Return strict JSON only. No markdown. No extra text.\n\n"

        "Step 1: Briefly describe the image (1 sentence).\n"
        "Step 2: Classify it as Sensitive or Non-sensitive.\n\n"

        "SENSITIVITY PRIORITY RULE:\n"
        "- Some categories are higher confidence than others.\n"
        "- Always prioritize in this order when deciding Sensitive vs Non-sensitive:\n\n"

        "1. Documents / Screens / Readable Text (highest confidence)\n"
        "2. Identity signals (faces, IDs, badges, uniforms)\n"
        "3. Location signals (landmarks, signs, unique places)\n"
        "4. Security features (cameras, locks, entry points)\n"
        "5. Contextual inference (environment clues, routines)\n"
        "6. General objects (lowest confidence)\n\n"

        "- If higher priority categories are not clearly present, do NOT upgrade sensitivity based on lower-level cues alone.\n\n"

        "CRITICAL RULES:\n"
        "- ALWAYS prioritize identifying sensitive objects over describing the background.\n"
        "- If a document (license, ID, passport, badge, screen) is visible, you MUST classify the image as Sensitive.\n"
        "- If identifiable landmarks, street signs, license plates, or unique locations are visible, treat as Sensitive.\n"
        "- If a person, face, or identifying feature is visible, consider it potentially Sensitive.\n"
        "- Do NOT ignore obvious objects and describe only the environment.\n"
        "- Only classify as Sensitive when there is clear visual evidence.\n"
        "- If uncertain between Sensitive and Non-sensitive:\n"
        "    -- Choose Sensitive ONLY if there is at least one clearly visible high-confidence signal (document, face, readable text, or recognizable landmark).\n"
        "    -- Otherwise choose Non-sensitive.\n"
        "- Never invent or assume the presence of documents or sensitive objects.\n\n"

        "Sensitive includes:\n"
        "- Personal documents (IDs, licenses, passports)\n"
        "- Screens, badges, or printed information\n"
        "- Faces or identifiable individuals\n"
        "- Location clues (landmarks, signs, buildings, unique environments)\n"
        "- Security features (cameras, entrances, layouts)\n\n"

        "If Sensitive:\n"
        "- Identify the sensitive elements\n"
        "- Describe what type of information is visible (NOT exact values)\n"
        "- Explain why it is sensitive\n"
        "- Briefly explain how it could be misused\n\n"

        "If Non-sensitive:\n"
        "- Describe what is shown briefly\n"
        "- State clearly: 'This image contains no sensitive or exploitable information and is considered safe.'\n\n"

        "IMPORTANT:\n"
        "- Be specific (e.g., 'driver's license', NOT 'object')\n"
        "- Do NOT use vague phrases like 'unidentified object' or 'background'\n"
        "- If nothing sensitive is clearly visible, return empty exposed_elements\n\n"

        "STRICT ACCURACY RULES:\n"
        "- Only identify sensitive objects if they are clearly and confidently visible in the image.\n"
        "- Do NOT assume or hallucinate objects that are not present.\n"
        "- Do NOT guess documents (e.g., driver's license, ID) unless the structure, layout, or features clearly match one.\n"
        "- If uncertain, classify as Non-sensitive instead of guessing.\n\n"

        "LOCATION SENSITIVITY RULES:\n"
        "- If a well-known or recognizable landmark is visible (e.g., Eiffel Tower, famous buildings, unique structures), treat it as Sensitive because it reveals location.\n"
        "- If the image allows someone to infer where the photo was taken (city, country, or specific place), it is Sensitive.\n"
        "- If a person is present near a recognizable landmark, this increases sensitivity because it links identity to location.\n"
        "- Generic nature scenes (trees, fields, sky) without identifiable features are Non-sensitive.\n\n"

        "DIGITAL EXPOSURE RULES:\n"
        "- If a screen (phone, laptop, monitor) is visible and shows readable content, treat as Sensitive.\n"
        "- Includes messages, emails, dashboards, code, QR codes, or login pages.\n"
        "- Even partial visibility can expose sensitive workflows or data.\n\n"

        "TEXT VISIBILITY RULES:\n"
        "- If readable text is present (signs, papers, whiteboards, labels), evaluate it for sensitive information.\n"
        "- Addresses, names, schedules, or instructions should be treated as Sensitive.\n"
        "- Generic or unreadable text can be treated as Non-sensitive.\n\n"

        "IDENTITY LINKING RULES:\n"
        "- If a person is visible and can be linked to a location, object, or activity, treat as Sensitive.\n"
        "- Faces, uniforms, badges, or distinctive appearance increase sensitivity.\n"
        "- A person alone in a neutral setting may be lower risk.\n\n"

        "PRIVATE ENVIRONMENT RULES:\n"
        "- Indoor environments such as homes, offices, or personal spaces may be Sensitive.\n"
        "- Layout, furniture, or unique items can reveal lifestyle, habits, or location.\n"
        "- Treat as Sensitive if the space appears personal or identifiable.\n\n"

        "SECURITY FEATURE RULES:\n"
        "- Visible security elements (cameras, locks, keypads, entry points) should be treated as Sensitive.\n"
        "- These can reveal vulnerabilities or access methods.\n\n"

        "VALUABLE ASSET RULES:\n"
        "- Expensive or high-value items (electronics, vehicles, equipment) can be Sensitive.\n"
        "- These may attract targeting or theft if location is inferred.\n\n"

        "CONTEXTUAL CLUE RULES:\n"
        "- Repeated patterns, unique objects, or environment details can act as indirect identifiers.\n"
        "- Treat as Sensitive if they could help correlate identity across images.\n\n"

        "FINAL DECISION RULE:\n"
        "- Classify as Sensitive only if at least ONE HIGH-CONFIDENCE category is clearly visible:"
        "(documents, screens, faces, recognizable landmarks, readable text)\n"
        "- Otherwise classify as Non-sensitive.\n\n"

        "Schema example:\n"
        f"{json.dumps(example, ensure_ascii=False)}"
    )


def parse_analysis_response(raw_response: str, model_name: str) -> PrivacyAnalysis:
    parsed = extract_response_json(raw_response, "Empty response from Ollama")
    sanitized = sanitize_model_payload(parsed)
    return PrivacyAnalysis.model_validate(
        {
            **sanitized,
            "provider": "ollama",
            "model": model_name,
            "analysis_mode": "ollama",
        }
    )


def parse_visual_analysis_response(raw_response: str, model_name: str) -> VisualPrivacyAnalysis:
    parsed = extract_response_json(raw_response, "Empty response from Ollama vision model")
    sanitized = sanitize_visual_payload(parsed)
    return VisualPrivacyAnalysis.model_validate(
        {
            **sanitized,
            "provider": "ollama",
            "model": model_name,
            "analysis_mode": "vision",
        }
    )


def sanitize_model_payload(payload: dict[str, Any]) -> dict[str, Any]:
    risk_level = normalize_risk_level(payload.get("risk_level", "MEDIUM"))
    risk_score = normalize_risk_score(payload.get("risk_score", 50), default_score=50)

    summary = compact_text(payload.get("summary"), ANALYSIS_CONSTRAINTS["summary_max_chars"])
    key_findings = compact_list(
        payload.get("key_findings"),
        max_items=ANALYSIS_CONSTRAINTS["key_findings_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["key_findings_max_chars"],
    )
    recommendations = compact_list(
        payload.get("recommendations"),
        max_items=ANALYSIS_CONSTRAINTS["recommendations_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["recommendations_max_chars"],
    )
    sensitive_fields = compact_list(
        payload.get("sensitive_fields"),
        max_items=ANALYSIS_CONSTRAINTS["sensitive_fields_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["sensitive_fields_max_chars"],
    )
    attacker_simulation = compact_text(
        payload.get("attacker_simulation"), ANALYSIS_CONSTRAINTS["attacker_simulation_max_chars"]
    )

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


def sanitize_visual_payload(payload: dict[str, Any]) -> dict[str, Any]:
    risk_level = normalize_risk_level(payload.get("risk_level", "MEDIUM"))
    risk_score = normalize_risk_score(payload.get("risk_score", 35), default_score=35)

    summary = compact_text(payload.get("summary"), ANALYSIS_CONSTRAINTS["summary_max_chars"])
    key_findings = compact_list(
        payload.get("key_findings"),
        max_items=ANALYSIS_CONSTRAINTS["key_findings_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["key_findings_max_chars"],
    )
    recommendations = compact_list(
        payload.get("recommendations"),
        max_items=ANALYSIS_CONSTRAINTS["recommendations_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["recommendations_max_chars"],
    )
    exposed_elements = compact_list(
        payload.get("exposed_elements"),
        max_items=ANALYSIS_CONSTRAINTS["exposed_elements_max_items"],
        max_chars=ANALYSIS_CONSTRAINTS["exposed_elements_max_chars"],
    )
    attacker_simulation = compact_text(
        payload.get("attacker_simulation"), ANALYSIS_CONSTRAINTS["attacker_simulation_max_chars"]
    )

    if not summary:
        summary = "Visible image content may reveal contextual privacy clues and should be reviewed before sharing."

    if not key_findings:
        key_findings = ["The image contains visible context that may still leak information even when metadata is removed."]

    if not recommendations:
        recommendations = ["Review the image background for visible clues before sharing."]

    if not attacker_simulation:
        attacker_simulation = "An attacker could combine visible context with public information to infer general location, identity, or routine."
    # Post-filter: remove low-information or generic phrases that models sometimes emit
    # and prefer conservative 'no-findings' when nothing specific is identifiable.
    low_info_tokens = (
        'unidentified', 'unidentified background', 'background',
        'generic', 'unidentified object', 'unidentified object in background', 'unknown', 'indistinct'
    )

    def is_low_info(text: str) -> bool:
        if not text:
            return True
        lowered = text.lower().strip()
        for tok in low_info_tokens:
            if tok in lowered:
                return True
        return False

    # Filter exposed_elements and key_findings
    filtered_exposed: list[str] = [e for e in exposed_elements if not is_low_info(e)]
    filtered_key_findings: list[str] = [k for k in key_findings if not is_low_info(k)]

    if not filtered_exposed:
        # No specific exposed elements identified
        filtered_exposed = []

        # Prefer the model's summary if it's informative, otherwise give a conservative safe explanation.
        informative_summary = ''
        if summary and not is_low_info(summary) and 'no visible' not in summary.lower() and 'no specific' not in summary.lower():
            informative_summary = compact_text(summary, 140)

        safe_tail = "This image contains no sensitive or exploitable information and is considered safe."

        if informative_summary:
            if safe_tail.lower() in informative_summary.lower():
                summary = informative_summary
            else:
                summary = f"{informative_summary} {safe_tail}" if informative_summary.endswith(('.', '!', '?')) else f"{informative_summary}. {safe_tail}"
        else:
            summary = "The image shows visible content without identifiable sensitive details. This image contains no sensitive or exploitable information and is considered safe."

        # Visual Risk should be explicit when nothing sensitive is found
        filtered_key_findings = ["No visible sensitive elements found."]

    else:
        # If there are exposed elements, ensure key findings summarize them if missing
        if not filtered_key_findings:
            filtered_key_findings = [f"Visible elements of interest: {', '.join(filtered_exposed[:3])}"]

        # Keep the model summary if it's informative; otherwise build a short one from exposed elements
        if not summary or is_low_info(summary):
            summary = f"Sensitive: visible elements include {', '.join(filtered_exposed[:3])}. Briefly describe what is present, why it is sensitive, and how it could be misused."
        elif not summary.lower().startswith(("sensitive:", "non-sensitive:")):
            summary = f"Sensitive: {summary}"

    # Use the filtered lists for return
    exposed_elements = filtered_exposed
    key_findings = filtered_key_findings

    return {
        "risk_level": risk_level,
        "risk_score": risk_score,
        "summary": summary,
        "key_findings": key_findings,
        "recommendations": recommendations,
        "exposed_elements": exposed_elements,
        "attacker_simulation": attacker_simulation,
    }


def compact_text(value: Any, max_chars: int | None) -> str:
    """Return a cleaned string. If max_chars is None, return full text.

    When max_chars is provided, truncate safely and append an ellipsis.
    """
    text = str(value or "").strip().replace("\n", " ")
    if max_chars is None:
        return text
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


def select_available_model(
    preferred_models: tuple[str, ...],
    fallback_models: set[str],
    matcher: callable,
    default_model: str,
) -> str:
    for model_name in preferred_models:
        if model_name in fallback_models:
            return model_name

    for model_name in sorted(fallback_models):
        if matcher(model_name.lower()):
            return model_name

    return default_model


def send_ollama_request(
    endpoint: str,
    payload: dict[str, Any] | None = None,
    method: str = "POST",
    timeout: float = OLLAMA_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    encoded_payload = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(
        f"{OLLAMA_BASE_URL}{endpoint}",
        data=encoded_payload,
        headers=OLLAMA_JSON_HEADERS,
        method=method,
    )

    with request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def build_generate_payload(
    prompt: str,
    model_name: str,
    images: list[str] | None = None,
    num_ctx: int = OLLAMA_NUM_CTX,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "options": {
            "temperature": 0,
            "top_p": 0.85,
            "num_ctx": num_ctx,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
    }
    if images:
        payload["images"] = images
    return payload


def extract_response_json(raw_response: str, empty_message: str) -> dict[str, Any]:
    cleaned = THINK_TAG_PATTERN.sub("", raw_response).strip()
    if not cleaned:
        raise ValueError(empty_message)

    json_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not json_match:
        raise ValueError("No JSON object found in model response")

    return json.loads(json_match.group(0))


def normalize_risk_level(value: Any) -> Literal["LOW", "MEDIUM", "HIGH"]:
    risk_level = str(value).upper()
    if risk_level not in {"LOW", "MEDIUM", "HIGH"}:
        return "MEDIUM"
    return risk_level  # type: ignore[return-value]


def normalize_risk_score(value: Any, default_score: int) -> int:
    try:
        score = int(value)
    except (TypeError, ValueError):
        score = default_score
    return max(0, min(score, 100))


def get_cached_analysis(
    cache_key: str,
    expected_type: type[PrivacyAnalysis] | type[VisualPrivacyAnalysis],
) -> PrivacyAnalysis | VisualPrivacyAnalysis | None:
    with _cache_lock:
        cached = _analysis_cache.get(cache_key)
    if isinstance(cached, expected_type):
        return cached.model_copy(update={"cached": True, "latency_ms": 0})
    return None


def cache_analysis(cache_key: str, analysis: PrivacyAnalysis | VisualPrivacyAnalysis) -> None:
    with _cache_lock:
        _analysis_cache[cache_key] = analysis


def build_visual_unavailable_analysis(
    model_name: str,
    summary: str,
    findings: list[str],
    recommendations: list[str],
    attacker_simulation: str,
    fallback_reason: str,
    latency_ms: int = 0,
) -> VisualPrivacyAnalysis:
    return VisualPrivacyAnalysis(
        risk_level="LOW",
        risk_score=0,
        summary=summary,
        key_findings=findings,
        recommendations=recommendations,
        exposed_elements=[],
        attacker_simulation=attacker_simulation,
        model=model_name,
        provider="ollama",
        analysis_mode="unavailable",
        fallback_reason=fallback_reason,
        latency_ms=latency_ms,
    )


def build_heuristic_context(exif_json: dict[str, Any]) -> HeuristicContext:
    return HeuristicContext(
        has_gps=bool(exif_json.get("GPSLatitude") or exif_json.get("GPSLongitude")),
        has_camera=bool(exif_json.get("Make") or exif_json.get("Model")),
        has_time=bool(exif_json.get("DateTime") or exif_json.get("DateTimeOriginal")),
        has_software=bool(exif_json.get("Software")),
        has_serial=any("Serial" in key for key in exif_json.keys()),
        camera_label=" ".join(
            part for part in [str(exif_json.get("Make") or "").strip(), str(exif_json.get("Model") or "").strip()] if part
        ).strip(),
        timestamp_value=str(exif_json.get("DateTimeOriginal") or exif_json.get("DateTime") or "").strip(),
        software_value=str(exif_json.get("Software") or "").strip(),
    )


def append_gps_findings(findings: list[str], recommendations: list[str]) -> int:
    findings.append("Precise GPS metadata is embedded in the file, which can reveal the exact place where the image was captured.")
    recommendations.append("Remove GPS fields before posting or sharing the original.")
    recommendations.append("Do not publish the original file if the image was taken at a home, workplace, school, or another sensitive location.")
    return RISK_SCORE_WEIGHTS["gps"]


def append_camera_findings(camera_label: str, findings: list[str], recommendations: list[str]) -> int:
    if camera_label:
        findings.append(f"Device-identifying camera metadata is present and points to a {camera_label}.")
    else:
        findings.append("Device-identifying camera metadata is present and can help link this file to a specific device type.")
    recommendations.append("Strip camera make and model fields if you do not want uploads linked back to the same device family.")
    return RISK_SCORE_WEIGHTS["camera"]


def append_time_findings(timestamp_value: str, findings: list[str], recommendations: list[str]) -> int:
    if timestamp_value:
        findings.append(f"Capture timestamps are present ({timestamp_value}) and can reveal routines, travel timing, or when you were at a specific place.")
    else:
        findings.append("Capture timestamps are present and can reveal routines, travel timing, or when you were at a specific place.")
    recommendations.append("Remove capture timestamps when sharing publicly if timing could reveal a routine, event attendance, or travel history.")
    return RISK_SCORE_WEIGHTS["timestamp"]


def append_software_findings(software_value: str, findings: list[str], recommendations: list[str]) -> int:
    if software_value:
        findings.append(f"Software metadata is present ({software_value}), which may expose the editing app, device ecosystem, or export workflow.")
    else:
        findings.append("Software metadata is present and may expose the editing app, device ecosystem, or export workflow.")
    recommendations.append("Remove software metadata if you do not want to reveal what app or platform created the file.")
    return RISK_SCORE_WEIGHTS["software"]


def append_serial_findings(findings: list[str], recommendations: list[str]) -> int:
    findings.append("Serial-like metadata is present and may uniquely identify the device or lens used to create the image.")
    recommendations.append("Strip serial-number fields from shared copies.")
    return RISK_SCORE_WEIGHTS["serial"]


def build_exposed_signals(context: HeuristicContext) -> list[str]:
    exposed_signals: list[str] = []
    if context.has_gps:
        exposed_signals.append("where the image was taken")
    if context.has_time:
        exposed_signals.append("when it was captured")
    if context.has_camera:
        exposed_signals.append("what device was used")
    if context.has_software:
        exposed_signals.append("what software or ecosystem handled it")
    if context.has_serial:
        exposed_signals.append("which exact device or lens may have produced it")
    return exposed_signals


def join_signal_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return f"{', '.join(items[:-1])}, and {items[-1]}"


def build_heuristic_summary(risk_level: Literal["LOW", "MEDIUM", "HIGH"], exposed_signals: list[str]) -> str:
    exposed_signal_text = join_signal_list(exposed_signals)

    if risk_level == "HIGH":
        if exposed_signal_text:
            return (
                "This file exposes multiple strong privacy signals through its metadata, making it possible to infer "
                f"{exposed_signal_text}."
            )
        return "This file exposes multiple strong privacy signals through its metadata and should be sanitized before sharing."

    if risk_level == "MEDIUM":
        if exposed_signal_text:
            return f"This file contains identifying metadata that could reveal {exposed_signal_text}."
        return "This file contains identifying metadata and should be reviewed before sharing."

    return "Only limited privacy-sensitive metadata was detected, but the remaining fields can still reveal small pieces of context about the file."


def build_attacker_parts(context: HeuristicContext) -> list[str]:
    attacker_parts: list[str] = []
    if context.has_gps and context.has_time:
        attacker_parts.append("combine location and time to reconstruct where you were and when")
    elif context.has_gps:
        attacker_parts.append("use GPS coordinates to pinpoint a home, workplace, school, or recurring route")
    elif context.has_time:
        attacker_parts.append("use timestamps to infer routines, travel windows, or event attendance")

    if context.has_camera:
        attacker_parts.append("link multiple uploads together through shared device details")
    if context.has_software:
        attacker_parts.append("infer what editing workflow or device ecosystem you use")
    if context.has_serial:
        attacker_parts.append("tie the file back to a uniquely identifying serial-like field")
    return attacker_parts


def build_attacker_scenario(context: HeuristicContext) -> str:
    attacker_parts = build_attacker_parts(context)
    if attacker_parts:
        return (
            "An attacker could "
            + "; ".join(attacker_parts[:-1] + [attacker_parts[-1]])
            + ". This can make it easier to profile your habits, correlate separate posts, or target the same device or location again."
        )
    return "Limited metadata is available, reducing the risk of targeted attacks based on EXIF data alone."


def dedupe_preserve_order(items: list[str], max_items: int) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for item in items:
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(normalized)
        if len(deduped) >= max_items:
            break
    return deduped


def encode_image_file(image_path: Path) -> str:
    return base64.b64encode(image_path.read_bytes()).decode("ascii")


def merge_privacy_analyses(
    metadata_analysis: PrivacyAnalysis,
    visual_analysis: VisualPrivacyAnalysis | None = None,
) -> PrivacyAnalysis:
    if visual_analysis is None or visual_analysis.analysis_mode == "unavailable":
        return metadata_analysis

    combined_score = min(100, round(metadata_analysis.risk_score * 0.55 + visual_analysis.risk_score * 0.45))

    if combined_score >= RISK_LEVEL_THRESHOLDS["high"]:
        risk_level: Literal["LOW", "MEDIUM", "HIGH"] = "HIGH"
    elif combined_score >= RISK_LEVEL_THRESHOLDS["medium"]:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    # Only preserve fallback_reason if visual analysis also failed; if vision succeeded, clear the metadata's fallback
    fallback_reason = None
    if visual_analysis.fallback_reason and metadata_analysis.fallback_reason:
        # Both failed: report the metadata failure as it's the primary analysis
        fallback_reason = metadata_analysis.fallback_reason
    elif visual_analysis.fallback_reason:
        # Only vision failed: report that
        fallback_reason = visual_analysis.fallback_reason
    # If only metadata failed but vision succeeded, fallback_reason stays None (hybrid analysis is complete)

    return PrivacyAnalysis(
        risk_level=risk_level,
        risk_score=combined_score,
        summary=compact_text(f"{metadata_analysis.summary} {visual_analysis.summary}", ANALYSIS_CONSTRAINTS["summary_max_chars"]),
        key_findings=dedupe_preserve_order(metadata_analysis.key_findings + visual_analysis.key_findings, max_items=4),
        recommendations=dedupe_preserve_order(metadata_analysis.recommendations + visual_analysis.recommendations, max_items=4),
        sensitive_fields=dedupe_preserve_order(
            metadata_analysis.sensitive_fields + [f"visible:{item}" for item in visual_analysis.exposed_elements],
            max_items=6,
        ),
        attacker_simulation=compact_text(
            f"{metadata_analysis.attacker_simulation} {visual_analysis.attacker_simulation}",
            ANALYSIS_CONSTRAINTS["attacker_simulation_max_chars"],
        ),
        provider="hybrid",
        model=f"{metadata_analysis.model} + {visual_analysis.model}",
        analysis_mode="hybrid",
        fallback_reason=fallback_reason,
        cached=metadata_analysis.cached and visual_analysis.cached,
        latency_ms=metadata_analysis.latency_ms + visual_analysis.latency_ms,
    )


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
    context = build_heuristic_context(exif_json)

    if context.has_gps:
        score += append_gps_findings(findings, recommendations)

    if context.has_camera:
        score += append_camera_findings(context.camera_label, findings, recommendations)

    if context.has_time:
        score += append_time_findings(context.timestamp_value, findings, recommendations)

    if context.has_software:
        score += append_software_findings(context.software_value, findings, recommendations)

    if context.has_serial:
        score += append_serial_findings(findings, recommendations)

    score = min(score, 100)

    if score >= RISK_LEVEL_THRESHOLDS["high"]:
        risk_level = "HIGH"
    elif score >= RISK_LEVEL_THRESHOLDS["medium"]:
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

    exposed_signals = build_exposed_signals(context)
    summary = build_heuristic_summary(risk_level, exposed_signals)
    attacker_scenario = build_attacker_scenario(context)

    return PrivacyAnalysis(
        risk_level=risk_level,
        risk_score=score,
        summary=compact_text(summary, ANALYSIS_CONSTRAINTS["summary_max_chars"]),
        key_findings=findings[:4],
        recommendations=recommendations[:4],
        sensitive_fields=sensitive_fields,
        attacker_simulation=compact_text(attacker_scenario, ANALYSIS_CONSTRAINTS["attacker_simulation_max_chars"]),
        provider="heuristic",
        model="rules-engine",
        analysis_mode="heuristic",
        cached=cached,
        latency_ms=latency_ms,
    )
