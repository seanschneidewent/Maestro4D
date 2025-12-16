# ViewM4D - Construction Plan Retrieval Agent

A web application that lets superintendents search construction plans using natural language and see relevant sheet sections with highlighted bounding boxes.

## How It Works

```
Superintendent Query
        │
        ▼
┌───────────────────┐
│   Gemini Flash    │  Understands the question, finds
│   (Retrieval)     │  relevant context pointers
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   PDF.js Viewer   │  Renders PDF page with
│   + Bbox Overlay  │  highlighted bounding box
└───────────────────┘
```

## Project Structure

```
viewm4d/
├── backend/
│   ├── main.py           # FastAPI server
│   └── requirements.txt
├── frontend/
│   └── index.html        # Single-page app with PDF.js
├── data/                  # Processed context data
│   └── {project_id}/
│       └── results.json   # From n8n processing
├── plans/                 # Your PDF plan sets
│   └── Chick-fil-A Love Field FSU 03904 -CPS/
│       └── 03904 Constr Set Archs/
│           └── A000 Egress Plan.pdf
└── .env
```

The `fileName` paths in your results.json are relative to the `PLANS_DIR`.

## Local Setup

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
# Set PLANS_DIR to your PDF plans folder
```

### 3. Prepare your data

Your folder structure should look like:

```
viewm4d/
├── data/
│   └── chick-fil-a-love-field/
│       └── results.json          # Your processed batch output
└── plans/
    └── Chick-fil-A Love Field FSU 03904 -CPS/
        └── 03904 Constr Set Archs/
            └── 03904 Constr Set Archs/
                ├── A000 Egress Plan.pdf
                ├── A002 Demolition RCP.pdf
                └── ...
```

The `fileName` in results.json (e.g., `"Chick-fil-A Love Field FSU 03904 -CPS/03904 Constr Set Archs/03904 Constr Set Archs/A000 Egress Plan.pdf"`) must match the path relative to PLANS_DIR.

### 4. Run locally

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Open http://localhost:8000

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Your Gemini API key | `AIza...` |
| `DATA_DIR` | Path to processed results | `./data` |
| `PLANS_DIR` | Path to PDF plans root folder | `./plans` or `C:/Plans` |

## Deployment to Railway/Render

### Railway

1. Push to GitHub
2. Create new project on Railway
3. Add environment variables:
   - `GEMINI_API_KEY`
   - `DATA_DIR=/app/data`
   - `PLANS_DIR=/app/plans`
4. Mount persistent storage for data and plans folders
5. Deploy

### Pointing viewm4d.com

1. In your domain registrar (GoDaddy), add a CNAME record:
   - Name: `@` or `www`
   - Value: Your Railway/Render URL
2. In Railway/Render, add custom domain `viewm4d.com`

## API Endpoints

- `GET /api/projects` - List available projects
- `GET /api/projects/{id}` - Get project details
- `POST /api/search` - Search for relevant pointers
- `GET /api/sheets/{project}/{sheet}/pdf` - Get sheet PDF

## Search Request Format

```json
{
  "query": "Where are the ADA requirements?",
  "project_id": "chick-fil-a-love-field",
  "max_results": 5
}
```

## Search Response Format

```json
{
  "query": "Where are the ADA requirements?",
  "results": [
    {
      "pointer_id": "1d525358-...",
      "sheet_id": "e1afefe4-...",
      "file_name": "Chick-fil-A.../A000 Egress Plan.pdf",
      "title": "Accessibility Notes",
      "bounding_box": {
        "xNorm": 0.613,
        "yNorm": 0.028,
        "wNorm": 0.154,
        "hNorm": 0.212
      },
      "description": "ADA compliance requirements...",
      "trade_category": "Architectural - ADA Compliance",
      "relevance_reason": "Contains ADA accessibility requirements"
    }
  ],
  "total_pointers_searched": 15
}
```

## How Search Works

1. **Query comes in** - Superintendent types natural language question
2. **Gemini Flash analyzes** - All context pointer descriptions are sent to Gemini with the query
3. **Gemini returns matches** - Returns indices of relevant pointers + reasons
4. **Frontend renders** - PDF.js loads the sheet PDF, draws orange bounding box at the normalized coordinates

The bounding boxes use normalized coordinates (0-1), so they scale correctly regardless of PDF render resolution.
```
