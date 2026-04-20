# GeoData Frontend

React frontend for the GeoData privacy-analysis workflow. It uploads images to the FastAPI backend, renders extracted EXIF metadata, shows risk scoring, displays structured metadata findings, and lets the user download a sanitized image.

## Features

- Drag-and-drop image upload
- EXIF overview, grouped, raw, and LLM tabs
- Privacy risk scoring from sensitive metadata
- Metadata-based AI summary
- Local scan history with `localStorage`
- Terminal-style activity log
- Sanitized image download

## Product Notes

- The frontend presents a metadata privacy scanner, not an image-content classifier
- If an uploaded image has no EXIF metadata, the UI still shows the scan result but intentionally skips the AI summary
- The summary source is surfaced in the results view so users can tell when a local LLM was used

## Requirements

- Node.js 18+
- npm
- GeoData backend running on `http://localhost:8000` by default
- Ollama with `qwen:7b` available through the backend

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

The extraction endpoint returns raw EXIF plus a structured `llm_analysis` object:

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

The current app setup expects the backend metadata-summary model to be `qwen:7b`.

## Verification

```bash
npm run lint
npm run build
```
