/**
 * @fileoverview Custom React hook for managing EXIF upload history with localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Upload } from '../types/exif';

const STORAGE_KEY = 'geodata_history';
const MAX_HISTORY = 8;

/**
 * Hook for managing EXIF upload history with localStorage persistence.
 * 
 * Maintains a list of recent EXIF uploads (max 8), persists to localStorage,
 * and provides methods to add, remove, or clear history entries.
 * 
 * @returns {Object} History management object
 * @returns {Upload[]} history - Array of recent uploads
 * @returns {Function} setHistory - Direct setter for history state
 * @returns {Function} addToHistory - Add or update an upload entry
 * @returns {Function} removeFromHistory - Remove an upload by ID
 * @returns {Function} clearHistory - Clear all history entries
 * 
 * @example
 * const { history, addToHistory, removeFromHistory } = useExifHistory();
 */
export function useExifHistory() {
  const [history, setHistory] = useState<Upload[]>(() => {
    /**
     * Initializes history from localStorage on mount.
     * Validates data structure and limits to MAX_HISTORY entries.
     * Falls back to empty array if localStorage is empty or corrupted.
     */
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate data structure
        if (Array.isArray(parsed) && parsed.every(item => 
          item.id && item.fileName && typeof item.tagCount === 'number'
        )) {
          return parsed.slice(0, MAX_HISTORY);
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  // Sync history to localStorage whenever it changes
  useEffect(() => {
    try {
      const toStore = history.slice(0, MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.warn('Failed to save history to localStorage:', error);
    }
  }, [history]);

  const addToHistory = useCallback((upload: Upload) => {
    /**
     * Adds a new upload to the beginning of history or moves existing to top.
     * Automatically limits history to MAX_HISTORY (8) most recent entries.
     * 
     * @param {Upload} upload - Upload object with id, fileName, tagCount, etc.
     */
    setHistory(prev => {
      const updated = [upload, ...prev.filter(item => item.id !== upload.id)];
      return updated.slice(0, MAX_HISTORY);
    });
  }, []);

  const removeFromHistory = useCallback((id: string) => {
    /**
     * Removes a specific upload entry from history by ID.
     * 
     * @param {string} id - Unique identifier of the upload to remove
     */
    setHistory(prev => prev.filter(item => item.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    /**
     * Clears all entries from history and localStorage.
     */
    setHistory([]);
  }, []);

  return { 
    history, 
    setHistory,
    addToHistory,
    removeFromHistory,
    clearHistory
  };
}