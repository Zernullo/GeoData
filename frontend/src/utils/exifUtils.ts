/**
 * @fileoverview EXIF data analysis utilities for privacy risk assessment.
 */

import type { ExifData } from '../types/exif';

export function riskScore(exif: ExifData): { score: number; level: string; color: string } {
  let score = 0;
  
  // GPS coordinates are the most sensitive - directly expose location
  if (exif.GPSLatitude) score += 40;
  
  // Camera make/model can identify device
  if (exif.Make || exif.Model) score += 20;
  
  // Timestamps reveal when and where photo was taken
  if (exif.DateTime || exif.DateTimeOriginal) score += 15;
  
  // Software version may reveal system info
  if (exif.Software) score += 10;
  
  // Serial numbers uniquely identify devices
  if (Object.keys(exif).some(k => k.includes('Serial') || k.includes('Device'))) score += 15;
  
  // Additional sensitive fields
  if (exif.GPSAltitude) score += 5;
  if (exif.GPSTimestamp) score += 5;
  
  // Cap at 100
  score = Math.min(score, 100);
  
  // Return risk level and visualization color
  if (score >= 60) return { score, level: 'HIGH', color: '#ff4d6d' };
  if (score >= 30) return { score, level: 'MEDIUM', color: '#f5a623' };
  return { score, level: 'LOW', color: '#00ffa3' };
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