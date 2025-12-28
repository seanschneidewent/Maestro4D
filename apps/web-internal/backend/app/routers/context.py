"""
Context router - ContextPointer, SheetContext, and PageContext operations.
"""
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Response
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import ProjectFile, ContextPointer, SheetContext, PageContext
from ..schemas import (
    ContextPointerCreate, ContextPointerUpdate, ContextPointerResponse,
    SheetContextUpdate, SheetContextResponse, SheetContextWithPointersResponse,
    PageContextResponse, PageContextUpdate, PageContextWithPointersResponse,
    ProcessingStatusResponse, ProcessContextTriggerResponse,
    ContextPointerCreateFromHighlight, HighlightBbox,
    ContextPreviewResponse, ContextCommitResponse, PagePreview,
    ContextPointerPreview, ContextPreviewSummary,
    ProjectContextSummaryResponse, FileSummary, PageSummary, PointerSummary,
    ContextPointerBounds,
    # Project-wide commit preview
    ProjectCommitPreviewResponse, FileCommitPreview, PointerCommitPreview,
    ProjectCommitPreviewSummary, AIAnalysisPreview
)
from ..models import Project
from ..services.gemini_service import analyze_page, analyze_highlight
from ..services.context_tree_processor import extract_title_from_filename, extract_sheet_number_from_filename

logger = logging.getLogger(__name__)

# Crop storage directory
CROP_STORAGE = Path(__file__).parent.parent.parent / "uploads" / "crops"

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


# =============================================================================
# Page Context (AI-generated page descriptions)
# =============================================================================

