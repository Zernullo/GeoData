/**
 * @fileoverview Right sidebar component displaying terminal log and scan history.
 */

import { useRef, useEffect } from 'react';
import type { LogEntry } from '../hooks/useTerminalLog';
import type { Upload } from '../types/exif';

interface SidebarProps {
  logs: LogEntry[];
  history: Upload[];
  onClearLogs?: () => void;
  onClearHistory?: () => void;
}

const getLogColor = (level: LogEntry['level']): string => {
  switch (level) {
    case 'error': return '#ff4d6d';
    case 'warning': return '#f5a623';
    case 'success': return '#00ffa3';
    default: return 'var(--muted)';
  }
};

const getLogIcon = (level: LogEntry['level']): string => {
  switch (level) {
    case 'error': return '✖';
    case 'warning': return '⚠';
    case 'success': return '✓';
    default: return '›';
  }
};

export function Sidebar({ logs, history, onClearLogs, onClearHistory }: SidebarProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="flex flex-col gap-6 sticky top-6">
      {/* Terminal Log */}
      <div className="card overflow-hidden">
        <div className="p-2.5 border-b border-dark-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red animate-pulse" />
            <div className="w-2 h-2 rounded-full bg-amber" />
            <div className="w-2 h-2 rounded-full bg-green" />
            <span className="label-text ml-2">SYSTEM LOG</span>
          </div>
          {onClearLogs && (
            <button
              onClick={onClearLogs}
              className="text-xs text-muted hover:text-green transition-colors px-2 py-1"
              aria-label="Clear logs"
            >
              [CLEAR]
            </button>
          )}
        </div>
        <div className="p-4 h-64 overflow-y-auto font-mono text-xs" role="log" aria-live="polite">
          {logs.map((log, i) => (
            <div 
              key={log.id} 
              className="mb-1.5 animate-slideIn"
              style={{ 
                color: getLogColor(log.level),
                opacity: i === logs.length - 1 ? 1 : 0.7,
              }}
            >
              <span className="opacity-50 mr-2">
                [{log.timestamp.toLocaleTimeString()}]
              </span>
              <span className="mr-1">{getLogIcon(log.level)}</span>
              {log.message}
            </div>
          ))}
          <div ref={logEndRef} />
          <span className="inline-block w-2 h-4 bg-green animate-pulse ml-1">▌</span>
        </div>
      </div>

      {/* History */}
      <div className="card overflow-hidden">
        <div className="p-3 border-b border-dark-border flex justify-between items-center">
          <p className="label-text">SCAN HISTORY</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{history.length}/8</span>
            {onClearHistory && history.length > 0 && (
              <button
                onClick={onClearHistory}
                className="text-xs text-muted hover:text-red transition-colors px-2 py-1"
                aria-label="Clear history"
                title="Remove all scan history"
              >
                [CLEAR]
              </button>
            )}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {history.length === 0 ? (
            <p className="text-xs text-dark-muted p-8 text-center italic">
              No scans yet
            </p>
          ) : (
            history.map((item) => (
              <div 
                key={item.id} 
                className="p-3 border-b border-dark-border flex gap-3 items-center hover:bg-surface2 transition-colors group"
              >
                {item.preview && (
                  <img 
                    src={item.preview} 
                    alt="" 
                    className="w-10 h-10 object-cover rounded border border-dark-border shrink-0 group-hover:border-green/30 transition-colors"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-dark-text truncate font-mono" title={item.fileName}>
                    {item.fileName}
                  </p>
                  <p className="text-xs text-dark-muted mt-0.5">
                    {item.tagCount} tags • {new Date(item.timestamp).toLocaleDateString()}
                  </p>
                  {item.hasGPS && (
                    <span 
                      className="text-xs px-1.5 py-0.5 rounded border mt-1 inline-block"
                      style={{
                        color: 'var(--red)',
                        borderColor: 'rgba(255,77,109,0.3)',
                        background: 'rgba(255,77,109,0.1)',
                      }}
                    >
                      GPS
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}