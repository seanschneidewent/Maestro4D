# viewm4d-legacy

Original plan retrieval prototype - FastAPI backend serving HTML frontend for natural language search of construction plans.

## Commands

```bash
cd backend && pip install -r requirements.txt
cd backend && uvicorn main:app --reload --port 8000
# Opens at http://localhost:8000
```

## Structure

```
backend/
├── main.py            # FastAPI server + static file serving
└── requirements.txt
frontend/
└── index.html         # Single-page app with PDF.js
```

## How It Works

1. Pre-process PDFs with n8n → generates `results.json` with pointers
2. User queries natural language → Gemini finds relevant pointers
3. Frontend renders PDF page with highlighted bounding box

## Data Format

Expects pre-processed data in `data/{project_id}/results.json`:
```json
{
  "pointers": [
    {
      "pointer_id": "...",
      "file_name": "relative/path/to/plan.pdf",
      "bounding_box": { "xNorm": 0.6, "yNorm": 0.03, "wNorm": 0.15, "hNorm": 0.21 },
      "description": "ADA compliance notes..."
    }
  ]
}
```

## Environment

```
GEMINI_API_KEY=...
DATA_DIR=./data       # Processed results.json files
PLANS_DIR=./plans     # PDF source files
```

## Status

**Legacy** - superseded by web-internal which has integrated processing. Keep for reference but prefer web-internal for active development.
