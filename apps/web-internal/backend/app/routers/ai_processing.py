"""
AI Processing router - SSE streaming for context pointer analysis.

Accepts batches of context pointers and streams AI analysis results
back via Server-Sent Events as each pointer completes processing.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, AsyncGenerator
from datetime import datetime
import json
import asyncio
import base64
from pathlib import Path

import fitz  # PyMuPDF
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import ProjectFile, ContextPointer
from ..services.gemini_service import analyze_context_pointer

router = APIRouter(prefix="/api/ai", tags=["AI Processing"])


def update_pointer_ai_analysis(pointer_id: str, ai_analysis: dict) -> bool:
    """
    Update a ContextPointer with AI analysis results.
    Uses a new session since this runs inside an async generator after the original session closes.
    
    Returns True on success, False on failure.
    """
    try:
        db = SessionLocal()
        pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
        if pointer:
            pointer.ai_technical_description = ai_analysis.get('technicalDescription')
            pointer.ai_trade_category = ai_analysis.get('tradeCategory')
            pointer.ai_elements = ai_analysis.get('identifiedElements')
            pointer.ai_recommendations = ai_analysis.get('recommendations')
            db.commit()
            return True
        return False
    except Exception as e:
        print(f"Failed to update pointer AI analysis: {e}")
        return False
    finally:
        db.close()


def render_pdf_region(file_path: str, page_number: int, bounds: dict) -> str:
    """
    Render a region of a PDF page as a base64-encoded PNG.
    
    Args:
        file_path: Path to the PDF file
        page_number: 1-indexed page number
        bounds: Dict with xNorm, yNorm, wNorm, hNorm (normalized 0-1 coordinates)
    
    Returns:
        Base64-encoded PNG image (no data: prefix)
    """
    doc = fitz.open(file_path)
    page = doc[page_number - 1]  # 0-indexed
    
    # Get page dimensions
    page_rect = page.rect
    page_width = page_rect.width
    page_height = page_rect.height
    
    # Convert normalized coordinates to absolute
    # Support both 'xNorm/yNorm/wNorm/hNorm' and 'x/y/width/height' key formats
    x_norm = bounds.get('xNorm') or bounds.get('x') or 0
    y_norm = bounds.get('yNorm') or bounds.get('y') or 0
    w_norm = bounds.get('wNorm') or bounds.get('width') or 0.1
    h_norm = bounds.get('hNorm') or bounds.get('height') or 0.1
    
    x = x_norm * page_width
    y = y_norm * page_height
    w = w_norm * page_width
    h = h_norm * page_height
    
    # Create clip rectangle
    clip_rect = fitz.Rect(x, y, x + w, y + h)
    
    # Calculate scale to ensure minimum readable resolution for AI
    # Aim for at least 800px on the shorter side for text legibility
    MIN_DIMENSION = 800
    region_min_dim = min(w, h)
    base_scale = 2.0
    if region_min_dim > 0:
        target_scale = MIN_DIMENSION / region_min_dim
        base_scale = max(base_scale, min(target_scale, 8.0))  # Cap at 8x to avoid huge images
    
    matrix = fitz.Matrix(base_scale, base_scale)
    
    # Render the clipped region
    pix = page.get_pixmap(matrix=matrix, clip=clip_rect)
    
    # Convert to PNG bytes
    png_bytes = pix.tobytes("png")
    
    doc.close()
    
    # Return base64 encoded (no prefix)
    return base64.b64encode(png_bytes).decode('utf-8')


# =============================================================================
# Pydantic Models
# =============================================================================

class PointerInput(BaseModel):
    """Individual context pointer input for AI processing."""
    id: str
    image_base64: str  # Base64 PNG, no data: prefix
    title: str
    description: str
    page_number: int
    source_file: str
    bounding_box: Optional[dict] = None


class SheetInput(BaseModel):
    """Sheet containing multiple pointers to process."""
    sheet_id: str
    file_name: str
    pointers: list[PointerInput]


class ProcessRequest(BaseModel):
    """Batch processing request with multiple sheets."""
    batch_id: str
    sheets: list[SheetInput]


# =============================================================================
# SSE Generator
# =============================================================================

async def generate_sse_events(request: ProcessRequest, file_path_map: dict[str, str]) -> AsyncGenerator[str, None]:
    """
    Generate SSE events as pointers are processed.
    
    Args:
        request: The batch processing request
        file_path_map: Pre-fetched mapping of sheet_id -> file_path (avoids session closure issue)
    
    Events emitted:
    - batch_start: Initial info with total counts
    - pointer_complete: Fired after each pointer processes
    - error: Fired if a pointer fails
    - batch_complete: Final event with summary
    """
    # Calculate totals
    total_pointers = sum(len(sheet.pointers) for sheet in request.sheets)
    processed_count = 0
    
    # Emit batch_start
    start_event = {
        "type": "batch_start",
        "batchId": request.batch_id,
        "totalPointers": total_pointers,
        "sheetCount": len(request.sheets)
    }
    yield f"event: batch_start\ndata: {json.dumps(start_event)}\n\n"
    
    # Process each pointer
    for sheet in request.sheets:
        for pointer in sheet.pointers:
            try:
                # Get image base64 - either from request or render from PDF
                image_base64 = pointer.image_base64
                
                if not image_base64 and pointer.bounding_box:
                    # Use pre-fetched file path (avoids session closure issue)
                    file_path = file_path_map.get(sheet.sheet_id)
                    
                    if file_path and Path(file_path).exists():
                        try:
                            image_base64 = render_pdf_region(
                                file_path,
                                pointer.page_number,
                                pointer.bounding_box
                            )
                        except Exception as render_err:
                            # Log but continue - will fail at Gemini if no image
                            print(f"Failed to render PDF region: {render_err}")
                
                # Call Gemini service
                ai_analysis = await analyze_context_pointer(
                    image_base64=image_base64,
                    title=pointer.title,
                    description=pointer.description,
                    page_number=pointer.page_number,
                    source_file=pointer.source_file
                )
                
                processed_count += 1
                
                # Persist AI analysis to ContextPointer in database
                update_pointer_ai_analysis(pointer.id, ai_analysis)
                
                # Build result matching ProcessedPointer structure
                result = {
                    "success": True,
                    "batchId": request.batch_id,
                    "sheetId": sheet.sheet_id,
                    "fileName": sheet.file_name,
                    "pointer": {
                        "id": pointer.id,
                        "originalMetadata": {
                            "title": pointer.title,
                            "description": pointer.description,
                            "pageNumber": pointer.page_number,
                            "boundingBox": pointer.bounding_box,
                            "sourceFile": pointer.source_file
                        },
                        "aiAnalysis": ai_analysis
                    },
                    "progress": {
                        "current": processed_count,
                        "total": total_pointers
                    }
                }
                
                yield f"event: pointer_complete\ndata: {json.dumps(result)}\n\n"
                
                # Rate limit delay (Gemini has limits)
                await asyncio.sleep(0.5)
                
            except Exception as e:
                error_event = {
                    "type": "error",
                    "batchId": request.batch_id,
                    "sheetId": sheet.sheet_id,
                    "pointerId": pointer.id,
                    "error": str(e)
                }
                yield f"event: error\ndata: {json.dumps(error_event)}\n\n"
    
    # Emit batch_complete
    complete_event = {
        "type": "batch_complete",
        "batchId": request.batch_id,
        "totalProcessed": processed_count,
        "processedAt": datetime.utcnow().isoformat() + "Z"
    }
    yield f"event: batch_complete\ndata: {json.dumps(complete_event)}\n\n"


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/process-stream")
async def process_stream(request: ProcessRequest, db: Session = Depends(get_db)):
    """
    Process context pointers with AI and stream results via SSE.
    
    If image_base64 is empty but bounding_box is provided, the image
    will be rendered from the PDF file on the server.
    
    Events emitted:
    - batch_start: Initial info with total counts
    - pointer_complete: Fired after each pointer processes
    - error: Fired if a pointer fails
    - batch_complete: Final event with summary
    """
    # Pre-fetch file paths BEFORE creating StreamingResponse
    # This avoids the session closure issue
    file_path_map: dict[str, str] = {}
    for sheet in request.sheets:
        if sheet.sheet_id not in file_path_map:
            file_record = db.query(ProjectFile).filter(
                ProjectFile.id == sheet.sheet_id
            ).first()
            if file_record and file_record.path:
                file_path_map[sheet.sheet_id] = file_record.path
    
    return StreamingResponse(
        generate_sse_events(request, file_path_map),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
