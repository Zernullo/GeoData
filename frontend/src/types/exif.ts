/**
 * @fileoverview Type definitions for EXIF metadata and upload data structures.
 * Provides strict type safety for EXIF data extraction and history management.
 */

/**
 * EXIF metadata extracted from image files.
 * Includes camera information, geolocation data, timestamps, and resolution.
 * 
 * @interface ExifData
 * @property {string} [Make] - Camera manufacturer (e.g., "Canon", "Nikon")
 * @property {string} [Model] - Camera model name
 * @property {string} [DateTime] - Image creation datetime
 * @property {string} [DateTimeOriginal] - Original photo capture datetime
 * @property {string} [Software] - Software used to edit the image
 * @property {string} [GPSLatitudeRef] - GPS latitude reference (N/S)
 * @property {string} [GPSLongitudeRef] - GPS longitude reference (E/W)
 * @property {unknown} [GPSLatitude] - GPS latitude coordinate
 * @property {unknown} [GPSLongitude] - GPS longitude coordinate
 * @property {number} [PixelXDimension] - Image width in pixels
 * @property {number} [PixelYDimension] - Image height in pixels
 * @property {unknown} [key: string] - Additional EXIF fields
 */
export interface ExifData {
  Make?: string;
  Model?: string;
  DateTime?: string;
  DateTimeOriginal?: string;
  Software?: string;
  GPSLatitudeRef?: string;
  GPSLongitudeRef?: string;
  GPSLatitude?: unknown;
  GPSLongitude?: unknown;
  PixelXDimension?: number;
  PixelYDimension?: number;
  [key: string]: unknown;
}

/**
 * Represents a single upload record in the scan history.
 * Used for caching recent uploads and displaying quick access to previous analyses.
 * 
 * @interface Upload
 * @property {string} id - Unique upload identifier (timestamp-based)
 * @property {string} timestamp - ISO-formatted date/time of upload
 * @property {string} fileName - Original filename of the uploaded image
 * @property {string} preview - Base64-encoded thumbnail for quick display
 * @property {boolean} hasGPS - Flag indicating GPS data presence
 * @property {number} tagCount - Total number of EXIF tags extracted
 */
export interface Upload {
  id: string;
  timestamp: string;
  fileName: string;
  preview: string;
  hasGPS: boolean;
  tagCount: number;
}
