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

def extract_exif(image_path, output_json_path=None):
    """Extract all EXIF metadata from an image file.
    
    Converts numeric EXIF tag IDs to human-readable names and returns
    all metadata as a dictionary. Optionally saves the data to a JSON file.
    
    Args:
        image_path (str): Path to the image file
        output_json_path (str): Optional path to save EXIF data as JSON
        
    Returns:
        dict: Dictionary mapping EXIF tag names to their values
    """
    image = Image.open(image_path)
    raw_exif = image._getexif()  # Returns a dict of tag_id -> value

    if not raw_exif:
        readable = {}
    else:
        readable = {}
        for tag_id, value in raw_exif.items():
            tag_name = TAGS.get(tag_id, tag_id)  # Convert numeric ID → human name
            readable[tag_name] = serialize_for_json(value)

    # Save to JSON file if path provided
    if output_json_path:
        output_data = {
            "image_path": image_path,
            "total_tags": len(readable),
            "exif_data": readable
        }
        with open(output_json_path, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
        print(f"EXIF data saved to: {output_json_path}")

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

    lat = to_decimal(gps["GPSLatitude"])
    lon = to_decimal(gps["GPSLongitude"])

    if gps.get("GPSLatitudeRef")  == "S": lat = -lat
    if gps.get("GPSLongitudeRef") == "W": lon = -lon

    return {"lat": lat, "lon": lon}

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

# Usage
data = analyze_image("photo.jpg")
print(data["gps"])        # {'lat': 40.7128, 'lon': -74.0060}
print(data["camera_model"])  # 'iPhone 15 Pro'


# Example usage:
# extract_exif("photo.jpg", "photo_exif.json")