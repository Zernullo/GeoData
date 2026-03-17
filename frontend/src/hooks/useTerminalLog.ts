/**
 * @fileoverview Custom React hook for terminal-style logging system with levels and timestamps.
 */

import { useState, useCallback } from 'react';

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
}

export function useTerminalLog(maxEntries: number = 50) {
  const [logs, setLogs] = useState<LogEntry[]>([
    { 
      id: crypto.randomUUID(), 
      timestamp: new Date(), 
      level: 'info', 
      message: 'GEODATA v2.0 initialized' 
    },
    { 
      id: crypto.randomUUID(), 
      timestamp: new Date(), 
      level: 'info', 
      message: 'Awaiting target file...' 
    }
  ]);

  const addLog = useCallback((msg: string, level: LogLevel = 'info') => {
    setLogs(prev => {
      const newLog: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        level,
        message: msg
      };
      
      // Keep only the last maxEntries
      const updated = [...prev, newLog];
      if (updated.length > maxEntries) {
        return updated.slice(-maxEntries);
      }
      return updated;
    });
  }, [maxEntries]);

  const clearLogs = useCallback(() => {
    setLogs([
      { 
        id: crypto.randomUUID(), 
        timestamp: new Date(), 
        level: 'info', 
        message: 'Logs cleared' 
      }
    ]);
  }, []);

  const getLogsByLevel = useCallback((level: LogLevel) => {
    return logs.filter(log => log.level === level);
  }, [logs]);

  return { 
    logs, 
    addLog, 
    clearLogs,
    getLogsByLevel,
    latestLog: logs[logs.length - 1],
    hasErrors: logs.some(log => log.level === 'error'),
    hasWarnings: logs.some(log => log.level === 'warning')
  };
}