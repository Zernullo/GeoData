import { useState } from 'react';
import type { ExifData } from '../../types/exif';

interface ResultsPanelProps {
  result: ExifData;
  llmAnalysis?: string | null;
  onDownload: () => void;
  file?: File | null;
}

const SENSITIVE_FIELDS = [
  'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef',
  'GPSAltitude', 'GPSTimestamp', 'GPSDateStamp', 'Make', 'Model',
  'Software', 'DateTime', 'DateTimeOriginal', 'SerialNumber', 'LensSerialNumber'
];

function riskScore(exif: ExifData): { score: number; level: string; color: string } {
  let score = 0;
  if (exif.GPSLatitude) score += 40;
  if (exif.Make || exif.Model) score += 20;
  if (exif.DateTime || exif.DateTimeOriginal) score += 15;
  if (exif.Software) score += 10;
  const keys = Object.keys(exif);
  if (keys.some(k => k.includes('Serial'))) score += 15;
  score = Math.min(score, 100);
  if (score >= 60) return { score, level: 'HIGH', color: '#ff4d6d' };
  if (score >= 30) return { score, level: 'MEDIUM', color: '#f5a623' };
  return { score, level: 'LOW', color: '#00ffa3' };
}

function groupExifData(exif: ExifData): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {
    Camera: {}, GPS: {}, Timestamps: {}, Image: {}, Other: {}
  };

  Object.entries(exif).forEach(([key, value]) => {
    if (key.includes('GPS') || key.includes('Latitude') || key.includes('Longitude')) {
      groups.GPS[key] = value;
    } else if (key.includes('Make') || key.includes('Model') || key.includes('Software') || key.includes('Serial')) {
      groups.Camera[key] = value;
    } else if (key.includes('DateTime') || key.includes('Time')) {
      groups.Timestamps[key] = value;
    } else if (key.includes('Pixel') || key.includes('Resolution') || key.includes('Width') || key.includes('Height')) {
      groups.Image[key] = value;
    } else {
      groups.Other[key] = value;
    }
  });

  Object.keys(groups).forEach(key => {
    if (Object.keys(groups[key]).length === 0) delete groups[key];
  });

  return groups;
}

type TabType = 'overview' | 'raw' | 'grouped' | 'llm';

