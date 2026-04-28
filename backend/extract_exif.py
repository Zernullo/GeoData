"""
GeoData EXIF extraction helpers.

Extracts metadata from common image formats and normalizes values so they can
be returned safely as JSON.
"""

from __future__ import annotations

import json

import piexif
from PIL import Image
from PIL.ExifTags import GPSTAGS, TAGS

try:
    from pillow_heif import register_heif_opener
except ImportError:  # pragma: no cover - optional dependency
    register_heif_opener = None

if register_heif_opener is not None:
    register_heif_opener()

# EXIF IFD section names for structured metadata extraction
EXIF_IFD_SECTIONS = ("0th", "Exif", "GPS", "1st")


def extract_exif(image_path, output_json_path=None):
    readable = {}

    try:
        image = Image.open(image_path)

        if image.format in ("JPEG", "JPG"):
            try:
                exif_dict = piexif.load(str(image_path))
                for ifd_name in EXIF_IFD_SECTIONS:
                    ifd = exif_dict.get(ifd_name, {})
                    for tag, value in ifd.items():
                        tag_name = piexif.TAGS[ifd_name][tag]["name"]
                        readable[tag_name] = serialize_for_json(value)
            except Exception:
                raw_exif = image._getexif()
                if raw_exif:
                    for tag_id, value in raw_exif.items():
                        tag_name = TAGS.get(tag_id, tag_id)
                        readable[tag_name] = serialize_for_json(value)

        elif image.format == "PNG":
            for key, value in image.info.items():
                readable[key] = serialize_for_json(value)

        elif image.format == "TIFF":
            exif_dict = piexif.load(str(image_path))
            for ifd_name in EXIF_IFD_SECTIONS:
                ifd = exif_dict.get(ifd_name, {})
                for tag, value in ifd.items():
                    tag_name = piexif.TAGS[ifd_name][tag]["name"]
                    readable[tag_name] = serialize_for_json(value)

        else:
            raw_exif = image.getexif()
            if raw_exif:
                for tag_id, value in raw_exif.items():
                    tag_name = TAGS.get(tag_id, tag_id)
                    readable[tag_name] = serialize_for_json(value)

            if image.info:
                for key, value in image.info.items():
                    if key not in readable:
                        readable[key] = serialize_for_json(value)

    except Exception as exc:
        print(f"Extraction failed: {exc}")

    if output_json_path:
        output_data = {
            "image_path": str(image_path),
            "total_tags": len(readable),
            "exif_data": readable,
        }
        with open(str(output_json_path), "w", encoding="utf-8") as output_file:
            json.dump(output_data, output_file, indent=2, ensure_ascii=False)

    return readable


def serialize_for_json(obj):
    """Convert non-JSON-serializable objects to JSON-safe values."""

    if isinstance(obj, bytes):
        try:
            return obj.decode("utf-8")
        except (UnicodeDecodeError, AttributeError):
            return str(obj)
    if isinstance(obj, (tuple, list)):
        return [serialize_for_json(item) for item in obj]
    if isinstance(obj, dict):
        return {key: serialize_for_json(value) for key, value in obj.items()}
    if isinstance(obj, (int, float, bool, type(None), str)):
        return obj
    return str(obj)


def extract_gps(exif_data):
    """Extract GPS coordinates from EXIF data and decode to decimal format."""

    gps_raw = exif_data.get("GPSInfo")
    if not gps_raw:
        return None

    gps = {}
    for tag_id, value in gps_raw.items():
        tag_name = GPSTAGS.get(tag_id, tag_id)
        gps[tag_name] = value

    return decode_gps_coords(gps)


def decode_gps_coords(gps):
    """Convert GPS coordinates from DMS to decimal degree format."""

    def to_decimal(dms):
        degrees = dms[0][0] / dms[0][1]
        minutes = dms[1][0] / dms[1][1] / 60
        seconds = dms[2][0] / dms[2][1] / 3600
        return degrees + minutes + seconds

    try:
        lat = to_decimal(gps["GPSLatitude"])
        lon = to_decimal(gps["GPSLongitude"])

        if gps.get("GPSLatitudeRef") == "S":
            lat = -lat
        if gps.get("GPSLongitudeRef") == "W":
            lon = -lon

        return {"lat": lat, "lon": lon}
    except (KeyError, TypeError, ZeroDivisionError):
        return None


def analyze_image(path):
    """Return a high-level image analysis alongside the raw EXIF payload."""

    exif = extract_exif(path)
    coords = extract_gps(exif)

    return {
        "camera_make": exif.get("Make"),
        "camera_model": exif.get("Model"),
        "datetime": exif.get("DateTime"),
        "software": exif.get("Software"),
        "gps": coords,
        "raw_exif": exif,
    }
