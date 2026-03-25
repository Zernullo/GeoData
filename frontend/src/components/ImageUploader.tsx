/**
 * @fileoverview Main orchestrator component for EXIF metadata extraction.
 * Manages file upload, API communication, state synchronization, and result display.
 */
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { ExifData } from '../types/exif';
import '../App.css';
import { useExifHistory } from '../hooks/useExifHistory';
import { useTerminalLog } from '../hooks/useTerminalLog';
import { Header } from './upload/Header';
import { UploadZone } from './upload/UploadZone';
import { ResultsPanel } from './upload/ResultsPanel';
import { Sidebar } from './upload/Sidebar';
import { MobileSidebar } from './upload/MobileSidebar';
import { compressPreview } from '../utils/imageUtils';
import { RETRY_CONFIG, API_ENDPOINTS } from '../constants/config';

export default function ImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExifData | null>(null);
  const [llmAnalysis, setLlmAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  const { history, setHistory, clearHistory } = useExifHistory();
  const { logs, addLog, clearLogs } = useTerminalLog();
  const inputRef = useRef<HTMLInputElement>(null);


  // Download JSON callback
  const downloadJSON = useCallback(() => {
    if (!result) return;
    
    try {
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exif-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      addLog('JSON export completed', 'success');
    } catch (err) {
      addLog(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [result, addLog]);

  // Handle file upload callback
  const handleUpload = useCallback(async (isRetry = false) => {
    if (!file) {
      setError('No file selected');
      addLog('ERROR: No file selected', 'error');
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);
    setLlmAnalysis(null);
    addLog('Initiating extraction sequence...', 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);
      addLog('Uploading to analysis engine...', 'info');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), RETRY_CONFIG.timeout);

      const response = await fetch(API_ENDPOINTS.extract, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.data?.exif_data) {
        const exifData = data.data.exif_data;
        setResult(exifData);
        setLlmAnalysis(data.llm_analysis || null);
        const count = Object.keys(exifData).length;
        addLog(`Extraction complete — ${count} tags found`, 'success');
        if (exifData.GPSLatitude) {
          addLog('⚠ GPS coordinates detected', 'warning');
        } else {
          addLog('No GPS data present', 'info');
        }
        const newUpload = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          fileName: file.name,
          preview: preview || '',
          hasGPS: !!exifData.GPSLatitude,
          tagCount: count,
        };
        setHistory(prev => [newUpload, ...prev].slice(0, 8));
        setRetryCount(0);
      } else {
        throw new Error(data.error || 'Extraction failed');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        addLog('Request timeout - server not responding', 'error');
        setError('Request timeout. Please try again.');
      } else if (!isRetry && retryCount < RETRY_CONFIG.maxRetries) {
        setRetryCount(prev => prev + 1);
        addLog(`Connection failed - retry ${retryCount + 1}/${RETRY_CONFIG.maxRetries}...`, 'warning');
        
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, RETRY_CONFIG.retryDelay * Math.pow(2, retryCount))
        );
        
        return handleUpload(true);
      } else {
        const msgError = err instanceof Error ? err.message : 'Unknown error';
        setError(msgError);
        addLog(`ERROR: ${msgError}`, 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [file, preview, addLog, setHistory, retryCount]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + O to open file
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        inputRef.current?.click();
      }
      
      // Ctrl/Cmd + Enter to analyze
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && file && !loading) {
        e.preventDefault();
        handleUpload();
      }
      
      // Ctrl/Cmd + S to save JSON (when results exist)
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && result) {
        e.preventDefault();
        downloadJSON();
      }
      
      // Escape to close mobile sidebar
      if (e.key === 'Escape' && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, loading, result, mobileSidebarOpen, downloadJSON, handleUpload]);

  const handleFileChange = useCallback(async (files: FileList | null) => {
    if (files && files[0]) {
      const f = files[0];
      
      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/tiff', 'image/heic', 'image/webp'];
      if (!validTypes.includes(f.type)) {
        addLog(`ERROR: Unsupported file type: ${f.type}`, 'error');
        setError('Unsupported file type. Please upload JPG, PNG, TIFF, HEIC, or WEBP.');
        return;
      }
      
      // Validate file size (max 50MB)
      const maxSize = 50 * 1024 * 1024;
      if (f.size > maxSize) {
        addLog(`ERROR: File too large: ${(f.size / 1024 / 1024).toFixed(1)}MB`, 'error');
        setError('File size exceeds 50MB limit.');
        return;
      }
      
      setFile(f);
      setResult(null);
      setError(null);
      addLog(`File loaded: ${f.name}`, 'success');
      addLog(`Size: ${(f.size / 1024).toFixed(1)} KB | Type: ${f.type}`, 'info');
      
      try {
        const compressedPreview = await compressPreview(f);
        setPreview(compressedPreview);
        addLog('Preview generated successfully', 'success');
      } catch {
        addLog('Failed to generate preview', 'error');
      }
    }
  }, [addLog]);

  // Memoized button styles
  const uploadButtonStyle = useMemo(() => ({
    background: file && !loading ? 'var(--green)' : 'transparent',
    color: file && !loading ? '#07080f' : 'var(--muted)',
    border: `1px solid ${file && !loading ? 'var(--green)' : 'var(--border)'}`,
    cursor: file && !loading ? 'pointer' : 'not-allowed',
  }), [file, loading]);

  return (
    <div className="flex flex-col gap-8 animate-fadeIn">
      <Header />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Left Column */}
        <div className="flex flex-col gap-6">
          <UploadZone
            file={file}
            preview={preview}
            dragOver={dragOver}
            onDragOver={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              setDragOver(false);
              handleFileChange(e.dataTransfer.files);
            }}
            onInputChange={handleFileChange}
            inputRef={inputRef}
          />

          {/* Analyze Button */}
          <button
            onClick={() => handleUpload()}
            disabled={!file || loading}
            className="py-3 px-4 font-mono text-lg tracking-wider font-bold rounded transition-all hover:shadow-glow disabled:hover:shadow-none"
            style={uploadButtonStyle}
            aria-label={loading ? 'Analyzing...' : 'Extract metadata'}
          >
            {loading ? '[ ANALYZING... ]' : '[ EXTRACT METADATA ]'}
          </button>

          {/* Progress Indicator */}
          {loading && (
            <div className="flex items-center gap-3 p-3 border border-green/20 bg-green/5 rounded">
              <div className="w-4 h-4 border-2 border-green border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-green">PROCESSING ... {retryCount > 0 ? `(Retry ${retryCount}/${RETRY_CONFIG.maxRetries})` : ''}</span>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div 
              className="p-4 rounded text-xs font-mono animate-shake"
              style={{
                background: 'rgba(255,77,109,0.08)',
                border: '1px solid rgba(255,77,109,0.3)',
                color: '#ff4d6d',
              }}
              role="alert"
            >
              <span className="font-bold">ERROR // </span>
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-4 px-2 py-1 text-xs border border-red/30 hover:bg-red/10 rounded"
                aria-label="Dismiss error"
              >
                [DISMISS]
              </button>
            </div>
          )}

          {result && (
            <div className="fade-up">
              <ResultsPanel result={result} llmAnalysis={llmAnalysis} onDownload={downloadJSON} />
            </div>
          )}
        </div>

        {/* Desktop Sidebar */}
        <div className="hidden lg:block">
          <Sidebar logs={logs} history={history} onClearLogs={clearLogs} onClearHistory={clearHistory} />
        </div>
      </div>

      {/* Mobile Sidebar Toggle */}
      <button 
        className="lg:hidden fixed bottom-4 right-4 w-12 h-12 rounded-full bg-green text-black flex items-center justify-center shadow-lg hover:shadow-glow transition-all z-50"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Open system log"
      >
        📋
      </button>

      {/* Mobile Sidebar Modal */}
      <MobileSidebar
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        logs={logs}
        history={history}
        onClearLogs={clearLogs}
      />
    </div>
  );
}