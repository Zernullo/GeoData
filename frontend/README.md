# GeoData Frontend

React frontend for the GeoData privacy-analysis workflow. It uploads images to the FastAPI backend, renders extracted EXIF metadata, shows risk scoring, displays structured metadata and visual findings, and lets the user download a sanitized image.

## Features

- Drag-and-drop image upload
- EXIF overview, grouped, raw, and LLM tabs
- Privacy risk scoring from sensitive metadata
- Metadata-based AI summary
- Optional vision-model review of visible privacy leaks
- Local scan history with `localStorage`
- Terminal-style activity log
- Sanitized image download

## Product Notes

- The frontend presents a hybrid privacy scanner: fast metadata review first, then optional text and vision enrichment
- If an uploaded image has no EXIF metadata, the UI can still run a vision-only privacy review when a local vision model is available
- The summary source is surfaced in the results view so users can tell when a local LLM was used

## Requirements

- Node.js 18+
- npm
- GeoData backend running on `http://localhost:8000` by default
- Ollama with `gemma3:4b` available through the backend

## Development

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on `http://localhost:5173`.

## Environment

Set a custom backend URL with:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## Backend Contract

The frontend calls:

- `POST /api/extract-exif-json`
- `POST /api/sanitize-image`

The extraction endpoint returns raw EXIF plus a rapid `llm_analysis` object, and the deeper analysis endpoint can also return `visual_analysis` and `combined_analysis`:

```ts
interface LlmAnalysis {
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_score: number;
  summary: string;
  key_findings: string[];
  recommendations: string[];
  sensitive_fields: string[];
  model: string;
  provider: string;
}
```

The current app setup expects the backend local model to be `gemma3:4b`.

## Verification

```bash
npm run lint
npm run build
```
