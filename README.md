# GeoData

A full-stack application for extracting and analyzing image EXIF metadata, including GPS coordinates, camera information, and timestamps. Designed for geolocation mapping and image analysis.

## Project Overview

GeoData provides a web interface to upload images and extract comprehensive metadata including:
- Camera make and model
- Capture date and time
- GPS coordinates (latitude/longitude in decimal format)
- Camera settings (ISO, aperture, shutter speed, etc.)
- Software used
- All raw EXIF data

## Tech Stack

**Frontend:**
- React 19 with TypeScript
- Vite (build tool)
- Tailwind CSS (styling)
- Node.js runtime

**Backend:**
- Python 3.13
- FastAPI (API framework)
- Uvicorn (ASGI server)
- Pillow (image processing)
- piexif (EXIF extraction - robust, more reliable than PIL)
- PIL ExifTags (EXIF tag name mapping)

## Project Structure

```
GeoData/
├── frontend/                 # React TypeScript application
│   ├── src/
│   │   ├── components/       # React components
│   │   │   └── ImageUploader.tsx
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── vite.config.ts        # Vite configuration with React + Tailwind
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                  # Python FastAPI server
│   ├── main.py               # FastAPI application & endpoints
│   ├── extract_exif.py       # EXIF extraction logic
│   ├── images/               # Uploaded images stored here
│   ├── requirements.txt
│   └── __pycache__/
│
├── venv/                     # Python virtual environment
├── README.md
└── LICENSE
```

## Setup Instructions

### Prerequisites
- Python 3.13+
- Node.js 18+
- npm

### Backend Setup

1. **Create and activate virtual environment:**
   ```powershell
   python -m venv venv
   . .\venv\Scripts\Activate.ps1
   ```

2. **Install dependencies:**
   ```powershell
   pip install -r backend/requirements.txt
   ```

3. **Verify installation:**
   ```powershell
   pip list
   ```

### Frontend Setup

1. **Navigate to frontend:**
   ```powershell
   cd frontend
   ```

2. **Install dependencies:**
   ```powershell
   npm install
   ```

## Running the Application

**Terminal 1 - Start Backend API:**
```powershell
cd backend
. ..\venv\Scripts\Activate.ps1
uvicorn main:app --reload
```

Backend runs on: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

**Terminal 2 - Start Frontend:**
```powershell
cd frontend
npm run dev
```

Frontend runs on: `http://localhost:5173`

## API Endpoints

### Health Check
- **GET** `/` - Server status check
  ```
  Response: {"message": "GeoData API is running"}
  ```

### Extract EXIF Data
- **POST** `/api/extract-exif` - Upload image and get analyzed EXIF data
  ```
  Body: FormData with 'file' field containing image
  Response: {
    "success": true,
    "filename": "photo.jpg",
    "data": {
      "camera_make": "Apple",
      "camera_model": "iPhone 15 Pro",
      "datetime": "2024-01-15 14:30:45",
      "software": "iOS 17.2",
      "gps": {"lat": 40.7128, "lon": -74.0060},
      "raw_exif": {...}
    }
  }
  ```

### Extract EXIF as JSON
- **POST** `/api/extract-exif-json` - Upload image and get full EXIF as JSON
  ```
  Body: FormData with 'file' field
  Query: ?output_filename=exif_data.json (optional)
  Response: {
    "success": true,
    "filename": "photo.jpg",
    "json_file": "exif_data.json",
    "data": {
      "image_path": "...",
      "total_tags": 42,
      "exif_data": {...all tags...}
    }
  }
  ```

## Key Features

### Backend (`extract_exif.py`)
- `extract_exif()` - Extract all EXIF metadata from image
- `extract_gps()` - Parse GPS data from EXIF
- `decode_gps_coords()` - Convert DMS to decimal degrees
- `analyze_image()` - High-level function combining all extractions
- `serialize_for_json()` - Convert non-JSON-serializable objects

### Frontend (`ImageUploader.tsx`)
- Drag-and-drop file upload
- Image file validation
- Real-time loading state
- Displays extracted metadata
- Error handling
- Full EXIF data preview (JSON)

## Usage Example

1. Open `http://localhost:5173` in browser
2. Click to select an image or drag-and-drop
3. Click "Upload & Analyze"
4. View extracted camera info, GPS location, and all EXIF data

## CORS Configuration

The API allows requests from:
- `http://localhost:5173` (Vite dev server)
- `http://localhost:3000` (Create React App)

## Supported Image Formats

The backend supports any image format that PIL can open: JPEG, PNG, GIF, TIFF, BMP, etc.

**Important:** For EXIF data to be extracted, the image must contain metadata:
- ✅ **Has EXIF data:** Photos from camera, smartphone, drone
- ❌ **No EXIF data:** Screenshots, edited images (metadata removed), downloaded images, PNG graphics

**Test Images:**
If your images don't have EXIF data, download a sample with GPS info:
```powershell
# From PowerShell in backend folder
curl -o test.jpg "https://github.com/ianare/exif-samples/raw/master/jpg/gps/DSCN0010.jpg"
```

Then upload `test.jpg` - it contains real GPS and camera data!

## Development Notes

- **Frontend auto-reload:** Changes to React code auto-refresh browser
- **Backend auto-reload:** Changes to Python code auto-restart server (with `--reload`)
- **API documentation:** FastAPI auto-generates interactive docs at `/docs`
- **Uploaded images:** Saved to `backend/images/` folder for easy access and review

## Troubleshooting

**Backend won't start:**
- Ensure virtual environment is activated
- Check port 8000 isn't in use
- Verify all dependencies installed: `pip install -r requirements.txt`

**Frontend can't reach backend:**
- Backend must be running on port 8000
- Check CORS settings if getting 403 errors
- Look at browser console (F12) for errors

**JSON file is empty or has no EXIF data:**
- Your image doesn't have EXIF metadata
- Try a photo from a camera or smartphone (not edited or screenshot)
- Download a test image with real EXIF data:
  ```powershell
  curl -o test.jpg "https://github.com/ianare/exif-samples/raw/master/jpg/gps/DSCN0010.jpg"
  ```
- Upload the test image - it contains GPS and camera data

**Getting zero tags:**
- The image file exists but has no EXIF info embedded
- This is normal for screenshots, PNGs, and some edited images
- Solution: Use images taken directly from camera/phone

**Can't find uploaded images:**
- Check: `backend/images/control/`
- Images are saved there after upload
- JSON files are also saved in the same folder with `/api/extract-exif-json` endpoint

## License

See [LICENSE](LICENSE) file for details.

## Author

GeoData Project - Based on school project for image metadata analysis.