def _get_pdf_page_count(pdf_bytes: bytes) -> int:
    """Get the number of pages in a PDF using PyMuPDF."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        count = len(doc)
        doc.close()
        return count
    except Exception as e:
        logger.error(f"Failed to get PDF page count: {e}")
        return 0


def _crop_pdf_page(
    pdf_bytes: bytes,
    page_number: int,
    bbox: HighlightBbox
) -> bytes:
    """
    Crop a region from a PDF page and return as PNG bytes.
    
    Args:
        pdf_bytes: The full PDF file as bytes
        page_number: The page number (1-indexed)
        bbox: Bounding box with normalized 0-1 coordinates
        
    Returns:
        PNG image bytes of the cropped region
    """
    import fitz  # PyMuPDF
    
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[page_number - 1]  # 0-indexed
    
    # Get page dimensions
    page_rect = page.rect
    page_width = page_rect.width
    page_height = page_rect.height
    
    # Convert normalized coordinates to absolute
    x0 = bbox.x * page_width
    y0 = bbox.y * page_height
    x1 = (bbox.x + bbox.width) * page_width
    y1 = (bbox.y + bbox.height) * page_height
    
    # Create clip rectangle
    clip_rect = fitz.Rect(x0, y0, x1, y1)
    
    # Render at higher resolution for better quality
    zoom = 2.0  # 2x zoom for better quality
    mat = fitz.Matrix(zoom, zoom)
    
    # Render the clipped region to a pixmap
    pix = page.get_pixmap(matrix=mat, clip=clip_rect)
    
    # Convert to PNG bytes
    png_bytes = pix.tobytes("png")
    
    doc.close()
    return png_bytes


def _transform_bbox_for_rotation(bbox_tuple, rotation, mediabox_width, mediabox_height):
    """Transform bbox from mediabox (unrotated) coords to display (rotated) coords."""
    x0, y0, x1, y1 = bbox_tuple
    
    if rotation == 0:
        return (x0, y0, x1, y1)
    elif rotation == 90:
        return (mediabox_height - y1, x0, mediabox_height - y0, x1)
    elif rotation == 180:
        return (mediabox_width - x1, mediabox_height - y1, mediabox_width - x0, mediabox_height - y0)
    elif rotation == 270:
        return (y0, mediabox_width - x1, y1, mediabox_width - x0)
    else:
        return (x0, y0, x1, y1)


def _extract_pymupdf_spans(page, rotation: int, mediabox_width: float, mediabox_height: float) -> list[dict]:
    """
    Extract text spans from a PDF page using PyMuPDF.

    Args:
        page: PyMuPDF page object
        rotation: Page rotation in degrees
        mediabox_width: Width of the mediabox
        mediabox_height: Height of the mediabox

    Returns:
        List of span dicts: {"id", "text", "bbox", "font", "size", "source"}
    """
    text_dict = page.get_text("dict")

    spans = []
    span_idx = 0

    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # Skip non-text blocks
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:  # Skip empty spans
                    continue

                raw_bbox = span["bbox"]

                # Transform bbox for rotation
                transformed = _transform_bbox_for_rotation(
                    raw_bbox, rotation, mediabox_width, mediabox_height
                )

                spans.append({
                    "id": f"native_{span_idx}",
                    "text": text,
                    "bbox": list(transformed),
                    "font": span.get("font", ""),
                    "size": span.get("size", 0),
                    "source": "native",
                })
                span_idx += 1

    return spans


def _extract_ocr_spans(page, page_num: int) -> tuple[list[dict], list[dict]]:
    """
    Extract text via Tesseract OCR with bounding boxes.

    Returns BOTH:
    - Line-level spans (for AI context - coherent sentences)
    - Word-level spans (for precise reference highlighting)

    Args:
        page: PyMuPDF page object
        page_num: Page number (for span ID generation)

    Returns:
        Tuple of (line_spans, word_spans)
    """
    try:
        import pytesseract
        from PIL import Image
        import io
        import fitz
        from collections import defaultdict
    except ImportError:
        logger.warning("pytesseract or Pillow not installed, skipping OCR")
        return [], []

    try:
        # Render at 200 DPI (balance of quality vs RAM)
        zoom = 200 / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)

        # Convert to PIL Image
        img = Image.open(io.BytesIO(pix.tobytes("png")))

        # Get OCR data with bounding boxes
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

        scale = 72 / 200  # Convert OCR coords back to PDF points

        # Collect word-level spans AND group by line
        word_spans = []
        lines = defaultdict(list)
        word_idx = 0

        for i, text in enumerate(data['text']):
            text = str(text).strip()
            if not text:
                continue

            # Skip low-confidence results
            conf = data['conf'][i]
            if isinstance(conf, str):
                try:
                    conf = int(conf)
                except ValueError:
                    conf = -1
            if conf < 50:
                continue

            # Get line grouping keys
            block_num = data['block_num'][i]
            par_num = data['par_num'][i]
            line_num = data['line_num'][i]
            word_num = data['word_num'][i]

            # Convert coordinates to PDF points
            x = data['left'][i] * scale
            y = data['top'][i] * scale
            w = data['width'][i] * scale
            h = data['height'][i] * scale

            word_data = {
                "word_num": word_num,
                "text": text,
                "bbox": [x, y, x + w, y + h],
                "conf": conf,
            }

            # Add to line grouping
            lines[(block_num, par_num, line_num)].append(word_data)

            # Also store as individual word span
            word_spans.append({
                "id": f"ocr_w_{page_num}_{word_idx}",
                "text": text,
                "bbox": [x, y, x + w, y + h],
                "source": "ocr",
                "confidence": conf,
            })
            word_idx += 1

        # Merge words within each line into line-level spans
        line_spans = []
        span_idx = 0

        for line_key, words in lines.items():
            if not words:
                continue

            # Sort words by word_num to maintain reading order
            words.sort(key=lambda w: w["word_num"])

            # Merge text with spaces
            merged_text = " ".join(w["text"] for w in words)

            # Merge bounding boxes: min x0/y0, max x1/y1
            x0 = min(w["bbox"][0] for w in words)
            y0 = min(w["bbox"][1] for w in words)
            x1 = max(w["bbox"][2] for w in words)
            y1 = max(w["bbox"][3] for w in words)

            # Average confidence
            avg_conf = sum(w["conf"] for w in words) / len(words)

            # Height from merged bbox
            height = y1 - y0

            line_spans.append({
                "id": f"ocr_{page_num}_{span_idx}",
                "text": merged_text,
                "bbox": [x0, y0, x1, y1],
                "font": "OCR",
                "size": height,
                "source": "ocr",
                "confidence": int(avg_conf),
            })
            span_idx += 1

        logger.info(f"OCR extracted {len(line_spans)} line spans + {len(word_spans)} word spans from page {page_num}")
        return line_spans, word_spans

    except Exception as e:
        logger.error(f"OCR failed for page {page_num}: {e}")
        return [], []


def _merge_text_spans(pymupdf_spans: list[dict], ocr_spans: list[dict]) -> list[dict]:
    """
    Merge PyMuPDF and OCR spans, avoiding duplicates.

    Strategy:
    - PyMuPDF spans are preferred (higher precision)
    - OCR spans are added if they don't overlap significantly with PyMuPDF spans
    - Overlap threshold: 50% IoU (Intersection over Union)

    Args:
        pymupdf_spans: Spans from PyMuPDF extraction
        ocr_spans: Spans from Tesseract OCR

    Returns:
        Merged list of spans
    """
    if not ocr_spans:
        return pymupdf_spans
    if not pymupdf_spans:
        return ocr_spans

    def bbox_iou(bbox1: list, bbox2: list) -> float:
        """Calculate Intersection over Union for two bboxes."""
        x1 = max(bbox1[0], bbox2[0])
        y1 = max(bbox1[1], bbox2[1])
        x2 = min(bbox1[2], bbox2[2])
        y2 = min(bbox1[3], bbox2[3])

        if x2 <= x1 or y2 <= y1:
            return 0.0

        intersection = (x2 - x1) * (y2 - y1)
        area1 = (bbox1[2] - bbox1[0]) * (bbox1[3] - bbox1[1])
        area2 = (bbox2[2] - bbox2[0]) * (bbox2[3] - bbox2[1])
        union = area1 + area2 - intersection

        return intersection / union if union > 0 else 0.0

    merged = list(pymupdf_spans)

    # Add OCR spans that don't significantly overlap with PyMuPDF spans
    ocr_added = 0
    for ocr_span in ocr_spans:
        is_duplicate = False
        for native_span in pymupdf_spans:
            if bbox_iou(ocr_span["bbox"], native_span["bbox"]) > 0.5:
                is_duplicate = True
                break

        if not is_duplicate:
            merged.append(ocr_span)
            ocr_added += 1

    logger.info(f"Merged spans: {len(pymupdf_spans)} native + {ocr_added} OCR-only = {len(merged)} total")
    return merged


def _extract_all_page_spans(pdf_path: str, page_num: int) -> tuple[list[dict], list[dict], float, float]:
    """
    Extract ALL text spans from a page using hybrid PyMuPDF + OCR approach.

    Combines native PDF text extraction (PyMuPDF) with OCR (Tesseract) to handle:
    - Native text: Extracted directly from PDF
    - Vectorized text: CAD/CAM exports where text is paths, captured via OCR

    Args:
        pdf_path: Path to PDF file
        page_num: 0-indexed page number

    Returns:
        Tuple of (line_spans, word_spans, page_width, page_height)
        - line_spans: Line-level spans for AI context (coherent sentences)
        - word_spans: Word-level spans for precise reference highlighting
    """
    import fitz  # PyMuPDF

    doc = fitz.open(pdf_path)
    page = doc[page_num]

    # Get page dimensions (display size after rotation)
    page_width = page.rect.width
    page_height = page.rect.height

    # Get rotation info for bbox transformation
    rotation = page.rotation
    mediabox = page.mediabox
    mediabox_width = mediabox.width
    mediabox_height = mediabox.height

    # Step 1: Extract native text with PyMuPDF (already word-level)
    pymupdf_spans = _extract_pymupdf_spans(page, rotation, mediabox_width, mediabox_height)

    # Step 2: Extract OCR text with Tesseract (returns both line and word level)
    ocr_line_spans, ocr_word_spans = _extract_ocr_spans(page, page_num)

    # Step 3: Merge line-level spans (native + OCR lines)
    merged_line_spans = _merge_text_spans(pymupdf_spans, ocr_line_spans)

    # Step 4: Combine word-level spans (native spans are already word-ish, plus OCR words)
    # For native text, each span is roughly a word/phrase, so include them as-is
    all_word_spans = list(pymupdf_spans) + ocr_word_spans

    doc.close()

    logger.info(f"Page {page_num}: {len(merged_line_spans)} line spans, {len(all_word_spans)} word spans")

    return merged_line_spans, all_word_spans, page_width, page_height


def _extract_text_from_region(
    pdf_path: str,
    page_num: int,
    bbox: HighlightBbox,
    pointer_id: str,
) -> dict:
    """
    DEPRECATED: Use _extract_all_page_spans() + vision-based matching instead.
    
    This function uses coordinate-based clipping which truncates text at boundaries.
    The new approach extracts all spans and lets the vision model identify visible ones.
    
    ---
    
    Extract text and bounding boxes from a specific region of a PDF page.
    
    Args:
        pdf_path: Path to PDF file
        page_num: 0-indexed page number
        bbox: Normalized bounds with x, y, width, height where values are 0-1
        pointer_id: ID of the context pointer (used to generate unique text element IDs)
    
    Returns:
        Dict with full_text, text_elements array, and clip_rect
    """
    import fitz  # PyMuPDF
    
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    
    # #region Debug logging: Page rotation check
    print(f"=== PAGE ROTATION DEBUG ===")
    print(f"page.rotation: {page.rotation}")
    print(f"page.rect: {page.rect}")
    print(f"page.mediabox: {page.mediabox}")
    print(f"page.cropbox: {page.cropbox}")
    # #endregion
    
    # #region Debug logging: Test if ANY text exists on the page
    # DEBUG - test if ANY text exists on the page
    all_text = page.get_text("text")
    print(f"Total text on page (first 500 chars): '{all_text[:500]}'")
    print(f"Total text length: {len(all_text)}")
    # #endregion
    
    # Get actual page dimensions (rotated display size)
    actual_width = page.rect.width
    actual_height = page.rect.height
    
    # Get rotation info for bbox transformation
    rotation = page.rotation
    mediabox = page.mediabox
    mediabox_width = mediabox.width
    mediabox_height = mediabox.height
    
    # Convert normalized coords to PDF points
    x0 = bbox.x * actual_width
    x1 = x0 + (bbox.width * actual_width)
    
    # FLIP Y-AXIS: PDF origin is bottom-left, web origin is top-left
    y0 = (1 - bbox.y - bbox.height) * actual_height  # top of box in PDF coords
    y1 = (1 - bbox.y) * actual_height                 # bottom of box in PDF coords
    
    clip_rect = fitz.Rect(x0, y0, x1, y1)
    
    # #region Debug logging: Clip rect calculation
    print(f"=== TEXT EXTRACTION DEBUG ===")
    print(f"PDF: {pdf_path}")
    print(f"Page: {page_num}, Page size: {actual_width} x {actual_height}")
    print(f"Input bbox: x={bbox.x}, y={bbox.y}, w={bbox.width}, h={bbox.height}")
    print(f"Clip rect: {clip_rect}")
    # #endregion
    
    # Extract text blocks with positions
    text_dict = page.get_text("dict", clip=clip_rect)
    
    # #region Debug logging: Text extraction results
    print(f"Blocks found: {len(text_dict.get('blocks', []))}")
    full_text = page.get_text("text", clip=clip_rect).strip()
    print(f"Full text extracted: '{full_text[:200]}'" if full_text else "Full text: EMPTY")
    # #endregion
    
    # Phase 1: Collect all spans with transformed bboxes
    raw_spans = []
    for block in text_dict.get("blocks", []):
        if block.get("type") == 0:  # text block
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span["text"].strip():  # skip empty spans
                        # Transform bbox from mediabox coords to display coords
                        raw_bbox = span["bbox"]  # (x0, y0, x1, y1) in mediabox coords
                        transformed = _transform_bbox_for_rotation(raw_bbox, rotation, mediabox_width, mediabox_height)
                        
                        # #region Debug logging: Raw and transformed span bbox
                        print(f"Raw span bbox: {raw_bbox} -> Transformed: {transformed} for text: '{span['text'][:30]}'")
                        # #endregion
                        
                        # Store span data with transformed bbox
                        raw_spans.append({
                            "text": span["text"],
                            "bbox": transformed,  # (x0, y0, x1, y1) in display coords
                            "font": span.get("font", ""),
                            "size": span.get("size", 0),
                            "flags": span.get("flags", 0)
                        })
    
    # Phase 2: Group spans by Y position (round to nearest 5px) and merge into lines
    # Group spans by rounded Y coordinate
    line_groups = {}
    for span in raw_spans:
        y0 = span["bbox"][1]  # y0 from transformed bbox
        # Round to nearest 5px (±2.5px tolerance for font size variations)
        line_key = round(y0 / 5) * 5
        
        if line_key not in line_groups:
            line_groups[line_key] = []
        line_groups[line_key].append(span)
    
    # Merge spans per line group
    text_elements = []
    for line_key in sorted(line_groups.keys()):  # Process lines top-to-bottom
        line_spans = line_groups[line_key]
        
        # Sort spans left-to-right by x0
        line_spans.sort(key=lambda s: s["bbox"][0])
        
        # Merge text content with space joins
        merged_text = " ".join(span["text"] for span in line_spans)
        
        # Create unified bbox: min x0, min y0, max x1, max y1 from all spans
        min_x0 = min(span["bbox"][0] for span in line_spans)
        min_y0 = min(span["bbox"][1] for span in line_spans)
        max_x1 = max(span["bbox"][2] for span in line_spans)
        max_y1 = max(span["bbox"][3] for span in line_spans)
        
        # Add ±2px vertical padding to ensure full glyph coverage
        unified_bbox = {
            "x0": min_x0,
            "y0": min_y0 - 2,
            "x1": max_x1,
            "y1": max_y1 + 2
        }
        
        # Use metadata from first span in line (or could merge, but first is simplest)
        first_span = line_spans[0]
        
        # Create text_element for merged line
        text_elements.append({
            "id": f"{pointer_id}_t{len(text_elements)}",
            "text": merged_text,
            "bbox": unified_bbox,
            "font": first_span["font"],
            "size": first_span["size"],
            "flags": first_span["flags"]
        })
    
    # Get concatenated text for AI context
    full_text = page.get_text("text", clip=clip_rect).strip()
    
    # #region Debug logging: Final text elements count
    print(f"Text elements extracted: {len(text_elements)}")
    if text_elements:
        print(f"First text element: {text_elements[0]}")
    print("=== END TEXT EXTRACTION DEBUG ===")
    # #endregion
    
    doc.close()
    
    return {
        "full_text": full_text,
        "text_elements": text_elements,
        # Store clip_rect in DISPLAY coordinates (matching transformed text bboxes)
        # NOT the flipped PyMuPDF query coordinates
        "clip_rect": {
            "x0": bbox.x * actual_width,
            "y0": bbox.y * actual_height,
            "x1": (bbox.x + bbox.width) * actual_width,
            "y1": (bbox.y + bbox.height) * actual_height
        },
        "page_width": actual_width,
        "page_height": actual_height
    }


def _save_crop_image(crop_bytes: bytes, file_id: str, pointer_id: str) -> str:
    """
    Save crop image to disk and return the path.
    
    Args:
        crop_bytes: PNG image bytes
        file_id: The ProjectFile ID (for organizing)
        pointer_id: The ContextPointer ID (for filename)
        
    Returns:
        Path to the saved crop image
    """
    # Ensure crop directory exists
    crop_dir = CROP_STORAGE / file_id
    crop_dir.mkdir(parents=True, exist_ok=True)
    
    # Save the crop
    crop_path = crop_dir / f"{pointer_id}.png"
    crop_path.write_bytes(crop_bytes)
    
    return str(crop_path)


def _delete_crop_image(crop_path: str) -> bool:
    """Delete a crop image file. Returns True if deleted."""
    try:
        path = Path(crop_path)
        if path.exists():
            path.unlink()
            return True
        return False
    except Exception as e:
        logger.error(f"Failed to delete crop image {crop_path}: {e}")
        return False


async def _process_plan_pages_task(file_id: str, job_id: str):
    """
    Background task to process all pages in a plan PDF.
    Creates PageContext records and calls Gemini for each page.
    """
    # Create a new database session for the background task
    db = SessionLocal()
    
    try:
        # Get the file
        file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
        if not file:
            logger.error(f"File not found for processing: {file_id}")
            return
        
        # Read the PDF
        file_path = Path(file.path)
        if not file_path.exists():
            logger.error(f"PDF file not found on disk: {file.path}")
            return
        
        pdf_bytes = file_path.read_bytes()
        page_count = _get_pdf_page_count(pdf_bytes)
        
        if page_count == 0:
            logger.error(f"Could not determine page count for {file.name}")
            return
        
        logger.info(f"Starting page context generation for {file.name} ({page_count} pages)")
        
        # Process each page sequentially
        for page_num in range(1, page_count + 1):
            try:
                # Get or create PageContext
                page_context = db.query(PageContext).filter(
                    PageContext.file_id == file_id,
                    PageContext.page_number == page_num
                ).first()
                
                if not page_context:
                    page_context = PageContext(
                        file_id=file_id,
                        page_number=page_num,
                        status="processing",
                        page_title=extract_title_from_filename(file.name),
                        sheet_number=extract_sheet_number_from_filename(file.name)
                    )
                    db.add(page_context)
                else:
                    page_context.status = "processing"
                    page_context.error_message = None
                
                db.commit()
                
                # Call Gemini to analyze the page
                description = await analyze_page(pdf_bytes, page_num, file.name)
                
                # Check for error response
                if description.startswith("[Analysis unavailable"):
                    page_context.status = "error"
                    page_context.error_message = description
                else:
                    page_context.content = description
                    page_context.status = "complete"
                
                page_context.updated_at = datetime.utcnow()
                db.commit()
                
                logger.info(f"Processed page {page_num}/{page_count} of {file.name}")
                
            except Exception as e:
                logger.error(f"Error processing page {page_num} of {file.name}: {e}")
                # Update status to error
                page_context = db.query(PageContext).filter(
                    PageContext.file_id == file_id,
                    PageContext.page_number == page_num
                ).first()
                if page_context:
                    page_context.status = "error"
                    page_context.error_message = str(e)
                    page_context.updated_at = datetime.utcnow()
                    db.commit()
        
        logger.info(f"Completed page context generation for {file.name}")
        
    except Exception as e:
        logger.error(f"Fatal error in page processing task: {e}")
    finally:
        db.close()


@router.post("/plans/{file_id}/process-context", response_model=ProcessContextTriggerResponse)
async def trigger_page_context_processing(
    file_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Trigger background processing of all pages in a plan PDF.
    Returns immediately with a job ID. Frontend can poll processing-status.
    """
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Verify it's a PDF
    if not file.name.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    # Read PDF to get page count
    file_path = Path(file.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on disk")
    
    pdf_bytes = file_path.read_bytes()
    page_count = _get_pdf_page_count(pdf_bytes)
    
    if page_count == 0:
        raise HTTPException(status_code=400, detail="Could not read PDF or PDF has no pages")
    
    # Generate job ID
    job_id = str(uuid4())
    
    # Create pending PageContext records for all pages
    # Extract title and sheet number from filename once
    page_title = extract_title_from_filename(file.name)
    sheet_number = extract_sheet_number_from_filename(file.name)
    
    for page_num in range(1, page_count + 1):
        existing = db.query(PageContext).filter(
            PageContext.file_id == file_id,
            PageContext.page_number == page_num
        ).first()
        
        if not existing:
            page_context = PageContext(
                file_id=file_id,
                page_number=page_num,
                status="pending",
                page_title=page_title,
                sheet_number=sheet_number
            )
            db.add(page_context)
    
    db.commit()
    
    # Start background task
    background_tasks.add_task(_process_plan_pages_task, file_id, job_id)
    
    return ProcessContextTriggerResponse(
        job_id=job_id,
        message=f"Started processing {page_count} pages",
        total_pages=page_count
    )


@router.get("/plans/{file_id}/processing-status", response_model=ProcessingStatusResponse)
def get_processing_status(file_id: str, db: Session = Depends(get_db)):
    """
    Get the current status of page context generation for a plan.
    Frontend should poll this every 2-3 seconds during processing.
    """
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Count pages by status
    contexts = db.query(PageContext).filter(PageContext.file_id == file_id).all()
    
    total = len(contexts)
    completed = sum(1 for c in contexts if c.status == "complete")
    processing = sum(1 for c in contexts if c.status == "processing")
    pending = sum(1 for c in contexts if c.status == "pending")
    errors = sum(1 for c in contexts if c.status == "error")
    
    return ProcessingStatusResponse(
        total=total,
        completed=completed,
        processing=processing,
        pending=pending,
        errors=errors
    )


@router.get("/pages/{file_id}/{page_number}/context", response_model=PageContextWithPointersResponse)
def get_page_context(
    file_id: str,
    page_number: int,
    db: Session = Depends(get_db)
):
    """
    Get the PageContext for a specific page, including related ContextPointers.
    """
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get page context
    page_context = db.query(PageContext).filter(
        PageContext.file_id == file_id,
        PageContext.page_number == page_number
    ).first()
    
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")
    
    # Get related context pointers for this page
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id == file_id,
        ContextPointer.page_number == page_number
    ).all()
    
    return PageContextWithPointersResponse(
        id=page_context.id,
        file_id=page_context.file_id,
        page_number=page_context.page_number,
        content=page_context.content,
        status=page_context.status,
        error_message=page_context.error_message,
        created_at=page_context.created_at,
        updated_at=page_context.updated_at,
        pointers=[ContextPointerResponse.from_orm_model(p) for p in pointers]
    )


