/**
 * Mobile-friendly sidebar modal component.
 */

import { useEffect, useRef } from 'react';

import type { LogEntry } from '../../hooks/useTerminalLog';
import type { Upload } from '../../types/exif';
import { Sidebar } from './Sidebar';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  history: Upload[];
  onClearLogs?: () => void;
  onClearHistory?: () => void;
}

export function MobileSidebar({
  isOpen,
  onClose,
  logs,
  history,
  onClearLogs,
  onClearHistory,
}: MobileSidebarProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fadeIn" />

      <div
        ref={modalRef}
        className="relative w-full max-h-[90vh] overflow-y-auto rounded-t-[28px] animate-slideUp"
        style={{ background: 'var(--surface-strong)' }}
      >
        <div className="sticky top-0 flex justify-center p-3 border-b border-dark-border bg-surface/90 backdrop-blur-sm">
          <div className="w-12 h-1 rounded-full bg-white/20 cursor-pointer" onClick={onClose} />
        </div>

        <div className="p-4 pb-8">
          <Sidebar logs={logs} history={history} onClearLogs={onClearLogs} onClearHistory={onClearHistory} />
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full border border-dark-border text-muted hover:text-green hover:border-green transition-colors"
          aria-label="Close sidebar"
        >
          X
        </button>
      </div>
    </div>
  );
}
