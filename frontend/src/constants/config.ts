/**
 * Frontend runtime configuration.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const API_ENDPOINTS = {
  extract: `${API_BASE_URL}/api/extract-exif-json`,
  analyze: `${API_BASE_URL}/api/analyze-exif`,
  sanitize: `${API_BASE_URL}/api/sanitize-image`,
  preview: `${API_BASE_URL}/api/preview-image`,
  llmHealth: `${API_BASE_URL}/api/health/llm`,
} as const;

export const RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 800,
  timeout: 30000,
} as const;

export const FILE_LIMITS = {
  maxSize: 50 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/png', 'image/tiff', 'image/heic', 'image/webp'],
} as const;

export const UI_CONFIG = {
  maxLogEntries: 60,
  maxHistoryItems: 20,
  previewMaxSize: 320,
} as const;