@router.get("/page-context/{context_id}", response_model=PageContextWithPointersResponse)
def get_page_context_by_id(
    context_id: str,
    db: Session = Depends(get_db)
):
    """
    Get PageContext by ID with related context pointers.
    Used by AnnotationsPanel to display page context and pointers.
    """
    page_context = db.query(PageContext).filter(PageContext.id == context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")
    
    # Get related context pointers for this page
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id == page_context.file_id,
        ContextPointer.page_number == page_context.page_number
    ).all()
    
    return PageContextWithPointersResponse(
        id=page_context.id,
        file_id=page_context.file_id,
        page_number=page_context.page_number,
        content=page_context.content,
        status=page_context.status,
        error_message=page_context.error_message,
        created_at=page_context.created_at,
        updated_at=page_context.updated_at,
        pointers=[ContextPointerResponse.from_orm_model(p) for p in pointers]
    )


@router.patch("/page-context/{context_id}", response_model=PageContextResponse)
def update_page_context(
    context_id: str,
    update: PageContextUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a PageContext's content (for user editing AI output).
    """
    page_context = db.query(PageContext).filter(PageContext.id == context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")
    
    if update.content is not None:
        page_context.content = update.content
        page_context.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(page_context)
    
    return PageContextResponse(
        id=page_context.id,
        file_id=page_context.file_id,
        page_number=page_context.page_number,
        content=page_context.content,
        status=page_context.status,
        error_message=page_context.error_message,
        created_at=page_context.created_at,
        updated_at=page_context.updated_at
    )


# =============================================================================
# Context Pointers from Highlights (AI-analyzed highlight boxes)
# =============================================================================

@router.post("/pages/{page_context_id}/context-pointers", response_model=ContextPointerResponse, status_code=201)
async def create_context_pointer_from_highlight(
    page_context_id: str,
    body: ContextPointerCreateFromHighlight,
    db: Session = Depends(get_db)
):
    """
    Create a context pointer from a user-drawn highlight box.
    
    1. Validates the page has completed PageContext
    2. Crops the highlighted region from the PDF page
    3. Calls Gemini to analyze the crop with page context
    4. Creates ContextPointer with AI-generated title/description
    """
    # Get the PageContext
    page_context = db.query(PageContext).filter(PageContext.id == page_context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")
    
    # Verify page context is complete (needed for AI analysis)
    if page_context.status != "complete":
        raise HTTPException(
            status_code=400, 
            detail=f"Page context must be complete for highlight analysis. Current status: {page_context.status}"
        )
    
    if not page_context.content:
        raise HTTPException(
            status_code=400,
            detail="Page context has no content. Cannot analyze highlight without page context."
        )
    
    # Get the file
    file = db.query(ProjectFile).filter(ProjectFile.id == page_context.file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Read the PDF
    file_path = Path(file.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on disk")
    
    pdf_bytes = file_path.read_bytes()
    
    # Generate pointer ID first (needed for crop filename)
    pointer_id = str(uuid4())
    
    try:
        # Crop the highlighted region
        crop_bytes = _crop_pdf_page(pdf_bytes, page_context.page_number, body.bbox)
        
        # Save the crop image
        crop_path = _save_crop_image(crop_bytes, page_context.file_id, pointer_id)

        # Get text spans from cache or extract them
        cached = page_context.page_text_spans or {}
        if cached.get("spans"):
            # Use cached page-level text spans (line-level for AI context)
            all_page_spans = cached["spans"]
            page_width = cached.get("page_width", 1)
            page_height = cached.get("page_height", 1)
            logger.info(f"Using cached text spans for page {page_context.page_number}: {len(all_page_spans)} spans")
        else:
            # Extract and cache text spans (hybrid PyMuPDF + OCR)
            line_spans, word_spans, page_width, page_height = _extract_all_page_spans(
                pdf_path=file.path,
                page_num=page_context.page_number - 1,  # convert to 0-indexed
            )
            all_page_spans = line_spans  # Use line-level for AI context
            # Cache both line and word spans
            page_context.page_text_spans = {
                "spans": line_spans,
                "words": word_spans,
                "page_width": page_width,
                "page_height": page_height,
                "extracted_at": datetime.utcnow().isoformat(),
            }
            db.commit()
            logger.info(f"Extracted and cached {len(line_spans)} line + {len(word_spans)} word spans for page {page_context.page_number}")

        # Analyze with Gemini - includes vision-based span matching
        bbox_dict = {
            "x": body.bbox.x,
            "y": body.bbox.y,
            "width": body.bbox.width,
            "height": body.bbox.height
        }
        analysis = await analyze_highlight(
            crop_bytes, 
            page_context.content, 
            bbox_dict,
            all_page_spans=all_page_spans
        )
        
        # Filter to only visible spans identified by the vision model
        visible_ids = set(analysis.get("visible_span_ids", []))
        matched_spans = [s for s in all_page_spans if s["id"] in visible_ids]
        
        print(f"=== VISION MATCHING DEBUG ===")
        print(f"Total page spans: {len(all_page_spans)}")
        print(f"Visible span IDs from agent: {visible_ids}")
        print(f"Matched spans: {len(matched_spans)}")
        if matched_spans:
            print(f"First matched: {matched_spans[0]}")
        print(f"=== END VISION MATCHING DEBUG ===")
        
        # Build text_content from matched spans
        text_content = {
            "full_text": " ".join([s["text"] for s in matched_spans]),
            "text_elements": [
                {
                    "id": f"{pointer_id}_t{i}",
                    "text": s["text"],
                    "bbox": {
                        "x0": s["bbox"][0],
                        "y0": s["bbox"][1],
                        "x1": s["bbox"][2],
                        "y1": s["bbox"][3]
                    },
                    "font": s.get("font", ""),
                    "size": s.get("size", 0),
                    "flags": 0
                }
                for i, s in enumerate(matched_spans)
            ],
            "clip_rect": {
                "x0": body.bbox.x * page_width,
                "y0": body.bbox.y * page_height,
                "x1": (body.bbox.x + body.bbox.width) * page_width,
                "y1": (body.bbox.y + body.bbox.height) * page_height
            },
            "page_width": page_width,
            "page_height": page_height
        }
        
        # Create the ContextPointer with ALL fields populated from single-shot analysis
        db_pointer = ContextPointer(
            id=pointer_id,
            file_id=page_context.file_id,
            page_context_id=page_context_id,
            page_number=page_context.page_number,
            bounds_x=body.bbox.x,
            bounds_y=body.bbox.y,
            bounds_w=body.bbox.width,
            bounds_h=body.bbox.height,
            style_color="#ff0000",
            style_stroke_width=2,
            title=analysis.get("title", "Highlight"),
            description=analysis.get("description", ""),
            crop_path=crop_path,
            text_content=text_content,  # Store extracted text with positions
            # AI analysis fields - populated immediately from single-shot analysis
            ai_technical_description=analysis.get("technicalDescription", ""),
            ai_trade_category=analysis.get("tradeCategory", "general"),
            ai_elements=analysis.get("identifiedElements", []),
            ai_recommendations=analysis.get("recommendations", ""),
            ai_measurements=analysis.get("measurements", []),
            ai_issues=analysis.get("issues", []),
            status="complete",
        )
        db.add(db_pointer)
        db.commit()
        db.refresh(db_pointer)
        
        return ContextPointerResponse.from_orm_model(db_pointer)
        
    except Exception as e:
        logger.error(f"Failed to create context pointer from highlight: {e}")
        # Clean up crop file if it was created
        if 'crop_path' in locals():
            _delete_crop_image(crop_path)
        raise HTTPException(status_code=500, detail=f"Failed to analyze highlight: {str(e)}")


@router.get("/pages/{page_context_id}/context-pointers", response_model=List[ContextPointerResponse])
def list_page_context_pointers(
    page_context_id: str,
    db: Session = Depends(get_db)
):
    """
    List all context pointers for a specific page.
    """
    # Get the PageContext
    page_context = db.query(PageContext).filter(PageContext.id == page_context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")
    
    # Get pointers for this page
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id == page_context.file_id,
        ContextPointer.page_number == page_context.page_number
    ).all()
    
    return [ContextPointerResponse.from_orm_model(p) for p in pointers]


@router.get("/debug/ocr-status")
def debug_ocr_status():
    """Debug endpoint to check OCR availability."""
    result = {
        "pytesseract_installed": False,
        "pillow_installed": False,
        "tesseract_binary": None,
        "error": None,
    }

    try:
        import pytesseract
        result["pytesseract_installed"] = True
        result["tesseract_binary"] = pytesseract.pytesseract.tesseract_cmd
    except ImportError as e:
        result["error"] = f"pytesseract import failed: {e}"

    try:
        from PIL import Image
        result["pillow_installed"] = True
    except ImportError as e:
        result["error"] = f"Pillow import failed: {e}"

    return result


@router.post("/pages/{page_context_id}/refresh-text-spans")
def refresh_page_text_spans(
    page_context_id: str,
    db: Session = Depends(get_db)
):
    """
    Re-extract text spans for a page using hybrid PyMuPDF + OCR.

    This clears the cached page_text_spans and re-runs extraction with
    the latest algorithm (line-grouped OCR).
    """
    # Get the PageContext
    page_context = db.query(PageContext).filter(PageContext.id == page_context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")

    # Get the file
    file = db.query(ProjectFile).filter(ProjectFile.id == page_context.file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    # Run hybrid extraction
    try:
        line_spans, word_spans, page_width, page_height = _extract_all_page_spans(
            pdf_path=file.path,
            page_num=page_context.page_number - 1,  # 0-indexed
        )

        # Update cached spans (both line and word level)
        page_context.page_text_spans = {
            "spans": line_spans,
            "words": word_spans,
            "page_width": page_width,
            "page_height": page_height,
            "extracted_at": datetime.utcnow().isoformat(),
        }
        db.commit()

        # Count by source
        native_count = sum(1 for s in line_spans if s.get("source") == "native")
        ocr_count = sum(1 for s in line_spans if s.get("source") == "ocr")

        logger.info(f"Refreshed text spans for page {page_context.page_title}: {len(line_spans)} line + {len(word_spans)} word spans")

        return {
            "success": True,
            "page_id": page_context_id,
            "page_title": page_context.page_title,
            "total_spans": len(line_spans),
            "word_spans": len(word_spans),
            "native_spans": native_count,
            "ocr_spans": ocr_count,
            "page_width": page_width,
            "page_height": page_height,
        }

    except Exception as e:
        logger.error(f"Failed to refresh text spans for page {page_context_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text spans: {str(e)}")


@router.post("/pages/{page_context_id}/refresh-pointer-text")
def refresh_pointer_text_content(
    page_context_id: str,
    db: Session = Depends(get_db)
):
    """
    Refresh text_content for all pointers on a page using cached page_text_spans.

    This is needed when pointers were created before OCR was enabled.
    Uses bounding box overlap to match spans to pointers.
    """
    # Get the PageContext
    page_context = db.query(PageContext).filter(PageContext.id == page_context_id).first()
    if not page_context:
        raise HTTPException(status_code=404, detail="Page context not found")

    # Check for cached spans
    cached = page_context.page_text_spans or {}
    all_page_spans = cached.get("spans", [])
    page_width = cached.get("page_width", 1)
    page_height = cached.get("page_height", 1)

    if not all_page_spans:
        raise HTTPException(status_code=400, detail="No cached text spans. Run refresh-text-spans first.")

    # Get all pointers for this page
    pointers = db.query(ContextPointer).filter(
        ContextPointer.page_context_id == page_context_id
    ).all()

    if not pointers:
        return {"success": True, "message": "No pointers on this page", "updated": 0}

    def spans_overlap(span_bbox: list, pointer_x: float, pointer_y: float,
                      pointer_w: float, pointer_h: float) -> bool:
        """Check if span bbox overlaps with pointer region (both in normalized coords)."""
        # Convert span bbox from PDF points to normalized
        sx0 = span_bbox[0] / page_width
        sy0 = span_bbox[1] / page_height
        sx1 = span_bbox[2] / page_width
        sy1 = span_bbox[3] / page_height

        # Pointer bounds
        px0 = pointer_x
        py0 = pointer_y
        px1 = pointer_x + pointer_w
        py1 = pointer_y + pointer_h

        # Check overlap
        return not (sx1 < px0 or sx0 > px1 or sy1 < py0 or sy0 > py1)

    updated_count = 0

    for pointer in pointers:
        # Find spans that overlap with this pointer
        matched_spans = [
            s for s in all_page_spans
            if spans_overlap(s["bbox"], pointer.bounds_x, pointer.bounds_y,
                           pointer.bounds_w, pointer.bounds_h)
        ]

        if matched_spans:
            # Build new text_content
            text_content = {
                "full_text": " ".join([s["text"] for s in matched_spans]),
                "text_elements": [
                    {
                        "id": f"{pointer.id}_t{i}",
                        "text": s["text"],
                        "bbox": {
                            "x0": s["bbox"][0],
                            "y0": s["bbox"][1],
                            "x1": s["bbox"][2],
                            "y1": s["bbox"][3]
                        },
                        "font": s.get("font", ""),
                        "size": s.get("size", 0),
                        "flags": 0
                    }
                    for i, s in enumerate(matched_spans)
                ],
                "clip_rect": {
                    "x0": pointer.bounds_x * page_width,
                    "y0": pointer.bounds_y * page_height,
                    "x1": (pointer.bounds_x + pointer.bounds_w) * page_width,
                    "y1": (pointer.bounds_y + pointer.bounds_h) * page_height
                },
                "page_width": page_width,
                "page_height": page_height
            }

            pointer.text_content = text_content
            pointer.updated_at = datetime.utcnow()
            updated_count += 1

            logger.info(f"Updated pointer {pointer.id[:8]}... with {len(matched_spans)} text elements")

    db.commit()

    return {
        "success": True,
        "page_id": page_context_id,
        "page_title": page_context.page_title,
        "total_pointers": len(pointers),
        "updated_pointers": updated_count,
        "page_spans_available": len(all_page_spans),
    }


@router.post("/projects/{project_id}/refresh-all-text-spans")
def refresh_all_project_text_spans(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Refresh text spans and pointer text_content for ALL pages in a project.

    This runs hybrid OCR extraction on each page, then updates all pointers
    with matched text elements. Run this before reprocessing Pass 1.
    """
    import fitz

    # Get all page contexts for this project
    pages = db.query(PageContext).join(
        ProjectFile, PageContext.file_id == ProjectFile.id
    ).filter(
        ProjectFile.project_id == project_id
    ).all()

    if not pages:
        return {"success": True, "message": "No pages found", "pages_processed": 0}

    results = []

    for page_context in pages:
        try:
            # Get the file
            file = db.query(ProjectFile).filter(ProjectFile.id == page_context.file_id).first()
            if not file or not file.path:
                results.append({
                    "page_id": page_context.id,
                    "page_title": page_context.page_title,
                    "status": "error",
                    "error": "File not found"
                })
                continue

            # Step 1: Extract text spans (hybrid OCR)
            line_spans, word_spans, page_width, page_height = _extract_all_page_spans(
                pdf_path=file.path,
                page_num=page_context.page_number - 1,
            )

            # Cache both line and word spans
            page_context.page_text_spans = {
                "spans": line_spans,
                "words": word_spans,
                "page_width": page_width,
                "page_height": page_height,
                "extracted_at": datetime.utcnow().isoformat(),
            }

            # Step 2: Update pointers with matched text elements (using line spans for AI context)
            pointers = db.query(ContextPointer).filter(
                ContextPointer.page_context_id == page_context.id
            ).all()

            def spans_overlap(span_bbox: list, pointer_x: float, pointer_y: float,
                              pointer_w: float, pointer_h: float) -> bool:
                sx0 = span_bbox[0] / page_width
                sy0 = span_bbox[1] / page_height
                sx1 = span_bbox[2] / page_width
                sy1 = span_bbox[3] / page_height
                px0, py0 = pointer_x, pointer_y
                px1, py1 = pointer_x + pointer_w, pointer_y + pointer_h
                return not (sx1 < px0 or sx0 > px1 or sy1 < py0 or sy0 > py1)

            pointers_updated = 0
            for pointer in pointers:
                matched_spans = [
                    s for s in line_spans
                    if spans_overlap(s["bbox"], pointer.bounds_x, pointer.bounds_y,
                                   pointer.bounds_w, pointer.bounds_h)
                ]
                if matched_spans:
                    pointer.text_content = {
                        "full_text": " ".join([s["text"] for s in matched_spans]),
                        "text_elements": [
                            {
                                "id": f"{pointer.id}_t{i}",
                                "text": s["text"],
                                "bbox": {"x0": s["bbox"][0], "y0": s["bbox"][1],
                                        "x1": s["bbox"][2], "y1": s["bbox"][3]},
                                "font": s.get("font", ""),
                                "size": s.get("size", 0),
                                "flags": 0
                            }
                            for i, s in enumerate(matched_spans)
                        ],
                        "page_width": page_width,
                        "page_height": page_height
                    }
                    pointer.updated_at = datetime.utcnow()
                    pointers_updated += 1

            db.commit()

            # Count spans by source (line_spans contain both native and OCR lines)
            native_count = sum(1 for s in line_spans if s.get("source") == "native")
            ocr_count = sum(1 for s in line_spans if s.get("source") == "ocr")

            results.append({
                "page_id": page_context.id,
                "page_title": page_context.page_title,
                "status": "success",
                "line_spans": len(line_spans),
                "word_spans": len(word_spans),
                "native": native_count,
                "ocr": ocr_count,
                "pointers_updated": pointers_updated,
            })

            logger.info(f"Refreshed {page_context.page_title}: {len(line_spans)} lines, {len(word_spans)} words, {pointers_updated} pointers")

        except Exception as e:
            logger.error(f"Failed to refresh page {page_context.page_title}: {e}")
            results.append({
                "page_id": page_context.id,
                "page_title": page_context.page_title,
                "status": "error",
                "error": str(e)
            })

    success_count = sum(1 for r in results if r["status"] == "success")

    return {
        "success": True,
        "project_id": project_id,
        "pages_processed": success_count,
        "pages_failed": len(results) - success_count,
        "results": results
    }


@router.patch("/context-pointers/{pointer_id}", response_model=ContextPointerResponse)
def update_context_pointer(
    pointer_id: str,
    update: ContextPointerUpdate,
    db: Session = Depends(get_db)
):
    """
    Update a context pointer's title and/or description (user editing AI output).
    """
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Context pointer not found")
    
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
    
    pointer.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(pointer)
    
    return ContextPointerResponse.from_orm_model(pointer)


@router.delete("/context-pointers/{pointer_id}", status_code=204)
def delete_context_pointer(
    pointer_id: str,
    db: Session = Depends(get_db)
):
    """
    Delete a context pointer and its associated crop image.
    """
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Context pointer not found")
    
    # Delete crop image if it exists
    if pointer.crop_path:
        _delete_crop_image(pointer.crop_path)
    
    # Delete the database record
    db.delete(pointer)
    db.commit()
    
    return None


# =============================================================================
# Context Preview and Commit (for ViewM4D publishing)
# =============================================================================

@router.get("/plans/{file_id}/context-preview", response_model=ContextPreviewResponse)
def get_context_preview(
    file_id: str,
    db: Session = Depends(get_db)
):
    """
    Get full context preview for a plan, showing all pages and their pointers.
    Used by the "Load Context Preview" modal before committing.
    """
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get all page contexts for this file
    page_contexts = db.query(PageContext).filter(
        PageContext.file_id == file_id
    ).order_by(PageContext.page_number).all()
    
    # Build page previews
    pages: List[PagePreview] = []
    total_pointers = 0
    pages_complete = 0
    pages_with_errors = 0
    pages_committed = 0
    
    for pc in page_contexts:
        # Get pointers for this page
        pointers = db.query(ContextPointer).filter(
            ContextPointer.file_id == file_id,
            ContextPointer.page_number == pc.page_number
        ).all()
        
        pointer_previews = [
            ContextPointerPreview(
                id=p.id,
                title=p.title,
                description=p.description
            )
            for p in pointers
        ]
        
        total_pointers += len(pointers)
        
        if pc.status == "complete":
            pages_complete += 1
        elif pc.status == "error":
            pages_with_errors += 1
        
        if pc.committed_at:
            pages_committed += 1
        
        # Generate page name (e.g., "Page 1" or use sheet name if available)
        page_name = f"Page {pc.page_number}"
        
        pages.append(PagePreview(
            page_id=pc.id,
            page_number=pc.page_number,
            page_name=page_name,
            context=pc.content,
            context_status=pc.status,
            committed_at=pc.committed_at,
            pointers=pointer_previews
        ))
    
    return ContextPreviewResponse(
        plan_id=file_id,
        plan_name=file.name,
        pages=pages,
        summary=ContextPreviewSummary(
            total_pages=len(page_contexts),
            total_pointers=total_pointers,
            pages_complete=pages_complete,
            pages_with_errors=pages_with_errors,
            pages_committed=pages_committed
        )
    )


@router.get("/projects/{project_id}/commit-preview", response_model=ProjectCommitPreviewResponse)
def get_project_commit_preview(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Get project-wide commit preview showing ALL pointers with their AI analysis.
    Used by the "Commit to ViewM4D" modal to preview what will be committed.
    
    Returns all pointers across all files in the project, grouped by file,
    including:
    - Crop image path (for visual preview)
    - AI analysis (trade, elements, recommendations)
    - Bounding box data
    - Commit status
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).order_by(ProjectFile.name).all()
    
    # Build file previews
    files: List[FileCommitPreview] = []
    total_pointers = 0
    pointers_with_ai = 0
    pointers_committed = 0
    files_with_ai = 0
    
    for file in pdf_files:
        # Get all pointers for this file
        pointers = db.query(ContextPointer).filter(
            ContextPointer.file_id == file.id
        ).order_by(ContextPointer.page_number, ContextPointer.created_at).all()
        
        if not pointers:
            continue  # Skip files with no pointers
        
        file_pointers_with_ai = 0
        pointer_previews: List[PointerCommitPreview] = []
        
        for p in pointers:
            # Build AI analysis if present
            ai_analysis = None
            if p.ai_technical_description or p.ai_trade_category or p.ai_elements or p.ai_recommendations:
                ai_analysis = AIAnalysisPreview(
                    technical_description=p.ai_technical_description,
                    trade_category=p.ai_trade_category,
                    identified_elements=p.ai_elements,
                    recommendations=p.ai_recommendations
                )
                file_pointers_with_ai += 1
            
            # Build bounds
            bounds = ContextPointerBounds(
                x_norm=p.bounds_x,
                y_norm=p.bounds_y,
                w_norm=p.bounds_w,
                h_norm=p.bounds_h
            )
            
            pointer_previews.append(PointerCommitPreview(
                id=p.id,
                title=p.title,
                description=p.description,
                page_number=p.page_number,
                bounds=bounds,
                crop_path=p.crop_path,
                ai_analysis=ai_analysis,
                committed_at=p.committed_at
            ))
            
            if p.committed_at:
                pointers_committed += 1
        
        total_pointers += len(pointers)
        pointers_with_ai += file_pointers_with_ai
        if file_pointers_with_ai > 0:
            files_with_ai += 1
        
        files.append(FileCommitPreview(
            id=file.id,
            name=file.name,
            pointer_count=len(pointers),
            pointers_with_ai=file_pointers_with_ai,
            pointers=pointer_previews
        ))
    
    return ProjectCommitPreviewResponse(
        project_id=project_id,
        project_name=project.name,
        files=files,
        summary=ProjectCommitPreviewSummary(
            total_files=len(files),
            total_pointers=total_pointers,
            pointers_with_ai=pointers_with_ai,
            pointers_committed=pointers_committed,
            files_with_ai=files_with_ai
        )
    )


# =============================================================================
# Project Context Summary (Global context across all files)
# =============================================================================

@router.get("/projects/{project_id}/context-summary", response_model=ProjectContextSummaryResponse)
def get_project_context_summary(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Get full context summary for a project across all PDF files.
    Returns hierarchical data: project -> files -> pages -> pointers.
    Used by the global context TreeView.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).order_by(ProjectFile.name).all()
    
    # Build file summaries
    files: List[FileSummary] = []
    total_pages = 0
    total_pointers = 0
    all_pages_complete = 0
    all_pages_with_errors = 0
    all_pages_committed = 0
    
    for file in pdf_files:
        # Get all page contexts for this file
        page_contexts = db.query(PageContext).filter(
            PageContext.file_id == file.id
        ).order_by(PageContext.page_number).all()
        
        # Get all pointers for this file
        all_pointers = db.query(ContextPointer).filter(
            ContextPointer.file_id == file.id
        ).all()
        
        # Build page summaries
        pages: List[PageSummary] = []
        file_pages_complete = 0
        file_pages_with_errors = 0
        file_pages_committed = 0
        file_pointer_count = len(all_pointers)
        
        for pc in page_contexts:
            # Get pointers for this page
            page_pointers = [p for p in all_pointers if p.page_number == pc.page_number]
            
            pointer_summaries = [
                PointerSummary(
                    id=p.id,
                    title=p.title,
                    description=p.description,
                    page_number=p.page_number,
                    bounds=ContextPointerBounds(
                        x_norm=p.bounds_x,
                        y_norm=p.bounds_y,
                        w_norm=p.bounds_w,
                        h_norm=p.bounds_h,
                    )
                )
                for p in page_pointers
            ]
            
            # Count statuses
            if pc.status == "complete":
                file_pages_complete += 1
            elif pc.status == "error":
                file_pages_with_errors += 1
            
            if pc.committed_at:
                file_pages_committed += 1
            
            # Create context preview (first 200 chars)
            context_preview = None
            if pc.content:
                context_preview = pc.content[:200] + "..." if len(pc.content) > 200 else pc.content
            
            pages.append(PageSummary(
                id=pc.id,
                page_number=pc.page_number,
                status=pc.status,
                has_context=bool(pc.content),
                context_preview=context_preview,
                committed_at=pc.committed_at,
                pointer_count=len(page_pointers),
                pointers=pointer_summaries
            ))
        
        # Update totals
        total_pages += len(page_contexts)
        total_pointers += file_pointer_count
        all_pages_complete += file_pages_complete
        all_pages_with_errors += file_pages_with_errors
        all_pages_committed += file_pages_committed
        
        files.append(FileSummary(
            id=file.id,
            name=file.name,
            file_type=file.file_type,
            page_count=len(page_contexts),
            pointer_count=file_pointer_count,
            pages_complete=file_pages_complete,
            pages_with_errors=file_pages_with_errors,
            pages_committed=file_pages_committed,
            pages=pages
        ))
    
    return ProjectContextSummaryResponse(
        project_id=project_id,
        total_files=len(files),
        total_pages=total_pages,
        total_pointers=total_pointers,
        pages_complete=all_pages_complete,
        pages_with_errors=all_pages_with_errors,
        pages_committed=all_pages_committed,
        files=files
    )


@router.post("/plans/{file_id}/commit-context", response_model=ContextCommitResponse)
def commit_context_to_viewm4d(
    file_id: str,
    db: Session = Depends(get_db)
):
    """
    Commit all context for a plan to ViewM4D (marks as published).
    
    1. Validates all pages have been processed
    2. Sets committed_at timestamp on all PageContext records
    3. Returns summary with any warnings
    """
    # Verify file exists
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Get all page contexts
    page_contexts = db.query(PageContext).filter(
        PageContext.file_id == file_id
    ).all()
    
    if not page_contexts:
        raise HTTPException(
            status_code=400,
            detail="No page contexts found. Run 'Process Context' first."
        )
    
    # Check for issues and collect warnings
    warnings = []
    pending_pages = []
    error_pages = []
    
    for pc in page_contexts:
        if pc.status == "pending":
            pending_pages.append(pc.page_number)
        elif pc.status == "error":
            error_pages.append(pc.page_number)
    
    if pending_pages:
        warnings.append(f"Pages still pending processing: {pending_pages}")
    
    if error_pages:
        warnings.append(f"Pages with errors (will be committed anyway): {error_pages}")
    
    # Get all context pointers for this file
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id == file_id
    ).all()
    total_pointers = len(pointers)
    
    # Commit all page contexts and context pointers
    commit_time = datetime.utcnow()
    pages_committed = 0
    pointers_committed = 0
    pointers_already_committed = 0
    
    for pc in page_contexts:
        # Only commit pages that are complete or have errors (not pending)
        if pc.status in ("complete", "error") and not pc.committed_at:
            pc.committed_at = commit_time
            pages_committed += 1
    
    # Commit all context pointers for this file (skip already committed)
    for pointer in pointers:
        if pointer.committed_at:
            pointers_already_committed += 1
            continue
        pointer.committed_at = commit_time
        pointers_committed += 1
    
    if pointers_already_committed > 0:
        warnings.append(f"{pointers_already_committed} pointer(s) were already committed and skipped")
    
    db.commit()
    
    logger.info(f"Committed context for {file.name}: {pages_committed} pages, {pointers_committed} pointers")
    
    return ContextCommitResponse(
        pages_committed=pages_committed,
        pointers_committed=pointers_committed,
        committed_at=commit_time,
        warnings=warnings
    )


