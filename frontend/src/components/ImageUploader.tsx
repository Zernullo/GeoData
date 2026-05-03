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
  VisualAnalysis,
} from '../types/exif';
import { compressPreview, validateImageFile } from '../utils/imageUtils';
import { Header } from './upload/Header';
import { MobileSidebar } from './upload/MobileSidebar';
import { ResultsPanel } from './upload/ResultsPanel';
import { Sidebar } from './upload/Sidebar';
import { UploadZone } from './upload/UploadZone';

type DeepAnalysisTrigger = 'auto' | 'manual';

interface DeepAnalysisState {
  llmAnalysis: LlmAnalysis | null;
  visualAnalysis: VisualAnalysis | null;
  combinedAnalysis: LlmAnalysis | null;
}

function buildExportPayload(
  metadata: ExifData,
  llmAnalysis: LlmAnalysis | null,
  visualAnalysis: VisualAnalysis | null,
  combinedAnalysis: LlmAnalysis | null,
) {
  return {
    exported_at: new Date().toISOString(),
    metadata,
    analysis: combinedAnalysis ?? llmAnalysis,
    metadata_analysis: llmAnalysis,
    visual_analysis: visualAnalysis,
  };
}

function getModelAvailabilityMessage(
  available: boolean,
  readyLabel: string,
  unavailableLabel: string,
) {
  return {
    message: available ? readyLabel : unavailableLabel,
    level: available ? 'success' as const : 'warning' as const,
  };
}

