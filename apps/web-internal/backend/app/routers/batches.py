"""
Batches router - Batch and ProcessedPointer operations for n8n processing.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Project, Batch, ProcessedPointer
from ..schemas import (
    BatchCreate, BatchUpdate, BatchResponse, BatchSummaryResponse, BatchDetailResponse,
    ProcessedPointerCreate, ProcessedPointerBulkCreate, ProcessedPointerResponse
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

