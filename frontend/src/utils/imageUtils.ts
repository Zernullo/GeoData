/**
 * @fileoverview Image processing utilities for preview generation and validation.
 */

import type { ExifData } from '../types/exif';
import { API_ENDPOINTS, FILE_LIMITS } from '../constants/config';

export const isExifData = (data: unknown): data is ExifData => {
  return typeof data === 'object' && data !== null;
};

const buildCanvasPreview = (file: File, maxSize: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        let width = img.width;
        let height = img.height;
        
        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > maxSize) {
            height *= maxSize / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width *= maxSize / height;
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        // Get compressed data URL
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(compressedDataUrl);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
};

const buildBackendPreview = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(API_ENDPOINTS.preview, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Preview generation failed with HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

export const compressPreview = async (file: File, maxSize: number = 200): Promise<string> => {
  try {
    return await buildCanvasPreview(file, maxSize);
  } catch {
    return buildBackendPreview(file);
  }
};

export const validateImageFile = (file: File): { valid: boolean; error?: string } => {
  if (!(FILE_LIMITS.allowedTypes as readonly string[]).includes(file.type)) {
    return { valid: false, error: 'Unsupported file type. Please upload JPG, PNG, TIFF, HEIC, or WEBP.' };
  }
  
  if (file.size > FILE_LIMITS.maxSize) {
    return { valid: false, error: `File size exceeds 50MB limit. Current: ${(file.size / 1024 / 1024).toFixed(1)}MB` };
  }
  
  return { valid: true };
};
