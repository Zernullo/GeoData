import { useMemo, useState } from 'react';

import { API_ENDPOINTS } from '../../constants/config';
import type { ExifData, LlmAnalysis, PipelineMeta, VisualAnalysis } from '../../types/exif';
import { formatExifValue, getSensitiveKeys, groupExifData, riskScore } from '../../utils/exifUtils';

interface ResultsPanelProps {
  result: ExifData;
  llmAnalysis?: LlmAnalysis | null;
  visualAnalysis?: VisualAnalysis | null;
  combinedAnalysis?: LlmAnalysis | null;
  pipeline?: PipelineMeta | null;
  aiLoading: boolean;
  aiError: string | null;
  canRunDeepAnalysis: boolean;
  onRunDeepAnalysis: () => void;
  onDownload: () => void;
  file?: File | null;
}

type TabType = 'overview' | 'categories' | 'raw' | 'ai';

interface RiskDisplay {
  score: number;
  level: string;
  color: string;
}

function buildAiSourceLabel(
  activeAnalysis: LlmAnalysis | null | undefined,
  aiLoading: boolean,
): string {
  if (!activeAnalysis) {
    return aiLoading ? 'Loading local LLM' : 'Waiting for local LLM';
  }

  if (activeAnalysis.model === 'rules-engine') {
    return 'Local LLM unavailable';
  }

  if (activeAnalysis.analysis_mode === 'hybrid') {
    return `Hybrid (${activeAnalysis.model})`;
  }

  return `Local LLM (${activeAnalysis.model})`;
}

function buildSummaryAvailabilityLabel(
  activeAnalysis: LlmAnalysis | null | undefined,
  aiLoading: boolean,
  hasMetadata: boolean,
): string {
  if (activeAnalysis) {
    return 'Available';
  }

  if (aiLoading) {
    return 'Loading LLM chat';
  }

  return hasMetadata ? 'Waiting for LLM' : 'Not available';
}

function buildSummaryText(
  activeAnalysis: LlmAnalysis | null | undefined,
  aiLoading: boolean,
): string {
  if (activeAnalysis?.summary) {
    return activeAnalysis.summary;
  }

  if (aiLoading) {
    return 'The metadata scan is ready. The local LLM chat is loading now.';
  }

  return 'The metadata scan is ready. The AI summary will appear automatically when the local LLM finishes.';
}

function buildMeterCaption(
  activeAnalysis: LlmAnalysis | null | undefined,
  aiLoading: boolean,
  pipeline: PipelineMeta | null | undefined,
): string {
  if (activeAnalysis?.analysis_mode === 'hybrid') {
    return `Hybrid review finished in ${activeAnalysis.latency_ms}ms${activeAnalysis.cached ? ' - cache hit' : ''}`;
  }

  if (activeAnalysis) {
    return `AI summary finished in ${activeAnalysis.latency_ms}ms${activeAnalysis.cached ? ' - cache hit' : ''}`;
  }

  if (aiLoading) {
    return 'Local LLM chat is loading';
  }

  return `Metadata extracted in ${pipeline?.extract_ms ?? 0}ms`;
}

function buildActiveRisk(
  activeAnalysis: LlmAnalysis | null | undefined,
  fallbackRisk: ReturnType<typeof riskScore>,
): RiskDisplay {
  if (!activeAnalysis) {
    return fallbackRisk;
  }

  return {
    score: activeAnalysis.risk_score,
    level: activeAnalysis.risk_level,
    color: fallbackRisk.color,
  };
}

function buildOverviewRows(exif: ExifData): Array<{ label: string; value: string }> {
  const priorityRows = [
    { label: 'Camera make', value: formatExifValue(exif.Make) },
    { label: 'Camera model', value: formatExifValue(exif.Model) },
    { label: 'Captured at', value: formatExifValue(exif.DateTimeOriginal || exif.DateTime) },
    { label: 'Software', value: formatExifValue(exif.Software) },
    {
      label: 'GPS latitude',
      value: formatExifValue(exif.GPSLatitude),
    },
    {
      label: 'GPS longitude',
      value: formatExifValue(exif.GPSLongitude),
    },
    {
      label: 'Resolution',
      value:
        exif.PixelXDimension && exif.PixelYDimension
          ? `${exif.PixelXDimension} x ${exif.PixelYDimension}`
          : '',
    },
  ].filter((row) => row.value);

  if (priorityRows.length > 0) {
    return priorityRows;
  }

  return Object.entries(exif)
    .slice(0, 8)
    .map(([key, value]) => ({
      label: key,
      value: formatExifValue(value),
    }))
    .filter((row) => row.value);
}

