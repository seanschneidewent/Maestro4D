"""
Context router - ContextPointer and SheetContext operations.
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ProjectFile, ContextPointer, SheetContext
from ..schemas import (
    ContextPointerCreate, ContextPointerUpdate, ContextPointerResponse,
    SheetContextUpdate, SheetContextResponse, SheetContextWithPointersResponse
)

router = APIRouter()


# =============================================================================
# Context Pointers
# =============================================================================

@router.get("/files/{file_id}/pointers", response_model=List[ContextPointerResponse])
def list_file_pointers(file_id: str, db: Session = Depends(get_db)):
    """List all context pointers for a file."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    pointers = db.query(ContextPointer).filter(ContextPointer.file_id == file_id).all()
    return [ContextPointerResponse.from_orm_model(p) for p in pointers]


@router.post("/pointers", response_model=ContextPointerResponse, status_code=201)
def create_pointer(pointer: ContextPointerCreate, db: Session = Depends(get_db)):
    """Create a new context pointer."""
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == pointer.file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Extract style with defaults
    style = pointer.style or {}
    style_color = getattr(style, 'color', '#ff0000') if style else '#ff0000'
    style_stroke_width = getattr(style, 'stroke_width', 2) if style else 2
    
    db_pointer = ContextPointer(
        file_id=pointer.file_id,
        page_number=pointer.page_number,
        bounds_x=pointer.bounds.x_norm,
        bounds_y=pointer.bounds.y_norm,
        bounds_w=pointer.bounds.w_norm,
        bounds_h=pointer.bounds.h_norm,
        style_color=style_color,
        style_stroke_width=style_stroke_width,
        title=pointer.title,
        description=pointer.description,
        snapshot_data_url=pointer.snapshot_data_url,
    )
    db.add(db_pointer)
    db.commit()
    db.refresh(db_pointer)
    
    return ContextPointerResponse.from_orm_model(db_pointer)


@router.get("/pointers/{pointer_id}", response_model=ContextPointerResponse)
def get_pointer(pointer_id: str, db: Session = Depends(get_db)):
    """Get a context pointer by ID."""
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Pointer not found")
    
    return ContextPointerResponse.from_orm_model(pointer)


@router.patch("/pointers/{pointer_id}", response_model=ContextPointerResponse)
def update_pointer(
    pointer_id: str,
    title: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """Update a context pointer's title and/or description."""
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Pointer not found")
    
    if title is not None:
        pointer.title = title
    if description is not None:
        pointer.description = description
    
    db.commit()
    db.refresh(pointer)
    
    return ContextPointerResponse.from_orm_model(pointer)


@router.put("/pointers/{pointer_id}", response_model=ContextPointerResponse)
def update_pointer_full(
    pointer_id: str,
    update: ContextPointerUpdate,
    db: Session = Depends(get_db)
):
    """Update a context pointer with full body."""
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Pointer not found")
    
    if update.title is not None:
        pointer.title = update.title
    if update.description is not None:
        pointer.description = update.description
    if update.bounds is not None:
        pointer.bounds_x = update.bounds.x_norm
        pointer.bounds_y = update.bounds.y_norm
        pointer.bounds_w = update.bounds.w_norm
        pointer.bounds_h = update.bounds.h_norm
    if update.style is not None:
        pointer.style_color = update.style.color
        pointer.style_stroke_width = update.style.stroke_width
    
    db.commit()
    db.refresh(pointer)
    
    return ContextPointerResponse.from_orm_model(pointer)


@router.delete("/pointers/{pointer_id}", status_code=204)
def delete_pointer(pointer_id: str, db: Session = Depends(get_db)):
    """Delete a context pointer."""
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Pointer not found")
    
    db.delete(pointer)
    db.commit()
    return None


# =============================================================================
# Sheet Context
# =============================================================================

@router.get("/files/{file_id}/context", response_model=SheetContextWithPointersResponse)
def get_sheet_context(file_id: str, db: Session = Depends(get_db)):
    """Get sheet context for a file, including pointers."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    context = db.query(SheetContext).filter(SheetContext.file_id == file_id).first()
    pointers = db.query(ContextPointer).filter(ContextPointer.file_id == file_id).all()
    
    if not context:
        # Return empty context with pointers
        return SheetContextWithPointersResponse(
            id="",
            file_id=file_id,
            file_name=file.name,
            added_to_context=False,
            markdown_content=None,
            generation_status="idle",
            generation_error=None,
            markdown_generated_at=None,
            pointers=[ContextPointerResponse.from_orm_model(p) for p in pointers],
        )
    
    return SheetContextWithPointersResponse(
        id=context.id,
        file_id=context.file_id,
        file_name=file.name,
        added_to_context=context.added_to_context,
        markdown_content=context.markdown_content,
        generation_status=context.generation_status,
        generation_error=context.generation_error,
        markdown_generated_at=context.markdown_generated_at,
        pointers=[ContextPointerResponse.from_orm_model(p) for p in pointers],
    )


@router.post("/files/{file_id}/context", response_model=SheetContextResponse, status_code=201)
def create_or_get_sheet_context(file_id: str, db: Session = Depends(get_db)):
    """Create or get existing sheet context for a file."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if context already exists
    context = db.query(SheetContext).filter(SheetContext.file_id == file_id).first()
    if context:
        return context
    
    # Create new context
    context = SheetContext(
        file_id=file_id,
        added_to_context=False,
        generation_status="idle",
    )
    db.add(context)
    db.commit()
    db.refresh(context)
    
    return context


@router.patch("/files/{file_id}/context", response_model=SheetContextResponse)
def update_sheet_context(
    file_id: str,
    update: SheetContextUpdate,
    db: Session = Depends(get_db)
):
    """Update sheet context (markdown, status, etc.)."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    context = db.query(SheetContext).filter(SheetContext.file_id == file_id).first()
    if not context:
        # Create context if it doesn't exist
        context = SheetContext(
            file_id=file_id,
            added_to_context=False,
            generation_status="idle",
        )
        db.add(context)
    
    # Update fields
    if update.added_to_context is not None:
        context.added_to_context = update.added_to_context
    if update.markdown_content is not None:
        context.markdown_content = update.markdown_content
        context.markdown_generated_at = datetime.utcnow()
    if update.generation_status is not None:
        context.generation_status = update.generation_status
    if update.generation_error is not None:
        context.generation_error = update.generation_error
    
    db.commit()
    db.refresh(context)
    
    return context