export function ResultsPanel({ result, llmAnalysis, onDownload, file }: ResultsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [sanitizing, setSanitizing] = useState(false);

  const risk = riskScore(result);
  const sensitiveKeys = Object.keys(result).filter(k => SENSITIVE_FIELDS.includes(k));
  const groupedData = groupExifData(result);

  const handleSanitize = async () => {
    if (!file) return;
    setSanitizing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('http://localhost:8000/api/sanitize-image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Sanitization failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sanitized-${file.name}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to sanitize image.');
    } finally {
      setSanitizing(false);
    }
  };

  const tabs = (['overview', 'grouped', 'raw', 'llm'] as TabType[]);

  return (
    <div style={{ border: '1px solid var(--border-accent)', borderRadius: '4px', overflow: 'hidden' }}>

      {/* Risk Banner */}
      <div style={{
        background: `${risk.color}15`, borderBottom: `1px solid ${risk.color}40`,
        padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <p style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.15em', marginBottom: '0.25rem' }}>PRIVACY RISK</p>
          <p style={{ color: risk.color, fontFamily: 'var(--display)', fontSize: '1.5rem', fontWeight: 800 }}>{risk.level}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>SCORE</p>
          <div style={{ width: '80px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${risk.score}%`, height: '100%', background: risk.color, transition: 'width 0.6s ease' }} />
          </div>
          <p style={{ color: risk.color, fontSize: '0.7rem', marginTop: '0.4rem' }}>{risk.score}/100</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid var(--border)' }}>
        {[
          { label: 'TOTAL TAGS', value: Object.keys(result).length },
          { label: 'SENSITIVE', value: sensitiveKeys.length },
          { label: 'GPS DATA', value: result.GPSLatitude ? 'YES' : 'NO' },
        ].map((stat, i) => (
          <div key={i} style={{ padding: '1rem', borderRight: i < 2 ? '1px solid var(--border)' : 'none', textAlign: 'center' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.6rem', letterSpacing: '0.12em', marginBottom: '0.4rem' }}>{stat.label}</p>
            <p style={{
              fontFamily: 'var(--display)', fontSize: '1.4rem', fontWeight: 700,
              color: stat.label === 'GPS DATA' && result.GPSLatitude ? '#ff4d6d' : 'var(--text)',
            }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: 1, padding: '0.75rem', fontFamily: 'var(--mono)', fontSize: '0.65rem',
            letterSpacing: '0.15em', color: activeTab === tab ? 'var(--green)' : 'var(--muted)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            borderBottom: activeTab === tab ? '2px solid var(--green)' : '2px solid transparent',
          }}>
            {tab.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: '1.5rem', maxHeight: '400px', overflowY: 'auto' }}>

        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[
              { label: 'Camera', value: [result.Make, result.Model].filter(Boolean).join(' ') },
              { label: 'Captured', value: result.DateTimeOriginal || result.DateTime },
              { label: 'Software', value: result.Software },
              { label: 'Resolution', value: result.PixelXDimension ? `${result.PixelXDimension} x ${result.PixelYDimension}` : undefined },
              { label: 'GPS Ref', value: result.GPSLatitudeRef ? `${result.GPSLatitudeRef} / ${result.GPSLongitudeRef}` : undefined },
            ].filter(r => r.value).map((row, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '0.6rem 0', borderBottom: '1px solid var(--border)',
              }}>
                <span style={{ color: 'var(--muted)', fontSize: '0.7rem', letterSpacing: '0.1em' }}>{row.label}</span>
                <span style={{ color: 'var(--text)', fontSize: '0.75rem', textAlign: 'right', maxWidth: '60%' }}>
                  {String(row.value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'grouped' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {Object.entries(groupedData).map(([category, fields]) => (
              <div key={category} style={{ border: '1px solid var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ background: 'var(--surface2)', padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)' }}>
                  <p style={{ color: 'var(--muted)', fontSize: '0.65rem', letterSpacing: '0.15em' }}>{category.toUpperCase()}</p>
                </div>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(fields).map(([key, value]) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.7rem' }}>
                      <span style={{ color: 'var(--muted)', minWidth: '140px' }}>{key}</span>
                      <span style={{ color: 'var(--text)', textAlign: 'right', wordBreak: 'break-all' }}>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'raw' && (
          <div style={{ background: 'var(--surface2)', borderRadius: '4px', padding: '1rem' }}>
            {Object.entries(result).map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', gap: '1rem', padding: '0.35rem 0',
                borderBottom: '1px solid var(--border)', fontSize: '0.7rem',
              }}>
                <span style={{ color: 'var(--green)', minWidth: '160px', flexShrink: 0, opacity: SENSITIVE_FIELDS.includes(k) ? 1 : 0.6 }}>
                  {k}
                </span>
                <span style={{ color: 'var(--muted)', wordBreak: 'break-all' }}>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v).slice(0, 80)}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'llm' && (
          <div style={{ color: 'var(--text)', fontSize: '0.8rem', whiteSpace: 'pre-line', fontFamily: 'var(--mono)', lineHeight: 1.8 }}>
            {llmAnalysis && llmAnalysis.trim().length > 0
              ? llmAnalysis
              : <span style={{ color: 'var(--muted)' }}>No LLM analysis available for this image.</span>}
          </div>
        )}
      </div>

      {/* Sensitive Fields Warning */}
      {sensitiveKeys.length > 0 && (
        <div style={{
          margin: '0 1.5rem 1.5rem', background: 'rgba(255,77,109,0.06)',
          border: '1px solid rgba(255,77,109,0.2)', borderRadius: '4px', padding: '1rem',
        }}>
          <p style={{ color: '#ff4d6d', fontSize: '0.65rem', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>
            ⚠ SENSITIVE FIELDS DETECTED
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {sensitiveKeys.map(k => (
              <span key={k} style={{
                background: 'rgba(255,77,109,0.1)', border: '1px solid rgba(255,77,109,0.3)',
                color: '#ff4d6d', fontSize: '0.6rem', padding: '2px 8px', borderRadius: '2px',
              }}>{k}</span>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ padding: '0 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <button onClick={onDownload} style={{
          width: '100%', background: 'transparent', border: '1px solid var(--border)',
          color: 'var(--green)', padding: '0.65rem', fontFamily: 'var(--mono)',
          fontSize: '0.7rem', letterSpacing: '0.15em', cursor: 'pointer', borderRadius: '4px', fontWeight: 700,
        }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--green)'; (e.target as HTMLButtonElement).style.color = 'var(--green)'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.target as HTMLButtonElement).style.color = 'var(--green)'; }}
        >
          [ EXPORT JSON ]
        </button>
        {file && (
          <button onClick={handleSanitize} disabled={sanitizing} style={{
            width: '100%', background: 'transparent', border: '1px solid var(--border)', color: 'var(--green)',
            padding: '0.65rem', fontFamily: 'var(--mono)', fontSize: '0.7rem',
            letterSpacing: '0.15em', cursor: sanitizing ? 'not-allowed' : 'pointer',
            borderRadius: '4px', opacity: sanitizing ? 0.6 : 1, fontWeight: 700,
          }}
          onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--green)'; (e.target as HTMLButtonElement).style.color = 'var(--green)'; }}
          onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.target as HTMLButtonElement).style.color = 'var(--green)'; }}
          >
            {sanitizing ? '[ SANITIZING... ]' : '[ SANITIZE & DOWNLOAD ]'}
          </button>
        )}
      </div>
    </div>
  );
}