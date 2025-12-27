"""
Context Tree Processing router - API endpoints for hierarchical context generation.

Provides endpoints for:
- Triggering page processing (Pass 1 + Pass 2)
- Triggering discipline processing (Pass 3)
- Querying processing status
- Streaming progress via SSE
- Retrieving processed context data
"""
import asyncio
import json
import logging
from typing import Optional, List, Dict, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import Project, ProjectFile, PageContext, DisciplineContext, ContextPointer
from ..schemas import (
    ContextTreeProcessingTriggerResponse,
    ProjectProcessingStatusResponse,
    PagesProcessingStatus,
    DisciplinesProcessingStatus,
    PageContextResponse,
    DisciplineContextResponse,
)
from ..services.context_tree_processor import (
    PageProcessor,
    DisciplineProcessor,
    get_discipline_name,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# =============================================================================
# In-Memory Job Tracking
# =============================================================================

# Track active processing jobs by project_id
# Structure: {project_id: {"job_id": str, "type": "pages" | "disciplines", "queue": asyncio.Queue}}
_active_jobs: Dict[str, Dict[str, Any]] = {}

# Track SSE subscribers per project
# Structure: {project_id: [asyncio.Queue, ...]}
_sse_subscribers: Dict[str, List[asyncio.Queue]] = {}


def _get_active_job(project_id: str, job_type: str) -> Optional[Dict[str, Any]]:
    """Get active job for a project if it matches the type."""
    job = _active_jobs.get(project_id)
    if job and job.get("type") == job_type:
        return job
    return None


def _create_job(project_id: str, job_type: str) -> str:
    """Create a new job for a project. Returns job_id."""
    job_id = str(uuid4())
    _active_jobs[project_id] = {
        "job_id": job_id,
        "type": job_type,
    }
    return job_id


def _clear_job(project_id: str):
    """Clear the active job for a project."""
    _active_jobs.pop(project_id, None)


def _broadcast_event(project_id: str, event_type: str, data: dict):
    """Broadcast an event to all SSE subscribers for a project."""
    subscribers = _sse_subscribers.get(project_id, [])
    for queue in subscribers:
        try:
            queue.put_nowait((event_type, data))
        except asyncio.QueueFull:
            logger.warning(f"SSE queue full for project {project_id}")


def _subscribe_sse(project_id: str) -> asyncio.Queue:
    """Subscribe to SSE events for a project."""
    queue = asyncio.Queue(maxsize=100)
    if project_id not in _sse_subscribers:
        _sse_subscribers[project_id] = []
    _sse_subscribers[project_id].append(queue)
    return queue


def _unsubscribe_sse(project_id: str, queue: asyncio.Queue):
    """Unsubscribe from SSE events for a project."""
    if project_id in _sse_subscribers:
        try:
            _sse_subscribers[project_id].remove(queue)
            if not _sse_subscribers[project_id]:
                del _sse_subscribers[project_id]
        except ValueError:
            pass


# =============================================================================
# Background Task Functions
# =============================================================================

async def _run_page_processing(project_id: str, job_id: str):
    """Background task to run page processing."""
    try:
        def progress_callback(event_type: str, data: dict):
            # Add job_id to all events
            data["jobId"] = job_id
            _broadcast_event(project_id, event_type, data)
        
        # Create processors with shared callback
        discipline_processor = DisciplineProcessor(progress_callback=progress_callback)
        page_processor = PageProcessor(
            concurrency_limit=5,
            progress_callback=progress_callback,
            discipline_processor=discipline_processor
        )
        
        # Run page processing (Pass 1 and Pass 2)
        result = await page_processor.start_processing(project_id)
        
        # Broadcast completion
        _broadcast_event(project_id, "processing_complete", {
            "jobId": job_id,
            "phase": "pages",
            **result
        })
        
    except Exception as e:
        logger.error(f"Page processing failed for project {project_id}: {e}")
        _broadcast_event(project_id, "processing_error", {
            "jobId": job_id,
            "phase": "pages",
            "error": str(e)
        })
    finally:
        _clear_job(project_id)


async def _run_discipline_processing(project_id: str, job_id: str):
    """Background task to run discipline processing."""
    try:
        def progress_callback(event_type: str, data: dict):
            data["jobId"] = job_id
            _broadcast_event(project_id, event_type, data)
        
        discipline_processor = DisciplineProcessor(progress_callback=progress_callback)
        
        # Run discipline processing (Pass 3)
        result = await discipline_processor.process_all_ready(project_id)
        
        # Broadcast completion
        _broadcast_event(project_id, "processing_complete", {
            "jobId": job_id,
            "phase": "disciplines",
            **result
        })
        
    except Exception as e:
        logger.error(f"Discipline processing failed for project {project_id}: {e}")
        _broadcast_event(project_id, "processing_error", {
            "jobId": job_id,
            "phase": "disciplines",
            "error": str(e)
        })
    finally:
        _clear_job(project_id)


# =============================================================================
# Helper Functions
# =============================================================================

def _get_pdf_file_ids(db: Session, project_id: str) -> List[str]:
    """Get all PDF file IDs for a project."""
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    return [f.id for f in pdf_files]


def _count_page_statuses(db: Session, project_id: str) -> Dict[str, int]:
    """Count pages by processing status. Only counts pages that have context pointers."""
    file_ids = _get_pdf_file_ids(db, project_id)
    if not file_ids:
        return {"total": 0, "unprocessed": 0, "pass1_complete": 0, "pass2_complete": 0}
    
    # Get unique (file_id, page_number) pairs that have context pointers
    pages_with_pointers = db.query(
        ContextPointer.file_id,
        ContextPointer.page_number
    ).filter(
        ContextPointer.file_id.in_(file_ids)
    ).distinct().all()
    
    if not pages_with_pointers:
        return {"total": 0, "unprocessed": 0, "pass1_complete": 0, "pass2_complete": 0}
    
    # Build set of (file_id, page_number) tuples for fast lookup
    pointer_pages = set((fp, pn) for fp, pn in pages_with_pointers)
    
    all_pages = db.query(PageContext).filter(PageContext.file_id.in_(file_ids)).all()
    
    # Filter to only pages that have pointers
    pages = [p for p in all_pages if (p.file_id, p.page_number) in pointer_pages]
    
    total = len(pages)
    unprocessed = sum(1 for p in pages if p.processing_status in ("unprocessed", "error"))
    pass1_complete = sum(1 for p in pages if p.processing_status == "pass1_complete")
    pass2_complete = sum(1 for p in pages if p.processing_status == "pass2_complete")
    
    return {
        "total": total,
        "unprocessed": unprocessed,
        "pass1_complete": pass1_complete,
        "pass2_complete": pass2_complete,
    }


def _count_discipline_statuses(db: Session, project_id: str) -> Dict[str, int]:
    """Count disciplines by processing status."""
    disciplines = db.query(DisciplineContext).filter(
        DisciplineContext.project_id == project_id
    ).all()
    
    total = len(disciplines)
    waiting = sum(1 for d in disciplines if d.processing_status == "waiting")
    ready = sum(1 for d in disciplines if d.processing_status == "ready")
    processing = sum(1 for d in disciplines if d.processing_status == "processing")
    complete = sum(1 for d in disciplines if d.processing_status == "complete")
    
    return {
        "total": total,
        "waiting": waiting,
        "ready": ready,
        "processing": processing,
        "complete": complete,
    }


def _determine_pages_status(counts: Dict[str, int], project_id: str) -> str:
    """Determine overall page processing status."""
    # Check if processing is currently running
    job = _active_jobs.get(project_id)
    if job and job.get("type") == "pages":
        return "processing"
    
    if counts["total"] == 0:
        return "idle"
    if counts["pass2_complete"] == counts["total"]:
        return "complete"
    if counts["unprocessed"] == counts["total"]:
        return "idle"
    return "idle"  # Some pages processed, but not currently running


def _determine_disciplines_status(counts: Dict[str, int], project_id: str) -> str:
    """Determine overall discipline processing status."""
    # Check if processing is currently running
    job = _active_jobs.get(project_id)
    if job and job.get("type") == "disciplines":
        return "processing"
    
    if counts["total"] == 0:
        return "idle"
    if counts["complete"] == counts["total"]:
        return "complete"
    if counts["processing"] > 0:
        return "processing"
    return "idle"


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/projects/{project_id}/process-pages", response_model=ContextTreeProcessingTriggerResponse)
async def trigger_page_processing(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger background processing of all pages in a project.
    
    Runs Pass 1 (page analysis) and Pass 2 (cross-references) sequentially.
    Returns immediately with a job ID. Use SSE endpoint for progress updates.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if already running
    existing_job = _get_active_job(project_id, "pages")
    if existing_job:
        return ContextTreeProcessingTriggerResponse(
            job_id=existing_job["job_id"],
            status="already_running"
        )
    
    # Create new job
    job_id = _create_job(project_id, "pages")
    
    # Start background processing
    # Note: We use asyncio.create_task instead of BackgroundTasks for async functions
    asyncio.create_task(_run_page_processing(project_id, job_id))
    
    return ContextTreeProcessingTriggerResponse(
        job_id=job_id,
        status="started"
    )


@router.post("/projects/{project_id}/process-disciplines", response_model=ContextTreeProcessingTriggerResponse)
async def trigger_discipline_processing(
    project_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger background processing of all ready disciplines in a project.
    
    Runs Pass 3 (discipline rollup) for disciplines that have all pages completed.
    Returns immediately with a job ID. Use SSE endpoint for progress updates.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if already running
    existing_job = _get_active_job(project_id, "disciplines")
    if existing_job:
        return ContextTreeProcessingTriggerResponse(
            job_id=existing_job["job_id"],
            status="already_running"
        )
    
    # Create new job
    job_id = _create_job(project_id, "disciplines")
    
    # Start background processing
    asyncio.create_task(_run_discipline_processing(project_id, job_id))
    
    return ContextTreeProcessingTriggerResponse(
        job_id=job_id,
        status="started"
    )


@router.get("/projects/{project_id}/processing-status", response_model=ProjectProcessingStatusResponse)
def get_processing_status(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Get current processing status for a project.
    
    Returns counts by status for both pages and disciplines.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get counts
    page_counts = _count_page_statuses(db, project_id)
    discipline_counts = _count_discipline_statuses(db, project_id)
    
    return ProjectProcessingStatusResponse(
        pages=PagesProcessingStatus(
            total=page_counts["total"],
            unprocessed=page_counts["unprocessed"],
            pass1_complete=page_counts["pass1_complete"],
            pass2_complete=page_counts["pass2_complete"],
            status=_determine_pages_status(page_counts, project_id)
        ),
        disciplines=DisciplinesProcessingStatus(
            total=discipline_counts["total"],
            waiting=discipline_counts["waiting"],
            ready=discipline_counts["ready"],
            processing=discipline_counts["processing"],
            complete=discipline_counts["complete"],
            status=_determine_disciplines_status(discipline_counts, project_id)
        )
    )


@router.get("/projects/{project_id}/processing-progress")
async def stream_processing_progress(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    SSE endpoint for real-time processing progress updates.
    
    Events:
    - page_pass1_complete: { pageId, sheetNumber, discipline, pass1Progress, pass1Total }
    - page_pass2_complete: { pageId, sheetNumber, pass2Progress, pass2Total }
    - discipline_ready: { disciplineCode, disciplineName }
    - discipline_complete: { disciplineCode, disciplineName, progress, total }
    - processing_complete: { phase: 'pages' | 'disciplines' }
    - processing_error: { phase, error }
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Subscribe to events
    queue = _subscribe_sse(project_id)
    
    async def event_generator():
        try:
            # Send initial connection event
            yield f"event: connected\ndata: {json.dumps({'projectId': project_id})}\n\n"
            
            while True:
                try:
                    # Wait for event with timeout to send keepalive
                    event_type, data = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                    
                    # Check if processing is complete
                    if event_type in ("processing_complete", "processing_error"):
                        # Keep connection open briefly to ensure client receives event
                        await asyncio.sleep(0.5)
                        break
                        
                except asyncio.TimeoutError:
                    # Send keepalive comment
                    yield ": keepalive\n\n"
                    
        except asyncio.CancelledError:
            pass
        finally:
            _unsubscribe_sse(project_id, queue)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@router.get("/projects/{project_id}/page-contexts", response_model=List[PageContextResponse])
def list_page_contexts(
    project_id: str,
    discipline: Optional[str] = Query(None, description="Filter by discipline code (A, S, M, E, P, FP, C, L, G)"),
    status: Optional[str] = Query(None, description="Filter by processing status"),
    db: Session = Depends(get_db)
):
    """
    List all page contexts for a project.
    
    IMPORTANT: Only returns pages that have at least one ContextPointer.
    Pages without pointers are not shown.
    
    Optionally filter by discipline code and/or processing status.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get PDF file IDs
    file_ids = _get_pdf_file_ids(db, project_id)
    if not file_ids:
        return []
    
    # Get unique (file_id, page_number) pairs that have context pointers
    # Only pages with pointers should be shown
    pages_with_pointers = db.query(
        ContextPointer.file_id,
        ContextPointer.page_number
    ).filter(
        ContextPointer.file_id.in_(file_ids)
    ).distinct().all()
    
    if not pages_with_pointers:
        return []
    
    # Build set of (file_id, page_number) tuples for fast lookup
    pointer_pages = set((fp, pn) for fp, pn in pages_with_pointers)
    
    # Build a mapping of file_id -> file_name for title fallback
    files = db.query(ProjectFile).filter(ProjectFile.id.in_(file_ids)).all()
    file_names = {f.id: f.name for f in files}
    
    # Build query
    query = db.query(PageContext).filter(PageContext.file_id.in_(file_ids))
    
    if discipline:
        query = query.filter(PageContext.discipline_code == discipline.upper())
    
    if status:
        query = query.filter(PageContext.processing_status == status)
    
    # Order by file and page number
    all_pages = query.order_by(PageContext.file_id, PageContext.page_number).all()
    
    # Filter to only pages that have pointers
    pages = [p for p in all_pages if (p.file_id, p.page_number) in pointer_pages]
    
    # Convert to response models, using file name as fallback for page_title
    return [
        PageContextResponse(
            id=p.id,
            file_id=p.file_id,
            page_number=p.page_number,
            content=p.content,
            status=p.status,
            error_message=p.error_message,
            created_at=p.created_at,
            updated_at=p.updated_at,
            sheet_number=p.sheet_number,
            page_title=p.page_title or file_names.get(p.file_id),
            discipline_code=p.discipline_code,
            discipline_id=p.discipline_id,
            quick_description=p.quick_description,
            context_description=p.context_description,
            updated_context=p.updated_context,
            identifiers=p.identifiers,
            cross_refs=p.cross_refs,
            pass1_output=p.pass1_output,
            inbound_references=p.inbound_references,
            pass2_output=p.pass2_output,
            processing_status=p.processing_status,
            retry_count=p.retry_count,
        )
        for p in pages
    ]


@router.get("/projects/{project_id}/discipline-contexts", response_model=List[DisciplineContextResponse])
def list_discipline_contexts(
    project_id: str,
    ensure_exist: bool = Query(False, description="Create default disciplines if none exist"),
    db: Session = Depends(get_db)
):
    """
    List all discipline contexts for a project.
    
    If ensure_exist=True and no disciplines exist, creates placeholder disciplines
    for all standard discipline codes.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get disciplines
    disciplines = db.query(DisciplineContext).filter(
        DisciplineContext.project_id == project_id
    ).order_by(DisciplineContext.code).all()
    
    # If none exist and ensure_exist is True, create default disciplines
    if not disciplines and ensure_exist:
        disciplines = _create_default_disciplines(db, project_id)
    
    # Convert to response models
    return [
        DisciplineContextResponse(
            id=d.id,
            project_id=d.project_id,
            code=d.code,
            name=d.name,
            context_description=d.context_description,
            key_contents=d.key_contents,
            connections=d.connections,
            processing_status=d.processing_status,
            created_at=d.created_at,
            updated_at=d.updated_at,
        )
        for d in disciplines
    ]


def _create_default_disciplines(db: Session, project_id: str) -> List[DisciplineContext]:
    """
    Create default DisciplineContext records for all standard discipline codes.
    Used when the Disciplines tab loads before page processing has run.
    """
    from ..services.context_tree_processor import DISCIPLINE_CODES
    
    created = []
    for code, name in DISCIPLINE_CODES.items():
        discipline = DisciplineContext(
            project_id=project_id,
            code=code,
            name=name,
            processing_status="waiting"
        )
        db.add(discipline)
        created.append(discipline)
    
    db.commit()
    
    # Refresh to get IDs and timestamps
    for d in created:
        db.refresh(d)
    
    logger.info(f"Created {len(created)} default disciplines for project {project_id}")
    return created


@router.post("/projects/{project_id}/reset-page-processing")
def reset_page_processing(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Reset all page processing status to 'unprocessed' for a project.
    
    This allows reprocessing pages after adding new annotations.
    Also resets discipline contexts to 'waiting' status.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if processing is currently running
    job = _active_jobs.get(project_id)
    if job:
        raise HTTPException(
            status_code=409, 
            detail="Cannot reset while processing is in progress"
        )
    
    # Get PDF file IDs
    file_ids = _get_pdf_file_ids(db, project_id)
    if not file_ids:
        return {"pages_reset": 0, "disciplines_reset": 0}
    
    # Reset all pages to unprocessed
    pages_updated = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids)
    ).update({
        PageContext.processing_status: "unprocessed",
        PageContext.discipline_code: None,
        PageContext.discipline_id: None,
        PageContext.context_description: None,
        PageContext.updated_context: None,
        PageContext.identifiers: None,
        PageContext.cross_refs: None,
        PageContext.pass1_output: None,
        PageContext.inbound_references: None,
        PageContext.pass2_output: None,
        PageContext.error_message: None,
        PageContext.retry_count: 0,  # Reset retry counter
    }, synchronize_session=False)
    
    # Reset all disciplines to waiting
    disciplines_updated = db.query(DisciplineContext).filter(
        DisciplineContext.project_id == project_id
    ).update({
        DisciplineContext.processing_status: "waiting",
        DisciplineContext.context_description: None,
        DisciplineContext.key_contents: None,
        DisciplineContext.connections: None,
    }, synchronize_session=False)
    
    db.commit()
    
    logger.info(f"Reset {pages_updated} pages and {disciplines_updated} disciplines for project {project_id}")
    
    return {
        "pages_reset": pages_updated,
        "disciplines_reset": disciplines_updated
    }

