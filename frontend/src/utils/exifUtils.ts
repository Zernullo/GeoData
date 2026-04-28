/**
 * @fileoverview EXIF data analysis utilities for privacy risk assessment.
 */

import type { ExifData } from '../types/exif';
import { SENSITIVE_FIELDS } from '../constants/exif';

// Risk scoring weights for client-side preview analysis
// Aligned with backend analysis in local_LLM.py for consistency
const RISK_SCORE_WEIGHTS = {
  gps: 45,        // Most sensitive: directly exposes location
  camera: 20,     // Device identification
  timestamp: 15,  // Routine and timing patterns
  software: 10,   // System/ecosystem inference
  serial: 15,     // Unique device identification
  altitude: 5,    // Location refinement
  gpsTime: 5,     // Timing patterns
} as const;

// Risk level thresholds and colors for UI display
const RISK_LEVELS = {
  high: { threshold: 60, color: '#ff4d6d' },
  medium: { threshold: 30, color: '#f5a623' },
  low: { color: '#00ffa3' },
} as const;

export function riskScore(exif: ExifData): { score: number; level: string; color: string } {
  let score = 0;
  
  // GPS coordinates are the most sensitive - directly expose location
  if (exif.GPSLatitude) score += RISK_SCORE_WEIGHTS.gps;
  
  // Camera make/model can identify device
  if (exif.Make || exif.Model) score += RISK_SCORE_WEIGHTS.camera;
  
  // Timestamps reveal when and where photo was taken
  if (exif.DateTime || exif.DateTimeOriginal) score += RISK_SCORE_WEIGHTS.timestamp;
  
  // Software version may reveal system info
  if (exif.Software) score += RISK_SCORE_WEIGHTS.software;
  
  // Serial numbers uniquely identify devices
  if (Object.keys(exif).some(k => k.includes('Serial') || k.includes('Device'))) score += RISK_SCORE_WEIGHTS.serial;
  
  // Additional sensitive fields
  if (exif.GPSAltitude) score += RISK_SCORE_WEIGHTS.altitude;
  if (exif.GPSTimestamp) score += RISK_SCORE_WEIGHTS.gpsTime;
  
  // Cap at 100
  score = Math.min(score, 100);
  
  // Return risk level and visualization color
  if (score >= RISK_LEVELS.high.threshold) return { score, level: 'HIGH', color: RISK_LEVELS.high.color };
  if (score >= RISK_LEVELS.medium.threshold) return { score, level: 'MEDIUM', color: RISK_LEVELS.medium.color };
  return { score, level: 'LOW', color: RISK_LEVELS.low.color };
}

export function getSensitiveKeys(exif: ExifData): string[] {
  return Object.keys(exif).filter(key => SENSITIVE_FIELDS.includes(key));
}

export function formatExifValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(v => formatExifValue(v)).join(', ');
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export function groupExifData(exif: ExifData): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {
    Camera: {},
    GPS: {},
    Timestamps: {},
    Image: {},
    Other: {}
  };
  
  Object.entries(exif).forEach(([key, value]) => {
    if (key.includes('GPS') || key.includes('Latitude') || key.includes('Longitude')) {
      groups.GPS[key] = value;
    } else if (key.includes('Make') || key.includes('Model') || key.includes('Software') || key.includes('Serial')) {
      groups.Camera[key] = value;
    } else if (key.includes('DateTime') || key.includes('Time')) {
      groups.Timestamps[key] = value;
    } else if (key.includes('Pixel') || key.includes('Resolution') || key.includes('Width') || key.includes('Height')) {
      groups.Image[key] = value;
    } else {
      groups.Other[key] = value;
    }
  });
  
  // Remove empty groups
  Object.keys(groups).forEach(key => {
    if (Object.keys(groups[key]).length === 0) {
      delete groups[key];
    }
  });
  
  return groups;
}
