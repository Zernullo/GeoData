/**
 * @fileoverview Application configuration constants.
 */

export const API_ENDPOINTS = {
  extract: 'http://localhost:8000/api/extract-exif-json',
} as const;

export const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // ms
  timeout: 30000, // 30 seconds
} as const;

export const FILE_LIMITS = {
  maxSize: 50 * 1024 * 1024, // 50MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/heic', 'image/webp'],
} as const;

export const UI_CONFIG = {
  maxLogEntries: 50,
  maxHistoryItems: 20,
  previewMaxSize: 200, // pixels
} as const;