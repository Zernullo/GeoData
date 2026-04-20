/**
 * Custom React hook for managing EXIF upload history with localStorage.
 */

import { useCallback, useEffect, useState } from 'react';

import type { Upload } from '../types/exif';

const STORAGE_KEY = 'geodata_history';

export function useExifHistory() {
  const [history, setHistory] = useState<Upload[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.every((item) => item.id && item.fileName && typeof item.tagCount === 'number')
        ) {
          return parsed;
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('Failed to save history to localStorage:', error);
    }
  }, [history]);

  const addToHistory = useCallback((upload: Upload) => {
    setHistory((prev) => [upload, ...prev.filter((item) => item.id !== upload.id)]);
  }, []);

  const removeFromHistory = useCallback((id: string) => {
    setHistory((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    history,
    setHistory,
    addToHistory,
    removeFromHistory,
    clearHistory,
  };
}
