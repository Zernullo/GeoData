/**
 * @fileoverview Sensitive EXIF field constants for privacy filtering.
 * These fields are flagged when present in image metadata to alert users
 * about potential privacy exposure.
 */

/**
 * List of EXIF fields that may expose sensitive information.
 * Used to highlight privacy-concerning metadata in analysis results.
 * 
 * Fields grouped by sensitivity:
 * - GPS: GPSLatitude, GPSLongitude, GPSLatitudeRef, GPSLongitudeRef (location)
 * - Timestamps: GPSAltitude, GPSTimestamp, GPSDateStamp (when/where photo taken)
 * - Device: Make, Model, Software (device identification)
 * - IDs: SerialNumber, LensSerialNumber (unique device identifiers)
 * 
 * @type {string[]}
 * @constant
 */
export const SENSITIVE_FIELDS = [
  'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
  'GPSAltitude', 'GPSTimestamp', 'GPSDateStamp', 'Make', 'Model',
  'Software', 'DateTime', 'DateTimeOriginal', 'SerialNumber', 'LensSerialNumber'
];
