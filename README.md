# GeoData

GeoData is a full-stack image privacy analysis app for research and demos. It extracts EXIF data, highlights sensitive fields like GPS coordinates and timestamps, runs a local metadata review through Ollama, optionally inspects the image itself for visible privacy leaks, and can export a sanitized copy of the image.

## What It Does

- Upload an image from the React frontend
- Extract raw EXIF metadata in the FastAPI backend
- Score privacy risk from sensitive metadata fields
- Generate a structured privacy summary from the EXIF metadata with a local Ollama model
- Optionally run a local vision model to flag visible privacy leaks in the scene or background
- Download a metadata-stripped copy of the image

## Sample Cases

### 1. GPS-heavy photo

- EXIF contains `GPSLatitude`, `GPSLongitude`, `DateTimeOriginal`, and camera details
- Expected result: high-risk summary with location and timing warnings

### 2. Device-and-time metadata only

- EXIF contains `Make`, `Model`, `DateTime`, and `Software`
- Expected result: medium-risk summary focused on device identification and activity timing

### 3. No EXIF metadata

- Image has no readable EXIF payload
- Expected result: metadata scan still works, and a vision-capable local model can still review visible privacy leaks

## Stack

### Frontend
- React 19
- TypeScript
- Vite
- Tailwind CSS

### Backend
- Python 3.13
- FastAPI
- Pillow
- piexif
- pillow-heif
- Ollama with the local model `gemma3:4b`
- Ollama with a local vision-capable model such as `gemma3:4b`

## Project Structure

```text
GeoData/
|- frontend/
|  |- src/
|  |- package.json
|  `- README.md
|- backend/
|  |- main.py
|  |- extract_exif.py
|  |- local_LLM.py
|  |- sanitize_image.py
|  |- requirements.txt
|  `- Images/control/
|- README.md
`- LICENSE
```

## Prerequisites

- Python 3.13+
- Node.js 18+
- npm
- Ollama running locally

## Ollama Setup

If someone else is setting this project up for the first time, use this sequence before starting the backend.

### 1. Install Ollama

- Download and install Ollama for your operating system from the official Ollama site.
- After install, make sure the Ollama app or service is running locally.

### 2. Pull A Local Model

Windows PowerShell:

```powershell
"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" pull gemma3:4b
```

If `ollama` is already on your `PATH`, you can also run:

```powershell
ollama pull gemma3:4b
```

### 3. Verify Ollama Is Ready

```powershell
ollama list
```

You should see `gemma3:4b` in the output.

### 4. Keep Ollama Running

GeoData expects the local Ollama API at:

- `http://127.0.0.1:11434`

If you use a different Ollama host or need to point to the same local model explicitly, set:

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `OLLAMA_VISION_MODEL`

Example in PowerShell:

```powershell
$env:OLLAMA_MODEL="gemma3:4b"
$env:OLLAMA_VISION_MODEL="gemma3:4b"
```

## Backend Setup

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

## Frontend Setup

```powershell
cd frontend
npm install
```

## Run Locally

### Terminal 1 - backend

```powershell
cd backend
.\venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

Backend URLs:

- App: `http://localhost:8000`
- Swagger docs: `http://localhost:8000/docs`
- LLM health check: `http://localhost:8000/api/health/llm`

### Terminal 2 - frontend

```powershell
cd frontend
npm run dev
```

Frontend URL:

- App: `http://localhost:5173`

## Architecture

```text
React Upload UI
    ->
FastAPI extraction endpoint
    ->
EXIF parser + rules engine
    ->
optional Ollama text summary
    ->
optional Ollama vision summary
    ->
results UI + sanitize/export actions
```

## API

### `GET /`

Health check.

### `GET /api/health/llm`

Reports the configured Ollama text and vision models plus their availability.

### `POST /api/extract-exif`

Returns a summarized EXIF payload plus structured LLM analysis.

### `POST /api/extract-exif-json`

Returns the full EXIF payload and structured LLM analysis.

Example response shape:

```json
{
  "success": true,
  "filename": "photo.jpg",
  "json_file": "exif_data.json",
  "data": {
    "image_path": "backend/Images/control/photo.jpg",
    "total_tags": 42,
    "exif_data": {
      "Make": "Apple",
      "Model": "iPhone 15 Pro",
      "DateTimeOriginal": "2026:04:19 21:30:00"
    }
  },
  "llm_analysis": {
    "risk_level": "HIGH",
    "risk_score": 85,
    "summary": "The metadata reveals device details and capture timing that could identify how and when this image was created.",
    "key_findings": [
      "GPS coordinates are present."
    ],
    "recommendations": [
      "Strip EXIF metadata before sharing."
    ],
    "sensitive_fields": [
      "GPSLatitude",
      "GPSLongitude"
    ],
    "model": "gemma3:4b",
    "provider": "ollama"
  }
}
```

### `POST /api/sanitize-image`

Returns a metadata-stripped copy of the uploaded image.

## Notes

- Uploaded and generated files are stored under `backend/Images/control/`
- The frontend can target a different backend with `VITE_API_BASE_URL`
- The current local metadata summary path is configured around `gemma3:4b`
- The default local vision summary path prefers `gemma3:4b` when available
- The backend can target a different Ollama host or model with `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `OLLAMA_VISION_MODEL`
- The rapid scan still uses metadata only so the first response stays fast
- The deeper review can merge metadata findings with vision-based scene findings

## Limitations

- Visual review quality depends on the local vision model and may miss subtle clues
- Local summary quality depends on the local `gemma3:4b` responses
- Social-media platform scraping/downloader automation is intentionally out of scope

## Verification

- `npm run lint`
- `npm run build`
- `python -m compileall backend\main.py backend\local_LLM.py backend\extract_exif.py backend\sanitize_image.py`

## Out of Scope

The social-media image downloader / automation workflow is intentionally not implemented in this pass.