export function ResultsPanel({
  result,
  llmAnalysis,
  visualAnalysis,
  combinedAnalysis,
  pipeline,
  aiLoading,
  aiError,
  canRunDeepAnalysis,
  onRunDeepAnalysis,
  onDownload,
  file,
}: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [sanitizing, setSanitizing] = useState(false);
  const [sanitizeError, setSanitizeError] = useState<string | null>(null);
  const hasMetadata = Object.keys(result).length > 0;

  const fallbackRisk = riskScore(result);
  const activeAnalysis = combinedAnalysis ?? llmAnalysis;
  const activeRisk = buildActiveRisk(activeAnalysis, fallbackRisk);
  const sensitiveKeys = getSensitiveKeys(result);
  const groupedData = groupExifData(result);
  const overviewRows = useMemo(() => buildOverviewRows(result), [result]);
  const rawJson = useMemo(() => JSON.stringify(result, null, 2), [result]);
  const aiSourceLabel = buildAiSourceLabel(activeAnalysis, aiLoading);
  const summaryAvailabilityLabel = buildSummaryAvailabilityLabel(activeAnalysis, aiLoading, hasMetadata);

  const tabs: Array<{ id: TabType; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'categories', label: 'Categories' },
    { id: 'raw', label: 'Raw Data' },
    { id: 'ai', label: 'AI Summary' },
  ];

  const handleSanitize = async () => {
    if (!file) return;

    setSanitizing(true);
    setSanitizeError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(API_ENDPOINTS.sanitize, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Sanitization failed with HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `sanitized-${file.name}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setSanitizeError(error instanceof Error ? error.message : 'Failed to sanitize image.');
    } finally {
      setSanitizing(false);
    }
  };

  return (
    <section className="results-shell">
      <div className="results-hero">
        <div>
          <p className="eyebrow mb-3">Privacy result</p>
          <h2 className="results-score" style={{ color: activeRisk.color }}>
            {activeRisk.level}
          </h2>
          <p className="results-summary">
            {buildSummaryText(activeAnalysis, aiLoading)}
          </p>
        </div>

        <div className="results-meter">
          <span className="results-meter-label">Risk score</span>
          <strong>{activeRisk.score}/100</strong>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${activeRisk.score}%`, background: activeRisk.color }} />
          </div>
          <span className="results-meter-caption">{buildMeterCaption(activeAnalysis, aiLoading, pipeline)}</span>
        </div>
      </div>

      <div className="quick-grid">
        <div className="quick-card">
          <span className="quick-label">Total tags</span>
          <strong>{Object.keys(result).length}</strong>
        </div>
        <div className="quick-card">
          <span className="quick-label">Sensitive fields</span>
          <strong>{sensitiveKeys.length}</strong>
        </div>
        <div className="quick-card">
          <span className="quick-label">Summary source</span>
          <strong>{aiSourceLabel}</strong>
        </div>
        <div className="quick-card">
          <span className="quick-label">AI status</span>
          <strong>{aiLoading ? 'Generating summary' : summaryAvailabilityLabel}</strong>
        </div>
      </div>

      <div className="metadata-help-card">
        <div>
          <p className="analysis-card-label">What counts as sensitive metadata?</p>
          <p className="metadata-help-copy">
            GPS coordinates, timestamps, device names, software versions, and serial-like fields can expose where,
            when, and how a photo was created. Background scenery, documents, signage, and visible screens can also leak context even after metadata is stripped.
          </p>
        </div>
        <div className="metadata-help-chips">
          <span className="metadata-help-chip">Location</span>
          <span className="metadata-help-chip">Time</span>
          <span className="metadata-help-chip">Device</span>
          <span className="metadata-help-chip">Software</span>
          <span className="metadata-help-chip">Serial IDs</span>
          <span className="metadata-help-chip">Background clues</span>
        </div>
      </div>

      <div className="analysis-rail">
        <div className="analysis-step analysis-step-done">
          <span className="analysis-step-index">1</span>
          <div>
            <strong>Metadata scan finished</strong>
            <p>{pipeline ? `${pipeline.extract_ms}ms response time` : 'Completed'}</p>
          </div>
        </div>
        <div className={llmAnalysis?.analysis_mode === 'ollama' ? 'analysis-step analysis-step-done' : 'analysis-step'}>
          <span className="analysis-step-index">2</span>
          <div>
            <strong>Metadata model</strong>
            <p>
              {aiLoading
                ? 'Loading LLM chat'
                : llmAnalysis?.analysis_mode === 'ollama'
                  ? `Ready from ${llmAnalysis.model}`
                  : 'Unavailable'}
            </p>
          </div>
        </div>
        <div className={visualAnalysis?.analysis_mode === 'vision' ? 'analysis-step analysis-step-done' : 'analysis-step'}>
          <span className="analysis-step-index">3</span>
          <div>
            <strong>Vision model</strong>
            <p>
              {aiLoading
                ? 'Inspecting visible scene'
                : visualAnalysis?.analysis_mode === 'vision'
                  ? `Ready from ${visualAnalysis.model}`
                  : 'Unavailable'}
            </p>
          </div>
        </div>
      </div>

      <div className="tabs-row">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'tab-chip tab-chip-active' : 'tab-chip'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="results-content">
        {activeTab === 'overview' && (
          <div className="simple-list">
            {overviewRows.length > 0 ? (
              overviewRows.map((row) => (
                <div key={row.label} className="simple-row">
                  <span className="simple-row-label">{row.label}</span>
                  <span className="simple-row-value">{row.value}</span>
                </div>
              ))
            ) : (
              <div className="empty-state">No readable metadata fields were found in this image.</div>
            )}
          </div>
        )}

        {activeTab === 'categories' && (
          <div className="tab-panel-shell">
            {Object.entries(groupedData).length > 0 ? (
              Object.entries(groupedData).map(([category, fields]) => (
                <div key={category} className="category-section">
                  <div className="category-head">{category}</div>
                  <div className="simple-list">
                    {Object.entries(fields).map(([key, value]) => (
                      <div key={key} className="simple-row">
                        <span className="simple-row-label">{key}</span>
                        <span className="simple-row-value">{formatExifValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">No grouped metadata fields were found.</div>
            )}
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="tab-panel-shell">
            <div className="raw-json-panel">
            <pre>{rawJson}</pre>
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="tab-panel-shell">
            <div className="analysis-panel">
            {activeAnalysis ? (
              <>
                <div className="ai-section">
                  <p className="analysis-card-label">Summary source</p>
                  <p>{aiSourceLabel}</p>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Combined summary</p>
                  <p>{activeAnalysis.summary}</p>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Combined findings</p>
                  <div className="analysis-bullets">
                    {activeAnalysis.key_findings.map((finding) => (
                      <div key={finding}>- {finding}</div>
                    ))}
                  </div>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Combined recommendations</p>
                  <div className="analysis-bullets">
                    {activeAnalysis.recommendations.map((recommendation) => (
                      <div key={recommendation}>- {recommendation}</div>
                    ))}
                  </div>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Combined attacker simulation</p>
                  <p>{activeAnalysis.attacker_simulation}</p>
                </div>

                {llmAnalysis && llmAnalysis.model !== 'rules-engine' && (
                  <div className="ai-section">
                    <p className="analysis-card-label">Metadata analysis</p>
                    <p>{llmAnalysis.summary}</p>
                  </div>
                )}

                {visualAnalysis && (
                  <>
                    <div className="ai-section">
                      <p className="analysis-card-label">Visual analysis</p>
                      <p>{visualAnalysis.summary}</p>
                    </div>
                    {visualAnalysis.exposed_elements.length > 0 && (
                      <div className="ai-section">
                        <p className="analysis-card-label">Visible risk elements</p>
                        <div className="analysis-bullets">
                          {visualAnalysis.exposed_elements.map((element) => (
                            <div key={element}>- {element}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {activeAnalysis.fallback_reason && (
                  <div className="ai-section">
                    <p className="analysis-card-label">Fallback reason</p>
                    <p>{activeAnalysis.fallback_reason}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="ai-section">
                <p>
                  {hasMetadata
                    ? 'The metadata is ready. A deeper AI summary is only available when a local text or vision model is installed.'
                    : 'No metadata was found in this image, so no AI summary is available.'}
                </p>
              </div>
            )}

            {aiLoading && (
              <div className="ai-section">
                <p className="analysis-card-label">LLM loading</p>
                <p>The metadata is already ready. The local LLM chat and vision review are still loading.</p>
              </div>
            )}

            {aiError && (
              <div className="ai-section ai-section-error">
                <p className="analysis-card-label">AI fallback</p>
                <p>{aiError}</p>
              </div>
            )}

            {canRunDeepAnalysis && !aiLoading && (
              <button type="button" className="secondary-cta" onClick={onRunDeepAnalysis}>
                REFRESH AI SUMMARY
              </button>
            )}
            </div>
          </div>
        )}
      </div>

      {sensitiveKeys.length > 0 && (
        <div className="sensitive-box">
          <p className="analysis-card-label">Sensitive fields detected</p>
          <div className="sensitive-chip-row">
            {sensitiveKeys.map((key) => (
              <span key={key} className="sensitive-chip">
                {key}
              </span>
            ))}
          </div>
        </div>
      )}

      {sanitizeError && <div className="inline-error">{sanitizeError}</div>}

      <div className="action-row">
        <button type="button" className="secondary-cta" onClick={onDownload}>
          EXPORT SCAN PACKAGE
        </button>
        {file && (
          <button type="button" className="secondary-cta" onClick={handleSanitize} disabled={sanitizing}>
            {sanitizing ? 'SANITIZING...' : 'SANITIZE & DOWNLOAD'}
          </button>
        )}
      </div>
    </section>
  );
}