@router.post("/projects/{project_id}/commit-context", response_model=ContextCommitResponse)
def commit_project_context_to_viewm4d(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Commit ALL context pointers for a project to ViewM4D (marks as published).
    
    1. Finds all context pointers across all files in the project
    2. Sets committed_at timestamp on all ContextPointer records
    3. Returns summary with total counts
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    if not pdf_files:
        raise HTTPException(status_code=400, detail="No PDF files found in project")
    
    file_ids = [f.id for f in pdf_files]
    
    # Get all context pointers for these files
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id.in_(file_ids)
    ).all()
    
    if not pointers:
        raise HTTPException(
            status_code=400,
            detail="No context pointers found. Create some highlights first."
        )
    
    # Only commit pointers that have been AI processed and not already committed
    commit_time = datetime.utcnow()
    pointers_committed = 0
    pointers_skipped = 0
    pointers_already_committed = 0
    warnings = []
    
    for pointer in pointers:
        # Skip pointers that have already been committed
        if pointer.committed_at:
            pointers_already_committed += 1
            continue
        # Only commit if AI analysis has been completed
        if pointer.ai_technical_description:
            pointer.committed_at = commit_time
            pointers_committed += 1
        else:
            pointers_skipped += 1
    
    if pointers_already_committed > 0:
        warnings.append(f"{pointers_already_committed} pointer(s) were already committed and skipped")
    if pointers_skipped > 0:
        warnings.append(f"{pointers_skipped} pointer(s) without AI analysis were skipped")
    
    if pointers_committed == 0:
        raise HTTPException(
            status_code=400,
            detail="No pointers with AI analysis found. Run 'Process with AI' first."
        )
    
    # Also commit all page contexts for these files
    page_contexts = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids)
    ).all()
    
    pages_committed = 0
    for pc in page_contexts:
        if pc.status in ("complete", "error"):
            pc.committed_at = commit_time
            pages_committed += 1
    
    db.commit()
    
    logger.info(f"Committed project {project.name}: {pages_committed} pages, {pointers_committed} pointers")
    
    return ContextCommitResponse(
        pages_committed=pages_committed,
        pointers_committed=pointers_committed,
        committed_at=commit_time,
        warnings=warnings
    )


