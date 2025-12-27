# web-internal

Main Maestro4D dashboard - a React/Vite SPA for construction project management with PDF viewing, AI-powered context extraction, and 3D point cloud visualization.

## CRITICAL: Destructive Operations Warning

**BEFORE running ANY potentially destructive command, STOP and WARN the user explicitly.**

Destructive operations include but are not limited to:
- `git checkout <file>` - DESTROYS all uncommitted changes in that file
- `git reset --hard` - DESTROYS all uncommitted changes in the entire repo
- `git clean` - DELETES untracked files permanently
- `rm`, `rm -rf` - DELETES files/directories permanently
- Any command that overwrites or resets files with uncommitted work

**NEVER assume the user understands the implications.** Always say something like:
> "WARNING: This command will permanently delete all uncommitted changes to X. This cannot be undone. Are you absolutely sure?"

If the user asks to "revert changes" or "undo my changes", use the Edit tool to surgically undo specific changes - do NOT use git checkout on files with uncommitted work.

**This warning exists because a single `git checkout` command destroyed DAYS of uncommitted refactoring work - work that required hours of critical thinking to develop in the first place. The recovery was barely possible and should never have been necessary. THINK before running destructive commands.**

## Commands

```bash
pnpm dev              # Start Vite dev server (port 5173)
pnpm build            # Build for production
cd backend && uvicorn app.main:app --reload  # Start FastAPI (port 8000)
```

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | Root component, project list dashboard, routing |
| `components/ProjectViewerPage.tsx` | Main project view (144KB god component) |
| `components/PdfViewer.tsx` | PDF rendering with annotations (87KB) |
| `components/Viewer.tsx` | Three.js 3D point cloud viewer (136KB) |
| `components/context-panel/ContextPanel.tsx` | AI context extraction UI (145KB) |
| `utils/api.ts` | All backend API calls (32KB) |
| `types.ts` | Shared TypeScript interfaces |

## Component Architecture

```
App.tsx
└── ProjectViewerPage.tsx       # Selected project view
    ├── PdfViewer.tsx           # PDF with annotations
    ├── Viewer.tsx              # 3D point cloud
    ├── ContextPanel/           # AI processing panel
    │   ├── PagesTab.tsx        # Page-by-page context view
    │   ├── DisciplinesTab.tsx  # Trade-grouped contexts
    │   └── hooks/              # Processing state hooks
    └── AnnotationsPanel.tsx    # Manual annotations
```

## State Management

- No global state library - props drilling + local state
- `useProjectContext` hook for fetching/caching project data
- `useAIProcessing` hook for streaming AI responses
- `useProcessedBatches` for batch processing state

## Key Patterns

- **Streaming AI**: Uses `ReadableStream` for progressive AI responses
- **Normalized coordinates**: All bounding boxes use 0-1 range, not pixels
- **File-based routing**: No React Router, state-based view switching
- **Batch processing**: PDFs processed in batches to avoid timeouts

## API Integration

All API calls go through `utils/api.ts`. Backend runs at `http://localhost:8000/api/`.

Key endpoints:
- `POST /api/context/process-file` - Process PDF with Gemini
- `GET /api/context/project/{id}/pointers` - Get extracted pointers
- `POST /api/agent/query` - Natural language search

## Dependencies

- `react-pdf`: PDF rendering
- `three`: 3D visualization
- `sql.js`: Browser-side SQLite
- `react-rnd`: Draggable/resizable panels
- `react-markdown`: Markdown rendering in AI responses

## Gotchas

- God components need refactoring but work - don't break them
- PdfViewer handles both viewing and annotation modes
- Context extraction can take 30+ seconds per page
- Backend must be running for any data persistence
- `.env` file needed with `VITE_API_URL` if not using default localhost
