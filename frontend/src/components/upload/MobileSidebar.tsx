/**
 * @fileoverview Mobile-friendly sidebar modal component.
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
}

export function MobileSidebar({ isOpen, onClose, logs, history, onClearLogs }: MobileSidebarProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm animate-fadeIn" />
      
      {/* Modal */}
      <div 
        ref={modalRef}
        className="relative w-full max-h-[90vh] overflow-y-auto bg-surface border-t border-green/30 rounded-t-xl animate-slideUp"
        style={{
          background: 'var(--surface)',
        }}
      >
        {/* Handle */}
        <div className="sticky top-0 flex justify-center p-3 bg-surface/90 backdrop-blur-sm border-b border-dark-border">
          <div 
            className="w-12 h-1 bg-muted rounded-full cursor-pointer"
            onClick={onClose}
          />
        </div>

        {/* Content */}
        <div className="p-4 pb-8">
          <Sidebar logs={logs} history={history} onClearLogs={onClearLogs} />
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-surface2 border border-dark-border flex items-center justify-center text-muted hover:text-green hover:border-green transition-colors"
          aria-label="Close sidebar"
        >
          ✕
        </button>
      </div>
    </div>
  );
}