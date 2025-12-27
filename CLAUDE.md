# Maestro4D Monorepo

Construction project management platform for processing, viewing, and querying construction plan PDFs with AI-powered context extraction.

## Structure

```
apps/
├── web-internal/     # Main React/Vite dashboard + FastAPI backend (primary app)
├── viewm4d/          # Newer standalone PDF viewer (React/Vite, minimal)
├── viewm4d-legacy/   # Original plan retrieval app (FastAPI + HTML)
└── ios-customer/     # SwiftUI iPad app (placeholder/stub)

packages/
└── api/              # PotreeConverter tools for point cloud processing
```

## Key Commands

```bash
# Install dependencies
pnpm install
cd apps/web-internal/backend && pip install -r requirements.txt

# Run web-internal frontend (port 5173)
pnpm dev:web

# Run web-internal backend (port 8000)
cd apps/web-internal/backend && uvicorn app.main:app --reload

# Or from root:
pnpm dev:api  # Note: this targets packages/api, may need adjustment
```

## Architecture

- **Frontend**: React 19 + Vite + TailwindCSS 4 + TypeScript
- **Backend**: FastAPI + SQLAlchemy + SQLite
- **AI Services**: Google Gemini (primary), Grok (secondary) for PDF analysis
- **PDF Processing**: PyMuPDF for extraction, PDF.js for rendering

## Key Integrations

- **Gemini API**: Context extraction, natural language search, pointer generation
- **Three.js**: 3D point cloud visualization in web-internal
- **sql.js**: Client-side SQLite for browser persistence
- **react-pdf**: PDF rendering with bounding box overlays

## Data Flow

1. Upload construction PDFs → Backend stores in `uploads/`
2. AI extracts "pointers" (annotated regions with bounding boxes)
3. Pointers stored in SQLite with normalized coordinates
4. Users query via natural language → Gemini retrieves relevant pointers
5. Frontend renders PDF page with highlighted bounding boxes

## Environment Variables

```
GEMINI_API_KEY=...     # Required for AI features
GROK_API_KEY=...       # Optional, secondary AI
```

## Gotchas

- Bounding boxes use normalized coordinates (0-1), not pixels
- Backend runs in `apps/web-internal/backend/`, not `packages/api/`
- The `packages/api/` directory is mostly for PotreeConverter, not the main API
- Large files: `ProjectViewerPage.tsx` (144KB), `ContextPanel.tsx` (145KB), `PdfViewer.tsx` (87KB) - these are god components
- Context tree processing is expensive - uses streaming for large batches
