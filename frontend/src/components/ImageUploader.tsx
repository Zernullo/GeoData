/**
 * Main orchestrator component for GeoData.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import '../App.css';
import { API_ENDPOINTS, RETRY_CONFIG, UI_CONFIG } from '../constants/config';
import { useExifHistory } from '../hooks/useExifHistory';
import { useTerminalLog } from '../hooks/useTerminalLog';
import type {
  AnalyzeExifResponse,
  ExifData,
  ExtractExifJsonResponse,
  LlmAnalysis,
  LlmHealthResponse,
  PipelineMeta,
} from '../types/exif';
import { compressPreview, validateImageFile } from '../utils/imageUtils';
import { Header } from './upload/Header';
import { MobileSidebar } from './upload/MobileSidebar';
import { ResultsPanel } from './upload/ResultsPanel';
import { Sidebar } from './upload/Sidebar';
import { UploadZone } from './upload/UploadZone';

export default function ImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [result, setResult] = useState<ExifData | null>(null);
  const [llmAnalysis, setLlmAnalysis] = useState<LlmAnalysis | null>(null);
  const [llmHealth, setLlmHealth] = useState<LlmHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineMeta | null>(null);

  const { history, addToHistory, clearHistory } = useExifHistory();
  const { logs, addLog, clearLogs } = useTerminalLog(UI_CONFIG.maxLogEntries);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeScanIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    const loadHealth = async () => {
      try {
        const response = await fetch(API_ENDPOINTS.llmHealth);
        if (!response.ok) {
          throw new Error(`Health check failed with HTTP ${response.status}`);
        }

        const payload: LlmHealthResponse = await response.json();
        if (!active) return;

        setLlmHealth(payload);
        addLog(
          payload.available
            ? `Local model detected: ${payload.model}`
            : `Configured model not ready yet: ${payload.model}`,
          payload.available ? 'success' : 'warning',
        );
      } catch (healthError) {
        if (!active) return;

        addLog(
          `AI health check unavailable: ${healthError instanceof Error ? healthError.message : 'Unknown error'}`,
          'warning',
        );
      }
    };

    void loadHealth();

    return () => {
      active = false;
    };
  }, [addLog]);

  const downloadJSON = useCallback(() => {
    if (!result) return;

    try {
      const exportPayload = {
        exported_at: new Date().toISOString(),
        metadata: result,
        analysis: llmAnalysis,
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `geodata-scan-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      addLog('Scan package exported', 'success');
    } catch (exportError) {
      addLog(`Export failed: ${exportError instanceof Error ? exportError.message : 'Unknown error'}`, 'error');
    }
  }, [addLog, llmAnalysis, result]);

  const runDeepAnalysis = useCallback(async (
    exifData: ExifData,
    trigger: 'auto' | 'manual',
    scanId: number,
  ) => {
    if (scanId !== activeScanIdRef.current) return;
    if (Object.keys(exifData).length === 0) return;

    setAiLoading(true);
    setAiError(null);
    addLog(
      trigger === 'auto'
        ? 'Starting background metadata analysis...'
        : 'Refreshing metadata analysis...',
      'info',
    );

    try {
      const response = await fetch(API_ENDPOINTS.analyze, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          exif_data: exifData,
          profile: 'deep',
        }),
      });

      if (!response.ok) {
        throw new Error(`AI review failed with HTTP ${response.status}`);
      }

      const data: AnalyzeExifResponse = await response.json();
      if (scanId !== activeScanIdRef.current) return;

      if (!data.success || !data.llm_analysis) {
        throw new Error(data.error || 'AI review failed');
      }

      setLlmAnalysis(data.llm_analysis);
      if (data.llm_analysis.fallback_reason) {
        addLog(
          `AI returned an incomplete fallback after ${data.llm_analysis.latency_ms}ms: ${data.llm_analysis.fallback_reason}`,
          'warning',
        );
      } else {
        addLog(
          `AI review complete in ${data.llm_analysis.latency_ms}ms${data.llm_analysis.cached ? ' (cache)' : ''}`,
          'success',
        );
      }
    } catch (analysisError) {
      if (scanId !== activeScanIdRef.current) return;

      const message = analysisError instanceof Error ? analysisError.message : 'AI review failed';
      setAiError(message);
      addLog(`AI review fallback active: ${message}`, 'warning');
    } finally {
      if (scanId === activeScanIdRef.current) {
        setAiLoading(false);
      }
    }
  }, [addLog]);

  const handleUpload = useCallback(async (isRetry = false) => {
    if (!file) {
      setError('No file selected');
      addLog('ERROR: No file selected', 'error');
      return;
    }

    const scanId = activeScanIdRef.current + 1;
    activeScanIdRef.current = scanId;

    setExtracting(true);
    setError(null);
    setAiError(null);
    setAiLoading(false);
    setResult(null);
    setPipeline(null);
    setLlmAnalysis(null);
    addLog('Starting image scan...', 'info');

    try {
      const formData = new FormData();
      formData.append('file', file);

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

      const data: ExtractExifJsonResponse = await response.json();

      if (!data.success || !data.data?.exif_data) {
        throw new Error(data.error || 'Extraction failed');
      }

      const exifData = data.data.exif_data;
      const count = Object.keys(exifData).length;

      if (scanId !== activeScanIdRef.current) {
        return;
      }

      setResult(exifData);
      setPipeline(data.pipeline ?? null);
      setLlmAnalysis(count > 0 ? (data.llm_analysis ?? null) : null);

      addLog(`Metadata extracted in ${data.pipeline?.extract_ms ?? 0}ms`, 'success');
      addLog(`Found ${count} EXIF tags`, 'info');

      if (count === 0) {
        addLog('No EXIF metadata found. Skipping AI summary refresh.', 'warning');
        setRetryCount(0);
        return;
      }

      if (!llmHealth?.available) {
        addLog('No text-based local model is ready. Using metadata scan without AI summary.', 'warning');
        setRetryCount(0);
        return;
      }

      if (exifData.GPSLatitude) {
        addLog('High-risk location metadata detected', 'warning');
      }

      addToHistory({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        fileName: file.name,
        preview: preview || '',
        hasGPS: !!exifData.GPSLatitude,
        tagCount: count,
      });

      setRetryCount(0);
      void runDeepAnalysis(exifData, 'auto', scanId);
    } catch (uploadError) {
      if (scanId !== activeScanIdRef.current) {
        return;
      }

      if (uploadError instanceof Error && uploadError.name === 'AbortError') {
        addLog('Extraction request timed out', 'error');
        setError('Metadata extraction timed out. Try again with a smaller image.');
      } else if (!isRetry && retryCount < RETRY_CONFIG.maxRetries) {
        setRetryCount((prev) => prev + 1);
        addLog(`Retrying extraction (${retryCount + 1}/${RETRY_CONFIG.maxRetries})`, 'warning');

        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_CONFIG.retryDelay * Math.pow(2, retryCount)),
        );

        return handleUpload(true);
      } else {
        const message = uploadError instanceof Error ? uploadError.message : 'Unknown error';
        setError(message);
        addLog(`ERROR: ${message}`, 'error');
      }
    } finally {
      if (scanId === activeScanIdRef.current) {
        setExtracting(false);
      }
    }
  }, [addLog, addToHistory, file, llmHealth?.available, preview, retryCount, runDeepAnalysis]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'o') {
        event.preventDefault();
        inputRef.current?.click();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && file && !extracting) {
        event.preventDefault();
        void handleUpload();
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 's' && result) {
        event.preventDefault();
        downloadJSON();
      }

      if (event.key === 'Escape' && mobileSidebarOpen) {
        setMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [downloadJSON, extracting, file, handleUpload, mobileSidebarOpen, result]);

  const handleFileChange = useCallback(async (files: FileList | null) => {
    if (!(files && files[0])) return;

    const selectedFile = files[0];
    const validation = validateImageFile(selectedFile);

    if (!validation.valid) {
      addLog(`ERROR: ${validation.error}`, 'error');
      setError(validation.error || 'Unsupported file');
      return;
    }

    activeScanIdRef.current += 1;

    setFile(selectedFile);
    setResult(null);
    setPipeline(null);
    setLlmAnalysis(null);
    setAiError(null);
    setAiLoading(false);
    setError(null);

    addLog(`Loaded ${selectedFile.name}`, 'success');
    addLog(`File size ${(selectedFile.size / 1024).toFixed(1)} KB`, 'info');

    try {
      const compressedPreview = await compressPreview(selectedFile, UI_CONFIG.previewMaxSize);
      setPreview(compressedPreview);
      addLog('Preview ready', 'success');
    } catch {
      setPreview(null);
      addLog('Preview unavailable, continuing without thumbnail', 'warning');
    }
  }, [addLog]);

  const primaryActionLabel = extracting ? '[ SCANNING IMAGE... ]' : '[ START SCAN ]';
  const canRunDeepAnalysis = result ? Object.keys(result).length > 0 && !aiLoading && Boolean(llmHealth?.available) : false;

  return (
    <div className="page-shell animate-fadeIn">
      <Header llmHealth={llmHealth} />

      <div className="workspace-grid">
        <div className="workspace-main">
          <UploadZone
            file={file}
            preview={preview}
            dragOver={dragOver}
            onDragOver={() => setDragOver(true)}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              setDragOver(false);
              handleFileChange(event.dataTransfer.files);
            }}
            onInputChange={handleFileChange}
            inputRef={inputRef}
          />

          <div className="pipeline-strip">
            <div className="pipeline-stage">
              <span className="pipeline-label">Step 1</span>
              <strong>Read image metadata</strong>
              <p>Get the EXIF data and immediate privacy signals.</p>
            </div>
            <div className="pipeline-stage pipeline-stage-accent">
              <span className="pipeline-label">Step 2</span>
              <strong>Build AI metadata summary</strong>
              <p>The local model summarizes metadata risk after the EXIF scan finishes.</p>
            </div>
          </div>

          <button
            onClick={() => void handleUpload()}
            disabled={!file || extracting}
            className="primary-cta"
            aria-label={extracting ? 'Scanning image...' : 'Start scan'}
          >
            {primaryActionLabel}
          </button>

          {(extracting || aiLoading) && (
            <div className="status-banner">
              <div className="status-spinner" />
              <div>
                <p className="status-title">
                  {extracting ? 'Reading metadata from the image' : 'Generating the AI privacy summary'}
                </p>
                <p className="status-caption">
                  {extracting
                    ? 'You will see the metadata as soon as extraction finishes.'
                    : 'The metadata is already available below while the AI summary finishes.'}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span className="font-bold">ERROR //</span> {error}
              <button
                onClick={() => setError(null)}
                className="dismiss-btn"
                aria-label="Dismiss error"
              >
                DISMISS
              </button>
            </div>
          )}

          {result && (
            <div className="fade-up">
              <ResultsPanel
                result={result}
                llmAnalysis={llmAnalysis}
                pipeline={pipeline}
                aiLoading={aiLoading}
                aiError={aiError}
                canRunDeepAnalysis={canRunDeepAnalysis}
                onRunDeepAnalysis={() => {
                  const currentResult = result;
                  if (currentResult && Object.keys(currentResult).length > 0) {
                    void runDeepAnalysis(currentResult, 'manual', activeScanIdRef.current);
                  }
                }}
                onDownload={downloadJSON}
                file={file}
              />
            </div>
          )}
        </div>

        <div className="hidden lg:block">
          <Sidebar logs={logs} history={history} onClearLogs={clearLogs} onClearHistory={clearHistory} />
        </div>
      </div>

      <button
        className="mobile-log-button lg:hidden"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Open system log"
      >
        LOG
      </button>

      <MobileSidebar
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        logs={logs}
        history={history}
        onClearLogs={clearLogs}
        onClearHistory={clearHistory}
      />
    </div>
  );
}
