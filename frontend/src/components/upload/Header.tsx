import type { LlmHealthResponse } from '../../types/exif';

interface HeaderProps {
  llmHealth: LlmHealthResponse | null;
}

export function Header({ llmHealth }: HeaderProps) {
  const workflowSteps = [
    'Upload an image',
    'Review the quick metadata scan',
    'Read the AI metadata summary',
  ];

  return (
    <header className="hero-shell animate-fadeDown">
      <div className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">GeoData Privacy Lab</p>
          <h1 className="hero-title">
            Upload one image,
            <span className="hero-title-accent"> get a privacy review from the metadata automatically.</span>
          </h1>
          <p className="hero-subtitle">
            GeoData extracts EXIF metadata immediately, shows the privacy-sensitive fields in plain language,
            and then enriches the result with your local model in the background.
          </p>
        </div>

        <div className="hero-meta">
          <div className="hero-stat">
            <span className="hero-stat-label">AI Model</span>
            <strong>{llmHealth?.model ?? 'Checking local model...'}</strong>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Workflow</span>
            <strong>Single automatic scan</strong>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-label">Backend</span>
            <strong>{llmHealth?.base_url ?? 'http://localhost:8000'}</strong>
          </div>
        </div>
      </div>

      <div className="control-strip">
        <div className="workflow-guide">
          <p className="label-text mb-2">How it works</p>
          <div className="workflow-steps" aria-label="How the scan works">
            {workflowSteps.map((step, index) => (
              <div className="workflow-step" key={step}>
                <span className="workflow-step-number">{index + 1}</span>
                <span className="workflow-step-text">{step}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="status-pill">
          <span className={llmHealth?.available ? 'status-dot status-dot-live' : 'status-dot'} />
          {llmHealth ? (llmHealth.available ? 'Local model detected' : 'Model not ready') : 'Checking Ollama status'}
        </div>
      </div>
    </header>
  );
}
