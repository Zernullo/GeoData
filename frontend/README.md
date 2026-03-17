# GeoData Frontend

**Next-generation EXIF metadata extraction and privacy risk analysis tool**

A professional-grade web application for analyzing image metadata, detecting sensitive information (GPS coordinates, camera details, timestamps), and assessing privacy risks. Built with React 19, TypeScript, and modern web standards.

## 🎯 Overview

GeoData Frontend is a TypeScript/React application that:
- Extracts comprehensive EXIF data from uploaded images (JPG, PNG, TIFF, HEIC, WEBP)
- Analyzes privacy risks based on sensitive metadata presence
- Provides real-time visual feedback and risk scoring (LOW/MEDIUM/HIGH)
- Maintains searchable history of recent scans with localStorage persistence
- Exports raw EXIF data as JSON for further analysis
- Communicates with FastAPI backend for advanced extraction capabilities

## 📋 Features

### Core Functionality
- **Drag-and-drop file upload** - Intuitive image selection with visual feedback
- **Smart EXIF parsing** - Handles multiple image formats and supported codecs
- **Privacy risk assessment** - Automatic scoring based on sensitive field detection
- **Detailed metadata views** - Overview (formatted) and raw (JSON) modes
- **GPS detection** - Flags geolocation data with visual warnings
- **Scan history** - Cache recent uploads locally with instant access
- **JSON export** - Download raw EXIF data for offline analysis

### Privacy Features
- Identifies 14+ sensitive EXIF fields (GPS, camera model, timestamps, serial numbers)
- Risk scoring algorithm:
  - GPS data: +40 points (direct location exposure)
  - Camera info: +20 points (device identification)
  - Timestamps: +15 points (temporal/spatial patterns)
  - Serial numbers: +15 points (unique device IDs)
  - Software: +10 points (system information)
- Color-coded risk levels (green/yellow/red visualization)
- Visual progress bar and score display
- Privacy impact explanation for each field

### Developer Experience
- Full TypeScript support with strict mode enabled
- Organized modular component structure
- Professional terminal-style logging system
- ESLint + Tailwind CSS for code quality
- Vite for lightning-fast HMR during development
- Type-safe API communication

## 🏗️ Project Architecture

### Directory Structure
```
frontend/
├── src/
│   ├── components/           # React components
│   │   ├── ImageUploader.tsx # Main orchestrator component (~130 lines)
│   │   └── upload/           # Sub-components (each ~40-60 lines)
│   │       ├── Header.tsx    # Title and metadata display
│   │       ├── UploadZone.tsx# Drag-drop file input area
│   │       ├── ResultsPanel.tsx # Tabbed EXIF results display
│   │       └── Sidebar.tsx   # Terminal log + scan history
│   ├── types/
│   │   └── exif.ts           # TypeScript interfaces (ExifData, Upload)
│   ├── utils/
│   │   └── exifUtils.ts      # Privacy risk calculation algorithm
│   ├── constants/
│   │   └── exif.ts           # Sensitive field definitions
│   ├── hooks/
│   │   ├── useExifHistory.ts # History + localStorage management
│   │   └── useTerminalLog.ts # Terminal-style logging system
│   ├── assets/               # Images, fonts, static files
│   ├── App.tsx               # Root component wrapper
│   ├── App.css               # Animations and utility styles
│   ├── main.tsx              # React entry point
│   └── index.css             # Global styles + Tailwind directives
├── public/                   # Static assets (favicons, metadata)
├── .gitignore               # Git exclusions (dependencies, builds, etc.)
├── eslint.config.js         # ESLint configuration
├── tsconfig.json            # TypeScript root configuration
├── tsconfig.app.json        # TypeScript app-specific settings
├── tsconfig.node.json       # TypeScript build tool settings
├── vite.config.ts           # Vite bundler configuration
├── package.json             # Dependencies and scripts
└── README.md                # This file
```

### Component Hierarchy
```
ImageUploader (main orchestrator)
├── Header (branding)
├── UploadZone (file input + drag-drop)
├── ResultsPanel (tabbed EXIF display)
│   ├── Risk Banner
│   ├── Quick Stats
│   ├── Overview Tab
│   └── Raw Tab (JSON)
└── Sidebar (right panel)
    ├── Terminal Log (operation history)
    └── Scan History (recent uploads)
```

### State Management Architecture
- **ImageUploader.tsx**: Orchestrates file state, EXIF results, loading states
- **Custom Hooks**:
  - `useExifHistory()` - Manages upload history with localStorage sync
  - `useTerminalLog()` - Manages operation logs with rolling buffer
- **No external state library** - React hooks provide sufficient complexity for current scope
- **localStorage**: Persists last 8 uploads (max size ~100KB per entry with base64 preview)

## 🚀 Getting Started

### Prerequisites
- **Node.js** 18 or higher
- **npm** or yarn package manager
- **Backend API** running on `http://localhost:8000`

### Installation

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start development server (Vite HMR enabled)
npm run dev

