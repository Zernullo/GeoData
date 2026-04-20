import { useMemo, useState } from 'react';

import { API_ENDPOINTS } from '../../constants/config';
import type { ExifData, LlmAnalysis, PipelineMeta } from '../../types/exif';
import { formatExifValue, getSensitiveKeys, groupExifData, riskScore } from '../../utils/exifUtils';

interface ResultsPanelProps {
  result: ExifData;
  llmAnalysis?: LlmAnalysis | null;
  pipeline?: PipelineMeta | null;
  aiLoading: boolean;
  aiError: string | null;
  canRunDeepAnalysis: boolean;
  onRunDeepAnalysis: () => void;
  onDownload: () => void;
  file?: File | null;
}

type TabType = 'overview' | 'categories' | 'raw' | 'ai';

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
  const activeRisk = llmAnalysis
    ? { score: llmAnalysis.risk_score, level: llmAnalysis.risk_level, color: fallbackRisk.color }
    : fallbackRisk;
  const sensitiveKeys = getSensitiveKeys(result);
  const groupedData = groupExifData(result);
  const overviewRows = useMemo(() => buildOverviewRows(result), [result]);
  const rawJson = useMemo(() => JSON.stringify(result, null, 2), [result]);
  const aiSourceLabel = llmAnalysis
    ? llmAnalysis.analysis_mode === 'ollama'
      ? `Local LLM (${llmAnalysis.model})`
      : 'Rules Engine'
    : 'Rules Engine';
  const summaryAvailabilityLabel = llmAnalysis ? 'Available' : hasMetadata ? 'Metadata only' : 'Not available';

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
            {llmAnalysis?.summary ?? 'The metadata scan is ready. The AI summary will appear automatically when it finishes.'}
          </p>
        </div>

        <div className="results-meter">
          <span className="results-meter-label">Risk score</span>
          <strong>{activeRisk.score}/100</strong>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${activeRisk.score}%`, background: activeRisk.color }} />
          </div>
          <span className="results-meter-caption">
            {llmAnalysis?.analysis_mode === 'ollama'
              ? `AI summary finished in ${llmAnalysis.latency_ms}ms${llmAnalysis.cached ? ' - cache hit' : ''}`
              : `Metadata extracted in ${pipeline?.extract_ms ?? 0}ms`}
          </span>
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
            when, and how a photo was created.
          </p>
        </div>
        <div className="metadata-help-chips">
          <span className="metadata-help-chip">Location</span>
          <span className="metadata-help-chip">Time</span>
          <span className="metadata-help-chip">Device</span>
          <span className="metadata-help-chip">Software</span>
          <span className="metadata-help-chip">Serial IDs</span>
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
            <strong>AI summary</strong>
            <p>
              {aiLoading
                ? 'Generating now'
                : llmAnalysis?.analysis_mode === 'ollama'
                  ? `Ready from ${llmAnalysis.model}`
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
            {llmAnalysis ? (
              <>
                <div className="ai-section">
                  <p className="analysis-card-label">Summary source</p>
                  <p>{aiSourceLabel}</p>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Summary</p>
                  <p>{llmAnalysis.summary}</p>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Key findings</p>
                  <div className="analysis-bullets">
                    {llmAnalysis.key_findings.map((finding) => (
                      <div key={finding}>- {finding}</div>
                    ))}
                  </div>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Recommendations</p>
                  <div className="analysis-bullets">
                    {llmAnalysis.recommendations.map((recommendation) => (
                      <div key={recommendation}>- {recommendation}</div>
                    ))}
                  </div>
                </div>

                <div className="ai-section">
                  <p className="analysis-card-label">Attacker Simulation</p>
                  <p>{llmAnalysis.attacker_simulation}</p>
                </div>
              </>
            ) : (
              <div className="ai-section">
                <p>
                  {hasMetadata
                    ? 'The metadata is ready. An AI summary is only available when a text-based local model is installed.'
                    : 'No metadata was found in this image, so no AI summary is available.'}
                </p>
              </div>
            )}

            {aiLoading && (
              <div className="ai-section">
                <p className="analysis-card-label">Background review</p>
                <p>The metadata is already ready. The AI summary is still being generated.</p>
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