# =============================================================================
# Project Context Management (Un-commit, Clear AI, Delete All)
# =============================================================================

@router.post("/projects/{project_id}/uncommit-pointers")
def uncommit_project_pointers(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Clear committed_at timestamps on all context pointers for a project.
    This is a "reverse commit" - pointers remain but are no longer published.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    file_ids = [f.id for f in pdf_files]
    
    # Clear committed_at on all pointers that have it set
    pointers_uncommitted = db.query(ContextPointer).filter(
        ContextPointer.file_id.in_(file_ids),
        ContextPointer.committed_at.isnot(None)
    ).update({ContextPointer.committed_at: None}, synchronize_session=False)
    
    # Also clear committed_at on page contexts
    pages_uncommitted = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.committed_at.isnot(None)
    ).update({PageContext.committed_at: None}, synchronize_session=False)
    
    db.commit()
    
    logger.info(f"Uncommitted project {project.name}: {pointers_uncommitted} pointers, {pages_uncommitted} pages")
    
    return {
        "pointersUncommitted": pointers_uncommitted,
        "pagesUncommitted": pages_uncommitted
    }


@router.post("/projects/{project_id}/clear-ai-analysis")
def clear_project_ai_analysis(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Clear AI analysis fields on all context pointers for a project.
    Pointers remain but need to be re-processed with AI.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    file_ids = [f.id for f in pdf_files]
    
    # Clear AI fields on all pointers that have AI analysis
    pointers_cleared = db.query(ContextPointer).filter(
        ContextPointer.file_id.in_(file_ids),
        ContextPointer.ai_technical_description.isnot(None)
    ).update({
        ContextPointer.ai_technical_description: None,
        ContextPointer.ai_trade_category: None,
        ContextPointer.ai_elements: None,
        ContextPointer.ai_recommendations: None,
        # Also clear committed_at since AI data is gone
        ContextPointer.committed_at: None,
    }, synchronize_session=False)
    
    db.commit()
    
    logger.info(f"Cleared AI analysis for project {project.name}: {pointers_cleared} pointers")
    
    return {"pointersCleared": pointers_cleared}


@router.delete("/projects/{project_id}/pointers")
def delete_all_project_pointers(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Delete ALL context pointers for a project.
    Also cleans up associated crop images.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    file_ids = [f.id for f in pdf_files]
    
    # Get all pointers to delete their crop images
    pointers = db.query(ContextPointer).filter(
        ContextPointer.file_id.in_(file_ids)
    ).all()
    
    pointers_deleted = len(pointers)
    
    # Delete crop images
    for pointer in pointers:
        if pointer.crop_path:
            _delete_crop_image(pointer.crop_path)
    
    # Delete all pointers
    db.query(ContextPointer).filter(
        ContextPointer.file_id.in_(file_ids)
    ).delete(synchronize_session=False)
    
    db.commit()
    
    logger.info(f"Deleted all pointers for project {project.name}: {pointers_deleted} pointers")
    
    return {"pointersDeleted": pointers_deleted}


# =============================================================================
# AI Input Preview Endpoints (serving images sent to Gemini)
# =============================================================================

@router.get("/crops/{pointer_id}")
def get_crop_image(
    pointer_id: str,
    db: Session = Depends(get_db)
):
    """
    Serve the crop image for a context pointer.
    This is the exact image that was sent to Gemini for analysis.
    """
    # Get the pointer
    pointer = db.query(ContextPointer).filter(ContextPointer.id == pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Context pointer not found")
    
    # Check if crop_path exists
    if not pointer.crop_path:
        raise HTTPException(status_code=404, detail="No crop image available for this pointer")
    
    # Read the crop image
    crop_path = Path(pointer.crop_path)
    if not crop_path.exists():
        raise HTTPException(status_code=404, detail="Crop image file not found on disk")
    
    # Return the image bytes
    image_bytes = crop_path.read_bytes()
    return Response(
        content=image_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
    )


@router.get("/pages/{file_id}/{page_number}/preview")
def get_page_preview(
    file_id: str,
    page_number: int,
    db: Session = Depends(get_db)
):
    """
    Render and serve a PDF page as PNG image.
    This shows the equivalent of what was sent to Gemini for page context analysis.
    Uses same 2x zoom as crop rendering for consistency.
    """
    import fitz  # PyMuPDF
    
    # Get the file
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Verify it's a PDF
    if not file.name.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="File must be a PDF")
    
    # Read the PDF
    file_path = Path(file.path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on disk")
    
    try:
        pdf_bytes = file_path.read_bytes()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        # Validate page number
        if page_number < 1 or page_number > len(doc):
            doc.close()
            raise HTTPException(
                status_code=400, 
                detail=f"Page {page_number} out of range. PDF has {len(doc)} pages."
            )
        
        # Get the page (0-indexed)
        page = doc[page_number - 1]
        
        # Render at 2x zoom (matching crop rendering resolution)
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Convert to PNG bytes
        png_bytes = pix.tobytes("png")
        
        doc.close()
        
        return Response(
            content=png_bytes,
            media_type="image/png",
            headers={
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to render page {page_number} of {file.name}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to render page: {str(e)}")

