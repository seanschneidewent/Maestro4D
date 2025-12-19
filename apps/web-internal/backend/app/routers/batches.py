"""
Batches router - Batch and ProcessedPointer operations for n8n processing.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Project, Batch, ProcessedPointer, ContextPointer, ProjectFile
from ..schemas import (
    BatchCreate, BatchUpdate, BatchResponse, BatchSummaryResponse, BatchDetailResponse,
    ProcessedPointerCreate, ProcessedPointerBulkCreate, ProcessedPointerResponse,
    BatchCommitResponse, BatchCommitRequest
)

router = APIRouter()


@router.get("/batches", response_model=List[BatchSummaryResponse])
def list_batches(
    project_id: Optional[str] = Query(None, alias="projectId"),
    db: Session = Depends(get_db)
):
    """List batches with summary counts, optionally filtered by project."""
    query = db.query(Batch).options(joinedload(Batch.processed_pointers))
    if project_id:
        query = query.filter(Batch.project_id == project_id)
    
    batches = query.order_by(Batch.created_at.desc()).all()
    
    result = []
    for batch in batches:
        pointer_count = len(batch.processed_pointers)
        sheet_ids = set(p.sheet_id for p in batch.processed_pointers)
        result.append(BatchSummaryResponse(
            id=batch.id,
            project_id=batch.project_id,
            status=batch.status,
            processed_at=batch.processed_at,
            created_at=batch.created_at,
            pointer_count=pointer_count,
            sheet_count=len(sheet_ids),
        ))
    
    return result


@router.post("/batches", response_model=BatchResponse, status_code=201)
def create_batch(batch: BatchCreate, db: Session = Depends(get_db)):
    """Create a new batch with provided ID (batch_TIMESTAMP format)."""
    # Check if batch ID already exists
    existing = db.query(Batch).filter(Batch.id == batch.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Batch ID already exists")
    
    # Verify project exists if specified
    if batch.project_id:
        project = db.query(Project).filter(Project.id == batch.project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
    
    db_batch = Batch(
        id=batch.id,
        project_id=batch.project_id,
        status="pending",
    )
    db.add(db_batch)
    db.commit()
    db.refresh(db_batch)
    
    return db_batch


@router.get("/batches/{batch_id}", response_model=BatchDetailResponse)
def get_batch(batch_id: str, db: Session = Depends(get_db)):
    """Get a batch with all processed pointers."""
    batch = db.query(Batch).options(
        joinedload(Batch.processed_pointers)
    ).filter(Batch.id == batch_id).first()
    
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    pointers = [ProcessedPointerResponse.model_validate(p) for p in batch.processed_pointers]
    
    return BatchDetailResponse(
        id=batch.id,
        project_id=batch.project_id,
        status=batch.status,
        processed_at=batch.processed_at,
        created_at=batch.created_at,
        processed_pointers=pointers,
    )


@router.patch("/batches/{batch_id}", response_model=BatchResponse)
def update_batch(batch_id: str, update: BatchUpdate, db: Session = Depends(get_db)):
    """Update batch status or processed_at."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    if update.status is not None:
        batch.status = update.status
    if update.processed_at is not None:
        batch.processed_at = update.processed_at
    
    db.commit()
    db.refresh(batch)
    
    return batch


@router.delete("/batches/{batch_id}", status_code=204)
def delete_batch(batch_id: str, db: Session = Depends(get_db)):
    """Delete a batch and all processed pointers."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    db.delete(batch)
    db.commit()
    return None


@router.post("/batches/{batch_id}/complete", response_model=BatchResponse)
def complete_batch(batch_id: str, db: Session = Depends(get_db)):
    """Mark a batch as complete with current timestamp."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    batch.status = "complete"
    batch.processed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(batch)
    
    return batch


