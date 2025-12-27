# web-internal/backend

FastAPI backend for Maestro4D with SQLite persistence, Gemini AI integration, and PDF processing.

## Commands

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Structure

```
app/
├── main.py           # FastAPI app, CORS, router registration
├── database.py       # SQLAlchemy engine, session management
├── models.py         # SQLAlchemy ORM models (~20KB)
├── schemas.py        # Pydantic request/response models (~40KB)
├── security.py       # JWT auth utilities
├── routers/          # API endpoints by domain
│   ├── projects.py   # CRUD for projects
│   ├── files.py      # File upload/download
│   ├── context.py    # Context extraction (68KB, largest router)
│   ├── context_tree.py # Hierarchical context views
│   ├── agent.py      # AI query/chat endpoints
│   ├── batches.py    # Batch processing management
│   └── ...
└── services/         # Business logic
    ├── gemini_service.py      # Gemini API wrapper (26KB)
    ├── gemini_agent_service.py # Agent-style Gemini calls
    ├── grok_service.py        # Grok API wrapper
    └── context_tree_processor.py # Tree building (65KB)
```

## Database

SQLite stored at `app/data/maestro4d.db`. Key tables:
- `projects` - Project metadata
- `files` - Uploaded PDFs
- `pointers` - Extracted context regions with bounding boxes
- `batches` - Processing batch tracking
- `users` - User accounts

## Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /api/context/process-file` | Extract pointers from PDF via Gemini |
| `GET /api/context/project/{id}/pointers` | Get all pointers for project |
| `POST /api/agent/query` | Natural language search across pointers |
| `POST /api/files/upload` | Upload PDF files |
| `GET /api/projects` | List all projects |

## AI Services

### Gemini Service (`services/gemini_service.py`)
- `extract_context_from_page()` - Analyze single PDF page
- `batch_extract_contexts()` - Process multiple pages
- Uses `gemini-2.0-flash-exp` model
- Returns pointers with normalized bounding boxes

### Context Tree Processor (`services/context_tree_processor.py`)
- Builds hierarchical views of extracted contexts
- Groups by discipline, page, trade category
- 65KB - complex tree building logic

## Request/Response Flow

1. Frontend uploads PDF → `files.py` stores in `uploads/`
2. Frontend triggers processing → `context.py` calls Gemini service
3. Gemini extracts pointers → stored in SQLite via models
4. Frontend queries → `agent.py` uses Gemini to find relevant pointers
5. Results returned with bounding box coordinates

## Environment

```
GEMINI_API_KEY=...   # Required
GROK_API_KEY=...     # Optional
```

## Gotchas

- `context.py` router is 68KB - handles most extraction logic inline
- `schemas.py` is 40KB - many nested Pydantic models
- Processing uses PyMuPDF to extract page images before sending to Gemini
- Bounding boxes are normalized (0-1), stored as floats in DB
- Large PDFs can timeout - batch processing recommended
- Database auto-creates on first run via `init_db()` in lifespan
