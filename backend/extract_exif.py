"""
GeoData EXIF Extraction Module

This module provides utilities for extracting metadata from image files, including:
- EXIF data (camera make, model, datetime, software, etc.)
- GPS coordinates (latitude and longitude in decimal format)
- Raw EXIF information for detailed analysis

Used to parse photos and retrieve geolocation and camera information for mapping purposes.
"""

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
import piexif
import json
from pillow_heif import register_heif_opener
register_heif_opener() # Ensure HEIF support is registered with Pillow

def extract_exif(image_path, output_json_path=None):
    readable = {}
    
    try:
        image = Image.open(image_path)
        
        # JPEG - full EXIF support
        if image.format in ('JPEG', 'JPG'):
            try:
                exif_dict = piexif.load(str(image_path))
                for ifd_name in ("0th", "Exif", "GPS", "1st"):
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

        # PNG - text chunks + XMP
        elif image.format == 'PNG':
            for key, value in image.info.items():
                readable[key] = serialize_for_json(value)

        # TIFF - full EXIF support
        elif image.format == 'TIFF':
            exif_dict = piexif.load(str(image_path))
            for ifd_name in ("0th", "Exif", "GPS", "1st"):
                ifd = exif_dict.get(ifd_name, {})
                for tag, value in ifd.items():
                    tag_name = piexif.TAGS[ifd_name][tag]["name"]
                    readable[tag_name] = serialize_for_json(value)

        # HEIC/HEIF, WEBP, BMP, GIF - fallback
        else:
            # Try PIL EXIF first
            raw_exif = image.getexif()
            if raw_exif:
                for tag_id, value in raw_exif.items():
                    tag_name = TAGS.get(tag_id, tag_id)
                    readable[tag_name] = serialize_for_json(value)
            # Also grab any info dict metadata
            if image.info:
                for key, value in image.info.items():
                    if key not in readable:
                        readable[key] = serialize_for_json(value)

    except Exception as e:
        print(f"⚠ Extraction failed: {e}")

    # Save to JSON if path provided
    if output_json_path:
        output_data = {
            "image_path": str(image_path),
            "total_tags": len(readable),
            "exif_data": readable
        }
        with open(str(output_json_path), 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        print(f"✓ EXIF JSON saved to: {output_json_path}")

    return readable

def serialize_for_json(obj):
    """Convert non-JSON-serializable objects to strings.
    
    Handles bytes, tuples, and other objects that can't be directly serialized to JSON.
    
    Args:
        obj: Any Python object
        
    Returns:
        JSON-serializable representation of the object
    """
    if isinstance(obj, bytes):
        try:
            return obj.decode('utf-8')
        except (UnicodeDecodeError, AttributeError):
            return str(obj)
    elif isinstance(obj, (tuple, list)):
        return [serialize_for_json(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: serialize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (int, float, bool, type(None), str)):
        return obj
    else:
        return str(obj)

def extract_gps(exif_data):
    """Extract GPS coordinates from EXIF data and decode to decimal format.
    
    Parses GPS info from EXIF data and converts DMS (Degrees, Minutes, Seconds)
    format to decimal degrees with proper hemisphere adjustments.
    
    Args:
        exif_data (dict): Dictionary of EXIF data from extract_exif()
        
    Returns:
        dict: Dictionary with 'lat' and 'lon' keys in decimal degrees, or None if no GPS data
    """
    gps_raw = exif_data.get("GPSInfo")
    if not gps_raw:
        return None

    gps = {}
    for tag_id, value in gps_raw.items():
        tag_name = GPSTAGS.get(tag_id, tag_id)  # Same idea, GPS-specific lookup
        gps[tag_name] = value

    return decode_gps_coords(gps)

def decode_gps_coords(gps):
    """Convert GPS coordinates from DMS to decimal degrees format.
    
    Transforms GPS data from Degrees/Minutes/Seconds representation to decimal degrees
    and applies hemisphere references (S/W) to make coordinates negative when appropriate.
    
    Args:
        gps (dict): GPS dictionary with GPSLatitude, GPSLongitude, and hemisphere references
        
    Returns:
        dict: Dictionary with 'lat' and 'lon' keys as decimal degree floats
    """
    def to_decimal(dms):
        """Convert DMS (Degrees, Minutes, Seconds) tuple to decimal degrees."""
        degrees  = dms[0][0] / dms[0][1]
        minutes  = dms[1][0] / dms[1][1] / 60
        seconds  = dms[2][0] / dms[2][1] / 3600
        return degrees + minutes + seconds

    try:
        lat = to_decimal(gps["GPSLatitude"])
        lon = to_decimal(gps["GPSLongitude"])

        if gps.get("GPSLatitudeRef")  == "S": lat = -lat
        if gps.get("GPSLongitudeRef") == "W": lon = -lon

        return {"lat": lat, "lon": lon}
    except (KeyError, TypeError, ZeroDivisionError):
        return None

def analyze_image(path):
    """Complete image analysis: extract camera info, GPS location, and timeline data.
    
    High-level function that combines EXIF extraction and GPS decoding to return
    a comprehensive analysis of an image including camera model, timestamp, and coordinates.
    
    Args:
        path (str): Path to the image file
        
    Returns:
        dict: Dictionary containing camera_make, camera_model, datetime, software, gps, and raw_exif
    """
    exif   = extract_exif(path)
    coords = extract_gps(exif)

    return {
        "camera_make":  exif.get("Make"),
        "camera_model": exif.get("Model"),
        "datetime":     exif.get("DateTime"),
        "software":     exif.get("Software"),
        "gps":          coords,
        "raw_exif":     exif      # keep everything for deeper analysis
    }

# Example usage:
# data = analyze_image("photo.jpg")
# print(data["gps"])        # {'lat': 40.7128, 'lon': -74.0060}
# print(data["camera_model"])  # 'iPhone 15 Pro'
# extract_exif("photo.jpg", "photo_exif.json")