@router.post("/batches/commit", response_model=BatchCommitResponse)
def commit_batch(request: BatchCommitRequest, db: Session = Depends(get_db)):
    """
    Commit a batch by creating ContextPointer records from provided n8n processed data.
    
    This accepts the batch data directly from the frontend (which gets it from the
    Node.js n8n API) rather than looking it up in the database.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == request.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Build mapping from sheet_id -> actual file_id
    # First try by ID, then fall back to file name matching
    sheet_to_file_id = {}
    
    # Collect sheet IDs and file names
    sheet_ids = set(sheet.sheet_id for sheet in request.sheets)
    sheet_names = {sheet.sheet_id: sheet.file_name for sheet in request.sheets}
    
    # Try to find files by ID first
    files_by_id = db.query(ProjectFile).filter(
        ProjectFile.id.in_(sheet_ids),
        ProjectFile.project_id == request.project_id
    ).all()
    for f in files_by_id:
        sheet_to_file_id[f.id] = f.id
    
    # For sheets not found by ID, try to find by file name
    missing_sheet_ids = sheet_ids - set(sheet_to_file_id.keys())
    if missing_sheet_ids:
        missing_names = [sheet_names[sid] for sid in missing_sheet_ids]
        files_by_name = db.query(ProjectFile).filter(
            ProjectFile.name.in_(missing_names),
            ProjectFile.project_id == request.project_id
        ).all()
        name_to_file = {f.name: f.id for f in files_by_name}
        
        for sheet_id in missing_sheet_ids:
            file_name = sheet_names[sheet_id]
            if file_name in name_to_file:
                sheet_to_file_id[sheet_id] = name_to_file[file_name]
    
    # Check if any sheets are still missing
    still_missing = sheet_ids - set(sheet_to_file_id.keys())
    if still_missing:
        missing_info = [f"{sid} ({sheet_names.get(sid, 'unknown')})" for sid in list(still_missing)[:5]]
        raise HTTPException(
            status_code=400,
            detail=f"Some sheets do not exist as ProjectFiles (by ID or name): {missing_info}"
        )
    
    # Create ContextPointer records from the provided data
    created_count = 0
    for sheet in request.sheets:
        # Look up the actual file ID (may have been matched by name)
        actual_file_id = sheet_to_file_id.get(sheet.sheet_id)
        if not actual_file_id:
            continue  # Skip if file not found (shouldn't happen after validation)
        
        for pointer in sheet.pointers:
            # Build description from AI analysis
            ai_data = {
                "technicalDescription": pointer.ai_analysis.technical_description,
                "identifiedElements": pointer.ai_analysis.identified_elements,
                "tradeCategory": pointer.ai_analysis.trade_category,
                "measurements": pointer.ai_analysis.measurements,
                "issues": pointer.ai_analysis.issues,
                "recommendations": pointer.ai_analysis.recommendations,
            }
            description = _format_ai_analysis(ai_data)
            
            # Use AI-enhanced title (first 100 chars of technical description)
            title = pointer.original_metadata.title or "Untitled"
            if pointer.ai_analysis.technical_description:
                tech_desc = pointer.ai_analysis.technical_description
                title = tech_desc[:100] + ("..." if len(tech_desc) > 100 else "")
            
            # Create ContextPointer with default full-page bounds
            context_pointer = ContextPointer(
                file_id=actual_file_id,
                page_number=pointer.original_metadata.page_number or 1,
                bounds_x=0.0,
                bounds_y=0.0,
                bounds_w=1.0,
                bounds_h=1.0,
                style_color="#ff0000",
                style_stroke_width=2,
                title=title,
                description=description,
                snapshot_data_url=None,
            )
            db.add(context_pointer)
            created_count += 1
    
    db.commit()
    
    return BatchCommitResponse(
        batch_id=request.batch_id,
        pointers_created=created_count,
        status="committed"
    )


def _format_ai_analysis(ai_analysis: dict | None) -> str:
    """Format AI analysis into a readable description for the ContextPointer."""
    if not ai_analysis or not isinstance(ai_analysis, dict):
        return ""
    
    parts = []
    
    # Technical description
    if ai_analysis.get("technicalDescription"):
        parts.append(ai_analysis["technicalDescription"])
    
    # Identified elements
    elements = ai_analysis.get("identifiedElements", [])
    if elements:
        element_strs = []
        for elem in elements:
            if isinstance(elem, str):
                element_strs.append(elem)
            elif isinstance(elem, dict) and "symbol" in elem:
                element_strs.append(f"{elem.get('symbol')}: {elem.get('meaning', '')}")
        if element_strs:
            parts.append("Elements: " + ", ".join(element_strs))
    
    # Trade category
    if ai_analysis.get("tradeCategory"):
        parts.append(f"Trade: {ai_analysis['tradeCategory']}")
    
    # Measurements
    measurements = ai_analysis.get("measurements", [])
    if measurements:
        meas_strs = [f"{m.get('element')}: {m.get('value')} {m.get('unit', '')}" for m in measurements]
        parts.append("Measurements: " + ", ".join(meas_strs))
    
    # Issues
    issues = ai_analysis.get("issues", [])
    if issues:
        issue_strs = [f"[{i.get('severity', 'info')}] {i.get('description', '')}" for i in issues]
        parts.append("Issues: " + "; ".join(issue_strs))
    
    # Recommendations
    if ai_analysis.get("recommendations"):
        parts.append(f"Recommendations: {ai_analysis['recommendations']}")
    
    return "\n\n".join(parts)


# =============================================================================
# Processed Pointers
# =============================================================================

@router.get("/batches/{batch_id}/pointers", response_model=List[ProcessedPointerResponse])
def list_processed_pointers(batch_id: str, db: Session = Depends(get_db)):
    """List all processed pointers for a batch."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    pointers = db.query(ProcessedPointer).filter(
        ProcessedPointer.batch_id == batch_id
    ).all()
    
    return pointers


@router.post("/batches/{batch_id}/pointers", response_model=ProcessedPointerResponse, status_code=201)
def add_processed_pointer(
    batch_id: str,
    pointer: ProcessedPointerCreate,
    db: Session = Depends(get_db)
):
    """Add a single processed pointer to a batch."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    db_pointer = ProcessedPointer(
        batch_id=batch_id,
        pointer_id=pointer.pointer_id,
        sheet_id=pointer.sheet_id,
        file_name=pointer.file_name,
        original_title=pointer.original_title,
        original_description=pointer.original_description,
        original_page_number=pointer.original_page_number,
        ai_analysis=pointer.ai_analysis,
    )
    db.add(db_pointer)
    db.commit()
    db.refresh(db_pointer)
    
    return db_pointer


@router.post("/batches/{batch_id}/pointers/bulk", response_model=List[ProcessedPointerResponse], status_code=201)
def bulk_add_processed_pointers(
    batch_id: str,
    data: ProcessedPointerBulkCreate,
    db: Session = Depends(get_db)
):
    """Bulk add processed pointers to a batch."""
    batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    
    db_pointers = []
    for pointer in data.pointers:
        db_pointer = ProcessedPointer(
            batch_id=batch_id,
            pointer_id=pointer.pointer_id,
            sheet_id=pointer.sheet_id,
            file_name=pointer.file_name,
            original_title=pointer.original_title,
            original_description=pointer.original_description,
            original_page_number=pointer.original_page_number,
            ai_analysis=pointer.ai_analysis,
        )
        db.add(db_pointer)
        db_pointers.append(db_pointer)
    
    db.commit()
    
    # Refresh all pointers
    for p in db_pointers:
        db.refresh(p)
    
    return db_pointers