export default function ImageUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [result, setResult] = useState<ExifData | null>(null);
  const [llmAnalysis, setLlmAnalysis] = useState<LlmAnalysis | null>(null);
  const [visualAnalysis, setVisualAnalysis] = useState<VisualAnalysis | null>(null);
  const [combinedAnalysis, setCombinedAnalysis] = useState<LlmAnalysis | null>(null);
  const [llmHealth, setLlmHealth] = useState<LlmHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineMeta | null>(null);
  const [imagePath, setImagePath] = useState<string | null>(null);

  const { history, addToHistory, clearHistory } = useExifHistory();
  const { logs, addLog, clearLogs } = useTerminalLog(UI_CONFIG.maxLogEntries);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeScanIdRef = useRef(0);
  const activeHistoryIdRef = useRef<string | null>(null);
  const activeHistoryBaseRef = useRef<{
    id: string;
    timestamp: string;
    fileName: string;
    preview: string;
    hasGPS: boolean;
    tagCount: number;
  } | null>(null);

  const resetAnalysisState = useCallback(() => {
    setLlmAnalysis(null);
    setVisualAnalysis(null);
    setCombinedAnalysis(null);
    setImagePath(null);
    setAiError(null);
    setAiLoading(false);
  }, []);

  const applyDeepAnalysisState = useCallback((analysisState: DeepAnalysisState) => {
    setLlmAnalysis(analysisState.llmAnalysis);
    setVisualAnalysis(analysisState.visualAnalysis);
    setCombinedAnalysis(analysisState.combinedAnalysis);
  }, []);

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
        const textModelStatus = getModelAvailabilityMessage(
          payload.text_available,
          `Local text model detected: ${payload.text_model}`,
          `Configured text model not ready yet: ${payload.text_model}`,
        );
        const visionModelStatus = getModelAvailabilityMessage(
          payload.vision_available,
          `Local vision model detected: ${payload.vision_model}`,
          `Vision model not ready yet: ${payload.vision_model}`,
        );
        addLog(textModelStatus.message, textModelStatus.level);
        addLog(visionModelStatus.message, visionModelStatus.level);
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

  useEffect(() => {
    return () => {
      if (preview?.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const downloadJSON = useCallback(() => {
    if (!result) return;

    try {
      const exportPayload = buildExportPayload(result, llmAnalysis, visualAnalysis, combinedAnalysis);
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
  }, [addLog, combinedAnalysis, llmAnalysis, result, visualAnalysis]);

  const runDeepAnalysis = useCallback(async (
    exifData: ExifData,
    currentImagePath: string | null,
    trigger: DeepAnalysisTrigger,
    scanId: number,
  ) => {
    if (scanId !== activeScanIdRef.current) return;
    if (Object.keys(exifData).length === 0 && !currentImagePath) return;

    setAiLoading(true);
    setAiError(null);
    addLog(
      trigger === 'auto'
        ? 'Starting background metadata + visual analysis...'
        : 'Refreshing metadata + visual analysis...',
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
          image_path: currentImagePath,
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

      applyDeepAnalysisState({
        llmAnalysis: data.llm_analysis,
        visualAnalysis: data.visual_analysis ?? null,
        combinedAnalysis: data.combined_analysis ?? data.llm_analysis,
      });
      const mergedAnalysis = data.combined_analysis ?? data.llm_analysis;

      if (mergedAnalysis?.fallback_reason) {
        addLog(
          `AI review fallback active after ${mergedAnalysis.latency_ms}ms: ${mergedAnalysis.fallback_reason}`,
          'warning',
        );
      }
      if (data.visual_analysis?.fallback_reason) {
        addLog(
          `Vision model fallback: ${data.visual_analysis.fallback_reason}`,
          'warning',
        );
      }
      if (!mergedAnalysis?.fallback_reason) {
        addLog(
          `Deep review complete in ${data.meta?.duration_ms ?? mergedAnalysis?.latency_ms ?? 0}ms${mergedAnalysis?.cached ? ' (cache)' : ''}`,
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
  }, [addLog, applyDeepAnalysisState]);

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
    setResult(null);
    setPipeline(null);
    resetAnalysisState();
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
      applyDeepAnalysisState({
        llmAnalysis: null,
        visualAnalysis: null,
        combinedAnalysis: null,
      });
      setImagePath(data.data.image_path ?? null);

      addLog(`Metadata extracted in ${data.pipeline?.extract_ms ?? 0}ms`, 'success');
      addLog(`Found ${count} EXIF tags`, 'info');

      if (count === 0) {
        if (!llmHealth?.vision_available) {
          addLog('No EXIF metadata found. Skipping deeper AI review because no vision model is ready.', 'warning');
          setRetryCount(0);
          return;
        }

        addLog('No EXIF metadata found. Continuing with vision-only privacy review.', 'warning');
      }

      if (!llmHealth?.text_available && !llmHealth?.vision_available) {
        addLog('No local text or vision model is ready. Using metadata scan without deeper AI review.', 'warning');
        setRetryCount(0);
        return;
      }

      if (exifData.GPSLatitude) {
        addLog('High-risk location metadata detected', 'warning');
      }

      const completedHistoryEntry = {
        id: activeHistoryIdRef.current ?? crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        fileName: file.name,
        preview: preview || activeHistoryBaseRef.current?.preview || '',
        hasGPS: !!exifData.GPSLatitude,
        tagCount: count,
      };

      addToHistory({
        ...completedHistoryEntry,
      });

      activeHistoryBaseRef.current = completedHistoryEntry;

      setRetryCount(0);
      void runDeepAnalysis(exifData, data.data.image_path ?? null, 'auto', scanId);
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
  }, [addLog, addToHistory, applyDeepAnalysisState, file, llmHealth?.text_available, llmHealth?.vision_available, preview, resetAnalysisState, retryCount, runDeepAnalysis]);

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
    const historyId = crypto.randomUUID();
    const historyTimestamp = new Date().toISOString();
    activeHistoryIdRef.current = historyId;
    activeHistoryBaseRef.current = {
      id: historyId,
      timestamp: historyTimestamp,
      fileName: selectedFile.name,
      preview: '',
      hasGPS: false,
      tagCount: 0,
    };

    setFile(selectedFile);
    setResult(null);
    setPipeline(null);
    resetAnalysisState();
    setError(null);
    setPreview(null);
    setPreviewLoading(true);

    addLog(`Loaded ${selectedFile.name}`, 'success');
    addLog(`File size ${(selectedFile.size / 1024).toFixed(1)} KB`, 'info');
    addToHistory(activeHistoryBaseRef.current);

    try {
      const compressedPreview = await compressPreview(selectedFile, UI_CONFIG.previewMaxSize);
      if (activeHistoryIdRef.current !== historyId) {
        return;
      }

      setPreview(compressedPreview);
      setPreviewLoading(false);
      if (activeHistoryBaseRef.current?.id === historyId) {
        activeHistoryBaseRef.current = {
          ...activeHistoryBaseRef.current,
          preview: compressedPreview,
        };
        addToHistory(activeHistoryBaseRef.current);
      }
      addLog('Preview ready', 'success');
    } catch {
      if (activeHistoryIdRef.current !== historyId) {
        return;
      }

      setPreview(null);
      setPreviewLoading(false);
      addLog('Preview unavailable, continuing without thumbnail', 'warning');
    }
  }, [addLog, addToHistory, resetAnalysisState]);

  const primaryActionLabel = extracting ? '[ SCANNING IMAGE... ]' : '[ START SCAN ]';
  const canRunDeepAnalysis = result
    ? !aiLoading && (
        (Object.keys(result).length > 0 && Boolean(llmHealth?.text_available || llmHealth?.vision_available))
        || Boolean(imagePath && llmHealth?.vision_available)
      )
    : false;

  return (
    <div className="page-shell animate-fadeIn">
      <Header llmHealth={llmHealth} />

      <div className="workspace-grid">
        <div className="workspace-main">
          <UploadZone
            file={file}
            preview={preview}
            previewLoading={previewLoading}
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
              <strong>Build hybrid privacy summary</strong>
              <p>The local text and vision models expand the scan after the EXIF pass finishes.</p>
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
                  {extracting ? 'Reading metadata from the image' : 'Loading the local LLM chat'}
                </p>
                <p className="status-caption">
                  {extracting
                    ? 'You will see the metadata as soon as extraction finishes.'
                    : 'The metadata is already ready while the local LLM and vision review finish in the background.'}
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
                visualAnalysis={visualAnalysis}
                combinedAnalysis={combinedAnalysis}
                pipeline={pipeline}
                aiLoading={aiLoading}
                aiError={aiError}
                canRunDeepAnalysis={canRunDeepAnalysis}
                onRunDeepAnalysis={() => {
                  const currentResult = result;
                  if (currentResult && (Object.keys(currentResult).length > 0 || imagePath)) {
                    void runDeepAnalysis(currentResult, imagePath, 'manual', activeScanIdRef.current);
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