# Build for production
npm run build

# Preview production build locally
npm run preview

# Run ESLint code quality checks
npm run lint
```

The application will be available at `http://localhost:5173`

### Development Workflow

```bash
# Terminal 1: Start frontend dev server
npm run dev

# Terminal 2: Start backend API (in backend/ folder)
python main.py

# Application runs at localhost:5173
# Backend API at localhost:8000
```

## 🔌 API Integration

The frontend communicates with the backend via a single endpoint:

**Endpoint:** `POST http://localhost:8000/api/extract-exif-json`

**CORS**: Must be enabled for `http://localhost:5173`

### Request Format
```typescript
FormData {
  file: File  // Image file object from <input type="file">
}
```

### Response Format
```typescript
{
  success: boolean,
  data?: {
    image_path: string,        // Path where image was stored
    total_tags: number,        // Count of EXIF tags found
    exif_data: {               // Raw EXIF metadata object
      [key: string]: unknown
    }
  },
  error?: string               // Error message if success=false
}
```

### Example Request/Response
```javascript
// Request
const formData = new FormData();
formData.append('file', imageFile);
const response = await fetch('http://localhost:8000/api/extract-exif-json', {
  method: 'POST',
  body: formData
});

// Response
{
  success: true,
  data: {
    image_path: "/uploads/photo_2024.jpg",
    total_tags: 47,
    exif_data: {
      Make: "Apple",
      Model: "iPhone 15 Pro",
      DateTime: "2024-03-17T14:23:45",
      GPSLatitude: "37.7749",
      GPSLongitude: "-122.4194",
      // ... more fields
    }
  }
}
```

## 📊 Privacy Risk Scoring Algorithm

The privacy assessment uses a **weighted point system** that evaluates sensitive fields:

| Field Category | Points | Sensitivity | Reason |
|---|---|---|---|
| GPS Latitude/Longitude | +40 | **CRITICAL** | Direct location exposure |
| Camera Make/Model | +20 | **HIGH** | Unique device identification |
| GPS Timestamp/Altitude | +15 | **HIGH** | Temporal/spatial patterns |
| Serial Number/Lens ID | +15 | **HIGH** | Unique device identifiers |
| DateTime Fields | +15 | **MEDIUM** | Exposure patterns |
| Software | +10 | **MEDIUM** | System information leakage |

### Risk Level Determination
```
Score 60-100: HIGH   🔴 Red    - Location + device info exposed
Score 30-59:  MEDIUM 🟡 Yellow - Some sensitive data present
Score 0-29:   LOW    🟢 Green  - Minimal privacy concerns
```

### Sensitive Fields Tracked
```typescript
[
  'GPSLatitude', 'GPSLongitude',           // Location
  'GPSLatitudeRef', 'GPSLongitudeRef',     // Location reference
  'GPSAltitude', 'GPSTimestamp',           // Altitude & time
  'GPSDateStamp',                          // Date stamp
  'Make', 'Model',                         // Camera device
  'Software',                              // Software version
  'DateTime', 'DateTimeOriginal',          // Capture time
  'SerialNumber', 'LensSerialNumber'       // Device IDs
]
```

## 💾 Data Persistence

### localStorage Schema
```javascript
// Key: 'geodata_history'
// Value: JSON array of Upload objects (max 8 entries)
[
  {
    id: "1234567890",
    timestamp: "2024-03-17T14:23:45Z",
    fileName: "vacation_photo.jpg",
    preview: "data:image/jpeg;base64,/9j/4AAQSkZJRgABA...",
    hasGPS: true,
    tagCount: 47
  },
  // ... up to 8 entries
]
```

### Important Notes
- Previews stored as base64 (typically 10-30KB each)
- Max localStorage size depends on browser (usually 5-10MB)
- Gracefully degrades if localStorage unavailable (private browsing mode)
- Automatic cleanup: keeps only newest 8 entries

## 🎨 Styling & Theming

### Design Philosophy
- **Dark theme** with neon accents (cyber/terminal aesthetic)
- **Mobile-responsive** using Tailwind CSS Grid
- **Accessibility** with semantic HTML and ARIA labels
- **Smooth animations** for user feedback

### Color Palette
```css
--green: #00ffa3         /* Primary/Success */
--red: #ff4d6d           /* Danger/High Risk */
--yellow: #f5a623        /* Warning/Medium Risk */
--dark: #0a0e27          /* Background */
--muted: #64748b         /* Secondary text */
--border: #1e293b        /* Dividers */
```

### Utilities
- `@keyframes fadeIn` - 300ms entrance animation
- `@keyframes pulse` - Continuous subtle pulse effect
- `.neon-border` - Glowing border effect on active elements
- `.drag-over` - Visual feedback during drag-and-drop

## 🔒 Security Considerations

- **Client-side processing** - EXIF analysis happens locally (no external tracking)
- **No data transmission** - Results stay on user's device except API call
- **localStorage isolation** - Limited to current origin only
- **Type safety** - TypeScript strict mode prevents runtime type errors
- **No external analytics** - No tracking pixels or data collection

