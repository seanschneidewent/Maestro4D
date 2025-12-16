# Maestro4D Web Internal Backend

FastAPI + SQLite backend for the Maestro4D internal web tool.

## Quick Start

### 1. Create Virtual Environment

```bash
cd backend
python -m venv venv

# Windows
.\venv\Scripts\activate

# macOS/Linux
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Run the Server

```bash
python run.py
```

The server will start at `http://localhost:8000`.

## API Documentation

Once running, access the interactive API docs at:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Database

SQLite database is automatically created at `app/data/maestro.db` on first run.

## File Uploads

Uploaded files are stored in:
- `uploads/projects/{project_id}/` - Project files
- `uploads/scans/{scan_id}/` - Scan files

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project
- `GET /api/projects/{id}` - Get project with relationships
- `PATCH /api/projects/{id}` - Update project
- `DELETE /api/projects/{id}` - Delete project (cascade)

### Scans
- `GET /api/scans?projectId=` - List scans (filter by project)
- `POST /api/scans` - Create scan
- `GET /api/scans/{id}` - Get scan with files and insights
- `PATCH /api/scans/{id}` - Update scan
- `DELETE /api/scans/{id}` - Delete scan

### Files
- `GET /api/projects/{id}/files` - List project files
- `GET /api/projects/{id}/files/tree` - Get file tree structure
- `POST /api/projects/{id}/files` - Upload file
- `POST /api/projects/{id}/folders?name=` - Create folder
- `GET /api/files/{id}` - Get file metadata
- `GET /api/files/{id}/download` - Download file
- `DELETE /api/files/{id}` - Delete file

### Context Pointers
- `GET /api/files/{id}/pointers` - List pointers for file
- `POST /api/pointers` - Create pointer
- `GET /api/pointers/{id}` - Get pointer
- `PATCH /api/pointers/{id}?title=&description=` - Update pointer
- `DELETE /api/pointers/{id}` - Delete pointer

### Sheet Context
- `GET /api/files/{id}/context` - Get sheet context with pointers
- `POST /api/files/{id}/context` - Create or get sheet context
- `PATCH /api/files/{id}/context` - Update sheet context

### Batches
- `GET /api/batches?projectId=` - List batches with summaries
- `POST /api/batches` - Create batch
- `GET /api/batches/{id}` - Get batch with processed pointers
- `PATCH /api/batches/{id}` - Update batch
- `DELETE /api/batches/{id}` - Delete batch
- `POST /api/batches/{id}/complete` - Mark batch complete
- `POST /api/batches/{id}/pointers` - Add processed pointer
- `POST /api/batches/{id}/pointers/bulk` - Bulk add pointers

### Insights
- `GET /api/insights?scanId=&severity=&status=` - List with filters
- `POST /api/insights` - Create insight
- `GET /api/insights/{id}` - Get insight
- `PATCH /api/insights/{id}` - Update insight
- `DELETE /api/insights/{id}` - Delete insight
- `POST /api/insights/{id}/resolve` - Mark resolved
- `POST /api/insights/{id}/dismiss` - Mark dismissed
- `POST /api/insights/{id}/reopen` - Reopen

### Agents
- `GET /api/agents/projects/{id}` - List agent states
- `GET /api/agents/projects/{id}/{type}` - Get agent state
- `POST /api/agents/projects/{id}/{type}` - Create or get agent
- `PATCH /api/agents/projects/{id}/{type}` - Update agent state
- `POST /api/agents/projects/{id}/{type}/message?role=&content=` - Add message
- `DELETE /api/agents/projects/{id}/{type}/history` - Clear chat

### Health Check
- `GET /api/health` - Returns `{"status": "healthy"}`

## Development

The server runs with auto-reload enabled. Any changes to Python files will automatically restart the server.

## Architecture

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app with CORS
│   ├── database.py          # SQLite engine and session
│   ├── models.py            # SQLAlchemy ORM models
│   ├── schemas.py           # Pydantic request/response schemas
│   └── routers/
│       ├── projects.py
│       ├── scans.py
│       ├── files.py
│       ├── context.py
│       ├── batches.py
│       ├── insights.py
│       └── agents.py
├── uploads/                 # File storage (created at runtime)
├── requirements.txt
├── run.py                   # Uvicorn startup script
└── README.md
```