## 🛠️ Development Guidelines

### Code Style
- **TypeScript strict mode** enabled (no implicit any)
- **ESLint** enforces consistency
- **Functional components** with React hooks only (no class components)
- **Type-only imports** for compile-time safety: `import type { Foo } from '...'`
- **Custom hooks** for complex state logic (useExifHistory, useTerminalLog)

### File Naming Conventions
- Components: PascalCase (Header.tsx)
- Utilities: camelCase (exifUtils.ts)
- Types/Interfaces: PascalCase (exif.ts)
- Hooks: camelCase starting with 'use' (useExifHistory.ts)

### Adding New Features

1. **Create types in `src/types/`**
   ```typescript
   export interface MyFeature {
     id: string;
     value: number;
   }
   ```

2. **Extract business logic to `src/utils/`**
   ```typescript
   export function processData(input: MyFeature): Result {
     // Logic here
   }
   ```

3. **Create custom hook if needed: `src/hooks/useMyFeature.ts`**
   ```typescript
   export function useMyFeature() {
     const [state, setState] = useState<MyFeature[]>([]);
     // Hook logic
     return { state, setState };
   }
   ```

4. **Create component in `src/components/`**
   ```typescript
   export function MyComponent() {
     const { state } = useMyFeature();
     return <div>{/* JSX */}</div>;
   }
   ```

5. **Add constants to `src/constants/`**
   ```typescript
   export const MY_CONSTANT = 'value';
   ```

## 🧪 Testing Methodology

### Manual Testing Checklist
- [ ] Drag-and-drop file upload works
- [ ] File preview displays correctly
- [ ] EXIF extraction calls backend
- [ ] Risk score calculates properly
- [ ] Overview and raw tabs display data
- [ ] History persists after page refresh
- [ ] Terminal log updates in real-time
- [ ] Error states handled gracefully

### Sample Test Images
- **High risk** (GPS + camera): smartphone photos with location enabled
- **Medium risk** (metadata only): DSLR photos without GPS
- **Low risk** (minimal data): screenshots, converted images

## 🐛 Troubleshooting

### Issue: Backend connection fails
```bash
# Check backend is running
curl http://localhost:8000/

# Check CORS headers
curl -i -X OPTIONS http://localhost:8000/api/extract-exif-json

# Verify in browser console
# Look for CORS error messages in Network tab
```

### Issue: localStorage errors
- **Solution**: Not available in private/incognito mode, disable if needed
- **Check**: `localStorage.getItem('geodata_history')` in console
- **Quota exceeded**: Clear browser cache/storage

### Issue: Build errors
```bash
# Clear cache
rm -rf dist node_modules
npm install

# Rebuild
npm run build

# Check TypeScript
npx tsc --noEmit
```

### Issue: HMR not working (dev server)
```bash
# Restart dev server
npm run dev

# Check Vite config
cat vite.config.ts

# Verify port 5173 available
lsof -i :5173  # macOS/Linux
netstat -ano | findstr :5173  # Windows
```

## 📦 Dependencies

### React Ecosystem
- **react** 19.2.0 - UI framework
- **react-dom** 19.2.0 - DOM rendering

### Build Tools
- **vite** 7.3.1 - Lightning-fast build tool
- **@vitejs/plugin-react** - React HMR support

### Styling
- **tailwindcss** 4.2.1 - Utility-first CSS framework

### Development
- **typescript** - Static type checking
- **eslint** - Code quality enforcement
- **@vitejs/plugin-react** - Fast Refresh support

## 📚 Documentation References

- [React 19 Docs](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vite Guide](https://vitejs.dev/guide/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [EXIF Specification](https://en.wikipedia.org/wiki/Exif)

## 🔄 Deployment

### Production Build
```bash
npm run build
# Creates optimized dist/ folder

npm run preview
# Test production build locally
```

### Deployment Targets
- **Vercel**: `vercel deploy`
- **Netlify**: Connect git repo
- **GitHub Pages**: Configure package.json `homepage`
- **Docker**: Use Node.js base image with `npm run build`

### Environment Setup
Create `.env.production.local` for production:
```env
VITE_API_URL=https://api.example.com
```

## 📜 License

MIT License - See LICENSE file in project root

## 👥 Contributing

This is a personal project. For contributions, please:
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Support

For issues or questions:
1. Check troubleshooting section above
2. Review code comments and docstrings
3. Check browser console for errors
4. Verify backend API is running

---

## 📋 Version History

| Version | Date | Changes |
|---|---|---|
| 2.0 | March 17, 2024 | Complete rewrite - modular architecture, cyber theme, professional documentation |
| 1.5 | March 10, 2024 | Code organization and refactoring |
| 1.0 | March 1, 2024 | Initial release with basic EXIF extraction |

**Status**: Production Ready ✅

**Last Updated**: March 17, 2024

**Maintainer**: [Your Name]
