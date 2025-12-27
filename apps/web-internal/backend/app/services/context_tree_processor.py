"""
Context Tree Processor - Hierarchical context generation for construction documents.

This module implements a three-pass processing pipeline:
- Pass 1: Page Analysis - Extracts discipline, context, and identifiers per page
- Pass 2: Cross-References - Links pages based on shared identifiers
- Pass 3: Discipline Rollup - Aggregates page context into discipline-level summaries

Usage:
    processor = PageProcessor(concurrency_limit=5, progress_callback=my_callback)
    await processor.start_processing(project_id)
"""

import asyncio
import json
import logging
import re
from typing import Optional, Callable, Any
from datetime import datetime

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import PageContext, DisciplineContext, ContextPointer, ProjectFile, Project

# Configure logging
logger = logging.getLogger(__name__)

# Gemini configuration (reuse from gemini_service)
import os
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds

# Token limits
CONTEXT_TREE_MAX_TOKENS = 4096


# =============================================================================
# Discipline Code Mapping
# =============================================================================

DISCIPLINE_CODES = {
    "A": "Architectural",
    "S": "Structural",
    "M": "Mechanical",
    "E": "Electrical",
    "P": "Plumbing",
    "FP": "Fire Protection",
    "C": "Civil",
    "L": "Landscape",
    "G": "General",
}


def get_discipline_name(code: str) -> str:
    """Map discipline code to full name."""
    return DISCIPLINE_CODES.get(code, "General")


# =============================================================================
# Filename Extraction Helpers
# =============================================================================

def extract_title_from_filename(filename: str) -> str:
    """
    Extract page title from PDF filename.
    
    Examples:
        "A401 Details.pdf" → "A401 Details"
        "AS2.1 OMD Canopy Plan.pdf" → "AS2.1 OMD Canopy Plan"
    """
    # Remove .pdf extension (case-insensitive)
    if filename.lower().endswith('.pdf'):
        return filename[:-4]
    return filename


def extract_sheet_number_from_filename(filename: str) -> Optional[str]:
    """
    Extract sheet number from PDF filename.
    
    Matches patterns like:
        "A401 Details.pdf" → "A401"
        "AS2.1 OMD Canopy Plan.pdf" → "AS2.1"
        "M3.2 Mechanical Plan.pdf" → "M3.2"
    
    Returns None if no sheet number pattern is found.
    """
    # Match sheet number patterns at start of filename
    # Pattern: 1-2 letters followed by 2-3 digits, optionally followed by .digit(s)
    match = re.match(r'^([A-Z]{1,2}\d{2,3}(?:\.\d+)?)', filename, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


# =============================================================================
# Reference Matching Helpers
# =============================================================================

def normalize_sheet_ref(ref: str) -> str:
    """
    Normalize sheet reference for matching.
    Handles format variations: A-101/A101/A.101, detail callouts like "3/A-501"

    Examples:
        "A-101" -> "A101"
        "AS2.1" -> "AS21"
        "3/A-501" -> "A501" (extracts sheet portion from detail callout)
    """
    if not ref:
        return ""

    # Handle detail callouts: "3/A501" -> extract sheet portion
    if '/' in ref:
        parts = ref.split('/')
        for part in parts:
            clean = re.sub(r'[-.\s]', '', part.upper())
            if re.match(r'^[A-Z]+\d', clean):  # Starts with letters then numbers
                return clean

    # Remove common separators
    return re.sub(r'[-.\s]', '', ref.upper())


def compute_inbound_references(db: Session, project_id: str) -> None:
    """
    Invert outbound references to compute inbound references.
    Called after all Pass 1 completes, before Pass 2 starts.
    Uses normalized matching to handle format variations.
    """
    from collections import defaultdict

    # Get project to find its files
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        logger.error(f"Project not found: {project_id}")
        return

    # Get all files for this project
    file_ids = [f.id for f in db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()]

    # Get all pages that have completed Pass 1
    pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status == "pass1_complete"
    ).all()

    if not pages:
        logger.info(f"No pass1_complete pages found for project {project_id}")
        return

    # Build normalized lookup: normalized_sheet -> original sheet_number
    page_lookup = {}
    for page in pages:
        if page.sheet_number:
            normalized = normalize_sheet_ref(page.sheet_number)
            page_lookup[normalized] = page.sheet_number

    # Build inbound map using normalized matching
    inbound_map = defaultdict(list)

    for page in pages:
        pass1 = page.pass1_output or {}
        for pointer in pass1.get("pointers", []):
            for ref in pointer.get("outbound_refs", []):
                ref_str = ref.get("ref", "")
                normalized_ref = normalize_sheet_ref(ref_str)
                if normalized_ref and normalized_ref in page_lookup:
                    target_sheet = page_lookup[normalized_ref]
                    inbound_entry = {
                        "source_sheet": page.sheet_number,
                        "source_page_id": str(page.id),
                        "from_pointer": pointer.get("pointer_id", ""),
                        "type": ref.get("type", ""),
                        "original_ref": ref_str  # Preserve original for display
                        # context intentionally omitted - populated after Pass 2
                    }
                    # Copy source element info if available (from Pass 1 with text elements)
                    if ref.get("source_element_id"):
                        inbound_entry["source_element_id"] = ref["source_element_id"]
                    if ref.get("source_text"):
                        inbound_entry["source_text"] = ref["source_text"]
                    inbound_map[target_sheet].append(inbound_entry)

    # Write inbound refs to each page
    updated_count = 0
    for page in pages:
        page.inbound_references = inbound_map.get(page.sheet_number, [])
        updated_count += 1

    db.commit()
    logger.info(f"Computed inbound references for {updated_count} pages in project {project_id}")


def propagate_inbound_context(db: Session, project_id: str) -> None:
    """
    Copy context from source's outbound refs to target's inbound refs.
    Called after all Pass 2 completes.

    For each page's inbound_references, we look up the context that the source
    page assigned to that reference in its pass2_output, and copy it over.
    """
    # Get project files
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        logger.error(f"Project not found: {project_id}")
        return

    file_ids = [f.id for f in db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()]

    # Get all pages that have completed Pass 2
    pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status == "pass2_complete"
    ).all()

    if not pages:
        logger.info(f"No pass2_complete pages found for project {project_id}")
        return

    # Build lookup: (source_sheet, ref) -> context from pass2_output
    context_lookup = {}
    for page in pages:
        pass2 = page.pass2_output or {}
        for ref_ctx in pass2.get("outbound_refs_context", []):
            ref = ref_ctx.get("ref", "")
            context = ref_ctx.get("context", "")
            if ref and page.sheet_number:
                # Key is (source_sheet, target_ref)
                key = (page.sheet_number, ref)
                context_lookup[key] = context

    # Update inbound refs with context from source
    updated_count = 0
    for page in pages:
        inbound = page.inbound_references or []
        if not inbound:
            continue

        # Check if any updates are needed
        updated = False
        for ref in inbound:
            source_sheet = ref.get("source_sheet", "")
            original_ref = ref.get("original_ref", "")

            # Try to find context using the original ref
            key = (source_sheet, original_ref)
            if key in context_lookup:
                ref["context"] = context_lookup[key]
                updated = True
            elif "context" not in ref:
                # No context found, set empty string
                ref["context"] = ""

        if updated:
            page.inbound_references = inbound
            updated_count += 1

    db.commit()
    logger.info(f"Propagated context to inbound references for {updated_count} pages in project {project_id}")


# =============================================================================
# Gemini API Helper
# =============================================================================

def _configure_gemini() -> bool:
    """Configure the Gemini client. Returns True if successful."""
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY environment variable is not set")
        return False
    genai.configure(api_key=GEMINI_API_KEY)
    return True


async def _retry_with_backoff(func, *args, **kwargs):
    """
    Execute a function with exponential backoff retry logic.
    Handles rate limits and transient failures.
    """
    last_exception = None
    
    for attempt in range(MAX_RETRIES):
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: func(*args, **kwargs))
            return result
        except google_exceptions.ResourceExhausted as e:
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except google_exceptions.DeadlineExceeded as e:
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Timeout, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except google_exceptions.ServiceUnavailable as e:
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Service unavailable, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except Exception as e:
            logger.error(f"Non-retryable error: {e}")
            raise
    
    raise last_exception


async def _call_gemini_json(prompt: str) -> dict:
    """
    Call Gemini with JSON response mode and retry logic.
    
    Args:
        prompt: The full prompt to send to Gemini
        
    Returns:
        Parsed JSON response as a dictionary
        
    Raises:
        Exception if all retries fail or JSON parsing fails
    """
    if not _configure_gemini():
        raise RuntimeError("Gemini API key not configured")
    
    model = genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config={
            "temperature": 0.2,
            "top_p": 0.8,
            "top_k": 40,
            "response_mime_type": "application/json",
            "max_output_tokens": CONTEXT_TREE_MAX_TOKENS,
        }
    )
    
    def _generate():
        response = model.generate_content(prompt)
        return response.text
    
    result = await _retry_with_backoff(_generate)
    
    # Parse JSON response
    try:
        clean_result = _clean_json_response(result)
        return json.loads(clean_result)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini JSON response: {e}\nResponse: {result[:500]}")
        raise


def _clean_json_response(response: str) -> str:
    """
    Clean a Gemini response that might be wrapped in markdown code blocks.
    
    Handles formats like:
    - ```json\n{...}\n```
    - ```\n{...}\n```
    - Raw JSON
    """
    import re
    
    clean_result = response.strip()
    
    # Handle markdown code blocks with optional language specifier
    # Matches: ```json, ```JSON, ```, etc.
    if clean_result.startswith("```"):
        lines = clean_result.split("\n")
        # Remove first line (```json or ```)
        if lines[0].startswith("```"):
            lines = lines[1:]
        # Remove last line if it's closing ```
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        clean_result = "\n".join(lines)
    
    # Also handle single backticks wrapping (rare but possible)
    # `{...}` -> {...}
    if clean_result.startswith("`") and clean_result.endswith("`") and not clean_result.startswith("```"):
        clean_result = clean_result[1:-1]
    
    # Try to extract JSON if there's extra text before/after
    # Look for first { and last }
    if not clean_result.startswith("{") and not clean_result.startswith("["):
        first_brace = clean_result.find("{")
        first_bracket = clean_result.find("[")
        
        if first_brace >= 0 or first_bracket >= 0:
            # Find which comes first
            if first_brace >= 0 and (first_bracket < 0 or first_brace < first_bracket):
                last_brace = clean_result.rfind("}")
                if last_brace > first_brace:
                    clean_result = clean_result[first_brace:last_brace + 1]
            elif first_bracket >= 0:
                last_bracket = clean_result.rfind("]")
                if last_bracket > first_bracket:
                    clean_result = clean_result[first_bracket:last_bracket + 1]
    
    return clean_result.strip()


# =============================================================================
# Database Helpers
# =============================================================================

def _get_pdf_page_count(pdf_path: str) -> int:
    """Get the number of pages in a PDF using PyMuPDF."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except Exception as e:
        logger.error(f"Failed to get PDF page count for {pdf_path}: {e}")
        return 0


def ensure_page_contexts_exist(db: Session, project_id: str) -> int:
    """
    Ensure PageContext records exist ONLY for pages that have ContextPointers.
    
    This function only creates PageContext records for pages where users have
    added context pointers. Pages without pointers are NOT processed.
    
    Creates PageContext records with page_title and sheet_number extracted from
    the filename if they don't already exist.
    
    Returns:
        Number of new PageContext records created.
    """
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    # Build a map of file_id -> file for quick lookup
    file_map = {f.id: f for f in pdf_files}
    file_ids = list(file_map.keys())
    
    if not file_ids:
        return 0
    
    # Get all unique (file_id, page_number) combinations that have context pointers
    # This is the key change - only process pages WITH pointers
    pages_with_pointers = db.query(
        ContextPointer.file_id,
        ContextPointer.page_number
    ).filter(
        ContextPointer.file_id.in_(file_ids)
    ).distinct().all()
    
    if not pages_with_pointers:
        logger.info(f"No pages with context pointers found for project {project_id}")
        return 0
    
    created_count = 0
    
    for file_id, page_num in pages_with_pointers:
        pdf_file = file_map.get(file_id)
        if not pdf_file:
            continue
        
        # Check if PageContext already exists
        existing = db.query(PageContext).filter(
            PageContext.file_id == file_id,
            PageContext.page_number == page_num
        ).first()
        
        # Extract title and sheet number from filename
        page_title = extract_title_from_filename(pdf_file.name)
        sheet_number = extract_sheet_number_from_filename(pdf_file.name)
        
        if not existing:
            page_context = PageContext(
                file_id=file_id,
                page_number=page_num,
                page_title=page_title,
                sheet_number=sheet_number,
                processing_status="unprocessed"
            )
            db.add(page_context)
            created_count += 1
        else:
            # Update existing record if title/sheet_number not set
            if not existing.page_title:
                existing.page_title = page_title
            if not existing.sheet_number:
                existing.sheet_number = sheet_number
    
    if created_count > 0:
        db.commit()
        logger.info(f"Created {created_count} new PageContext records for pages with pointers in project {project_id}")
    
    return created_count


def ensure_discipline_contexts_exist(db: Session, project_id: str, discipline_codes: set[str]) -> None:
    """
    Create DisciplineContext records for all disciplines found during Pass 1.
    Skips disciplines that already exist.
    """
    for code in discipline_codes:
        existing = db.query(DisciplineContext).filter(
            DisciplineContext.project_id == project_id,
            DisciplineContext.code == code
        ).first()
        
        if not existing:
            discipline = DisciplineContext(
                project_id=project_id,
                code=code,
                name=get_discipline_name(code),
                processing_status="waiting"
            )
            db.add(discipline)
            logger.info(f"Created DisciplineContext for {code} ({get_discipline_name(code)})")
    
    db.commit()


def get_pages_for_processing(db: Session, project_id: str) -> list[PageContext]:
    """
    Get all PageContext records for a project that need processing.
    
    IMPORTANT: Only returns pages that have at least one ContextPointer.
    Pages without pointers are NOT processed.
    
    Returns pages that are 'unprocessed', have failed, or are stuck in 'pass1_processing'
    from a previous interrupted run.
    """
    # Get all PDF files in the project
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    file_ids = [f.id for f in pdf_files]
    
    if not file_ids:
        return []
    
    # Get unique (file_id, page_number) pairs that have context pointers
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
    
    # Get pages that need Pass 1 (unprocessed, error, or stuck in pass1_processing)
    # Include pass1_processing to retry pages stuck from previous interrupted runs
    all_pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status.in_(["unprocessed", "error", "pass1_processing"])
    ).order_by(PageContext.file_id, PageContext.page_number).all()
    
    # Filter to only pages that have pointers
    pages = [p for p in all_pages if (p.file_id, p.page_number) in pointer_pages]
    
    return pages


def get_pages_for_pass2(db: Session, project_id: str) -> list[PageContext]:
    """
    Get all PageContext records that have completed Pass 1 and need Pass 2.
    
    IMPORTANT: Only returns pages that have at least one ContextPointer.
    Pages without pointers are NOT processed.
    
    Also includes pages stuck in 'pass2_processing' from a previous interrupted run.
    """
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    
    file_ids = [f.id for f in pdf_files]
    
    if not file_ids:
        return []
    
    # Get unique (file_id, page_number) pairs that have context pointers
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
    
    # Include pass2_processing to retry pages stuck from previous interrupted runs
    all_pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status.in_(["pass1_complete", "pass2_processing"])
    ).order_by(PageContext.file_id, PageContext.page_number).all()
    
    # Filter to only pages that have pointers
    pages = [p for p in all_pages if (p.file_id, p.page_number) in pointer_pages]
    
    return pages


def get_all_page_identifiers(db: Session, project_id: str) -> list[dict]:
    """
    Get all page identifiers for Pass 2 cross-referencing.

    IMPORTANT: Only returns pages that have at least one ContextPointer.

    Returns list of {page_id, sheet_number, discipline, identifiers}.

    DEPRECATED: Use get_all_page_summaries for new Pass 2 implementation.
    """
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()

    file_ids = [f.id for f in pdf_files]

    if not file_ids:
        return []

    # Get unique (file_id, page_number) pairs that have context pointers
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

    all_pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status.in_(["pass1_complete", "pass2_processing", "pass2_complete"])
    ).all()

    # Filter to only pages that have pointers
    pages = [p for p in all_pages if (p.file_id, p.page_number) in pointer_pages]

    return [
        {
            "page_id": p.id,
            "sheet_number": p.sheet_number or f"Page {p.page_number}",
            "discipline": p.discipline_code or "G",
            "identifiers": p.identifiers or []
        }
        for p in pages
    ]


def get_all_page_summaries(db: Session, project_id: str) -> list[dict]:
    """
    Get all page summaries for Pass 2 context addition.

    IMPORTANT: Only returns pages that have completed Pass 1.

    Returns list of {page_id, sheet_number, summary}.
    """
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()

    file_ids = [f.id for f in pdf_files]

    if not file_ids:
        return []

    # Get all pages that have completed Pass 1
    all_pages = db.query(PageContext).filter(
        PageContext.file_id.in_(file_ids),
        PageContext.processing_status.in_(["pass1_complete", "pass2_processing", "pass2_complete"])
    ).all()

    return [
        {
            "page_id": p.id,
            "sheet_number": p.sheet_number or f"Page {p.page_number}",
            "summary": p.context_description or (p.pass1_output or {}).get("summary", "")
        }
        for p in all_pages
    ]


def get_pdf_file_ids(db: Session, project_id: str) -> list[str]:
    """Get all PDF file IDs for a project."""
    pdf_files = db.query(ProjectFile).filter(
        ProjectFile.project_id == project_id,
        ProjectFile.is_folder == False,
        ProjectFile.name.ilike("%.pdf")
    ).all()
    return [f.id for f in pdf_files]


def get_total_page_count(db: Session, project_id: str) -> int:
    """Get total count of ALL pages for a project (regardless of processing status)."""
    file_ids = get_pdf_file_ids(db, project_id)
    if not file_ids:
        return 0
    return db.query(PageContext).filter(PageContext.file_id.in_(file_ids)).count()


# =============================================================================
# Pass 1: Page Analysis Prompt
# =============================================================================

def build_pass1_prompt(sheet_number: str, page_title: str, pointers: list[ContextPointer]) -> str:
    """Build the Pass 1 prompt for page analysis.

    Args:
        sheet_number: Sheet number for this page
        page_title: Title of this page
        pointers: List of ContextPointer objects on this page
    """

    pointers_text = ""
    has_text_elements = False

    for p in pointers:
        # Build text elements section for this pointer
        text_elements_lines = []
        if p.text_content and isinstance(p.text_content, dict):
            elements = p.text_content.get("text_elements", [])
            for el in elements:
                el_id = el.get("id", "")
                el_text = el.get("text", "")
                if el_id and el_text:
                    text_elements_lines.append(f'  [{el_id}]: "{el_text}"')
                    has_text_elements = True

        text_elements_section = "\n".join(text_elements_lines) if text_elements_lines else "(no text elements)"

        pointers_text += f"""---
Pointer ID: {p.id}
Title: {p.title}
Description: {p.description or ''}
Technical Description: {p.ai_technical_description or ''}
Trade Category: {p.ai_trade_category or ''}
Elements: {json.dumps(p.ai_elements) if p.ai_elements else '[]'}
Text Elements:
{text_elements_section}
---
"""

    if not pointers_text:
        pointers_text = "(No context pointers on this page)"

    # Build outbound_refs instruction based on whether text elements are available
    if has_text_elements:
        outbound_refs_instruction = """   - "outbound_refs": Array of references TO other sheets found in this pointer region:
     - "ref": The target sheet/detail reference (e.g., "AS2.1", "A-501", "3/A-401")
     - "type": One of: detail, sheet, section, elevation, schedule
     - "source_element_id": ID of the text element containing this reference (from Text Elements above)
     - "source_text": The full text of that element
     Detail callouts like "3/A-501" mean detail 3 on sheet A-501.
     Only include explicit references, not inferred connections.
     Match each reference to the text element that contains it."""

        outbound_refs_example = """{{"ref": "AS2.1", "type": "detail", "source_element_id": "abc123_t5", "source_text": "SEE DETAIL AS2.1 FOR FLASHING"}},
        {{"ref": "A-501", "type": "sheet", "source_element_id": "abc123_t8", "source_text": "REFER TO SHEET A-501"}}"""
    else:
        outbound_refs_instruction = """   - "outbound_refs": Array of references TO other sheets found in this pointer region:
     - "ref": The target sheet/detail reference (e.g., "AS2.1", "A-501", "3/A-401")
     - "type": One of: detail, sheet, section, elevation, schedule
     Detail callouts like "3/A-501" mean detail 3 on sheet A-501.
     Only include explicit references, not inferred connections."""

        outbound_refs_example = """{{"ref": "AS2.1", "type": "detail"}},
        {{"ref": "A-501", "type": "sheet"}}"""

    return f"""You are analyzing a construction plan page to generate a context summary.

PAGE INFO:
- Sheet Number: {sheet_number}
- Page Title: {page_title}

POINTERS ON THIS PAGE:
{pointers_text}
{spans_section}TASK:
Analyze this page and return a JSON response with:

1. "discipline" - The primary discipline this page belongs to. Use standard codes:
   - A (Architectural)
   - S (Structural)
   - M (Mechanical)
   - E (Electrical)
   - P (Plumbing)
   - FP (Fire Protection)
   - C (Civil)
   - L (Landscape)
   - G (General)
   - If unclear, infer from content not sheet number

2. "sheet_number" - The actual sheet number if identifiable on the page:
   - Look for title block sheet designations (e.g., "A401", "M3.2", "AS2.1")
   - Extract from page header/footer if present
   - Return null if not clearly identifiable

3. "summary" - A dense 2-3 sentence description of what this page contains. Focus on:
   - What information a superintendent would find here
   - Specific specs, assembly types, equipment, or details present
   - Be concrete (include spec numbers, wall types, equipment tags when present)

4. "pointers" - For EACH pointer listed above, provide analysis:
   - "pointer_id": Copy the Pointer ID exactly from the input
   - "summary": One sentence describing what this pointer region contains
{outbound_refs_instruction}

RESPOND WITH JSON ONLY:
{{
  "discipline": "A",
  "sheet_number": "A-101",
  "summary": "2-3 sentence page summary...",
  "pointers": [
    {{
      "pointer_id": "uuid-from-input",
      "summary": "One sentence about this pointer region...",
      "outbound_refs": [
        {outbound_refs_example}
      ]
    }}
  ]
}}"""


# =============================================================================
# Pass 2: Cross-Reference Context Prompt
# =============================================================================

def build_pass2_prompt(
    sheet_number: str,
    page_title: str,
    pass1_output: dict,
    other_pages_summaries: list[dict]
) -> str:
    """
    Build the Pass 2 prompt for adding context to outbound references.

    Pass 2 has ONE job: add context to the outbound_refs identified in Pass 1.
    It uses the target pages' summaries to understand what each reference points to.
    """

    # This page's summary from Pass 1
    page_summary = pass1_output.get("summary", "")

    # Build list of outbound refs from Pass 1 pointers
    outbound_refs_text = ""
    all_refs = []
    for pointer in pass1_output.get("pointers", []):
        for ref in pointer.get("outbound_refs", []):
            ref_str = ref.get("ref", "")
            ref_type = ref.get("type", "")
            all_refs.append({"ref": ref_str, "type": ref_type})
            outbound_refs_text += f"  - {ref_str} ({ref_type})\n"

    if not outbound_refs_text:
        outbound_refs_text = "  (No outbound references found)\n"

    # Build lookup of target pages
    target_pages_text = ""
    for page in other_pages_summaries:
        target_pages_text += f"""---
Sheet: {page['sheet_number']}
Summary: {page['summary']}
---
"""

    if not target_pages_text:
        target_pages_text = "(No target page summaries available)"

    return f"""You are adding context to cross-references on a construction plan page.

THIS PAGE:
- Sheet Number: {sheet_number}
- Page Title: {page_title}
- Summary: {page_summary}

OUTBOUND REFERENCES FROM THIS PAGE:
{outbound_refs_text}

TARGET PAGES (where references point):
{target_pages_text}

TASK:
For each outbound reference listed above, add a "context" field that explains what the
reference points to. Use the target page summaries to understand what each sheet contains.

The context should help a superintendent understand what they'll find if they follow the reference.
Be specific about what the target sheet contains that's relevant to this page.

RESPOND WITH JSON ONLY:
{{
  "outbound_refs_context": [
    {{"ref": "AS2.1", "context": "Canopy head detail showing flashing and drainage connections"}},
    {{"ref": "A-501", "context": "Exterior elevation with storefront assembly details"}}
  ]
}}

Include ALL outbound references from the list above, with context for each."""


# =============================================================================
# Pass 3: Discipline Rollup Prompt
# =============================================================================

def build_pass3_prompt(discipline_name: str, discipline_code: str, pages: list[dict]) -> str:
    """Build the Pass 3 prompt for discipline-level rollup."""
    
    pages_text = ""
    for page in pages:
        cross_refs_text = ""
        for cr in page.get('cross_refs', []):
            cross_refs_text += f"{cr.get('target_sheet', '')} ({cr.get('relationship', '')}), "
        
        pages_text += f"""---
Sheet: {page['sheet_number']}
Title: {page['page_title']}
Context: {page['updated_context']}
Cross-refs: {cross_refs_text or 'None'}
---
"""
    
    if not pages_text:
        pages_text = "(No pages in this discipline)"
    
    return f"""You are creating a discipline-level summary for a construction project.

DISCIPLINE: {discipline_name} ({discipline_code})

ALL PAGES IN THIS DISCIPLINE:
{pages_text}

TASK:
Create a comprehensive discipline context that helps an AI agent decide whether to search this discipline for a superintendent's question. Return JSON with:

1. "context" - A dense paragraph describing:
   - What types of information live in this discipline
   - Key specs, assemblies, equipment, and systems covered
   - Notable details or schedules a super would look for here

2. "key_contents" - Array of the most important searchable items across all pages:
   - Specs, assemblies, equipment tags, schedules, details
   - Include which sheet each lives on

3. "connections" - Array of dependencies on other disciplines:
   - What this discipline needs from others
   - What other disciplines need from this one

RESPOND WITH JSON ONLY:
{{
  "context": "...",
  "key_contents": [
    {{"item": "...", "type": "...", "sheet": "..."}},
    ...
  ],
  "connections": [
    {{"discipline": "...", "relationship": "..."}},
    ...
  ]
}}"""


# =============================================================================
# PageProcessor Class
# =============================================================================

class PageProcessor:
    """
    Processes pages through Pass 1 (analysis) and Pass 2 (cross-references).
    
    Pass 1 runs in parallel with concurrency limit.
    Pass 2 runs sequentially after all Pass 1 completes.
    """
    
    def __init__(
        self,
        concurrency_limit: int = 5,
        progress_callback: Optional[Callable[[str, dict], None]] = None,
        discipline_processor: Optional['DisciplineProcessor'] = None
    ):
        self.concurrency_limit = concurrency_limit
        self.progress_callback = progress_callback
        self.discipline_processor = discipline_processor
        self._semaphore: Optional[asyncio.Semaphore] = None
    
    def _emit_progress(self, event_type: str, data: dict) -> None:
        """Emit progress event if callback is registered."""
        if self.progress_callback:
            try:
                self.progress_callback(event_type, data)
            except Exception as e:
                logger.error(f"Progress callback error: {e}")
    
    async def start_processing(self, project_id: str) -> dict:
        """
        Main entry point for page processing.
        
        Runs Pass 1 on all unprocessed pages, then Pass 2 on all Pass 1 complete pages.
        
        Returns:
            dict with processing summary
        """
        logger.info(f"Starting context tree processing for project {project_id}")
        
        db = SessionLocal()
        try:
            # Ensure PageContext records exist for all PDF pages
            # This creates records with page_title and sheet_number from filename
            created = ensure_page_contexts_exist(db, project_id)
            if created > 0:
                logger.info(f"Created {created} new PageContext records")
            
            # Get pages needing Pass 1
            pass1_pages = get_pages_for_processing(db, project_id)
            total_pass1 = len(pass1_pages)
            
            logger.info(f"Found {total_pass1} pages needing Pass 1 processing")
            
            self._emit_progress("processing_started", {
                "project_id": project_id,
                "pass1_total": total_pass1
            })
            
        finally:
            db.close()
        
        # Run Pass 1
        pass1_results = {"completed": 0, "errors": 0}
        if total_pass1 > 0:
            pass1_results = await self.run_pass1(project_id)

        # After Pass 1 completes, compute inbound references by inverting outbound refs
        db = SessionLocal()
        try:
            compute_inbound_references(db, project_id)
        finally:
            db.close()

        # Get pages needing Pass 2
        db = SessionLocal()
        try:
            pass2_pages = get_pages_for_pass2(db, project_id)
            total_pass2 = len(pass2_pages)
            logger.info(f"Found {total_pass2} pages needing Pass 2 processing")
        finally:
            db.close()
        
        # Run Pass 2
        pass2_results = {"completed": 0, "errors": 0}
        if total_pass2 > 0:
            pass2_results = await self.run_pass2(project_id)

        # After Pass 2 completes, propagate context to inbound references
        db = SessionLocal()
        try:
            propagate_inbound_context(db, project_id)
        finally:
            db.close()

        # Sweep for orphaned pages and retry if under limit
        # This handles pages that failed in Pass 1 and never made it to Pass 2
        sweep_result = await self._sweep_and_retry_orphans(project_id)
        
        while sweep_result["retried"] > 0:
            logger.info(f"Retrying {sweep_result['retried']} orphaned pages")
            
            # Re-run Pass 1 on retried pages
            pass1_retry = await self.run_pass1(project_id)
            pass1_results["completed"] += pass1_retry["completed"]
            pass1_results["errors"] += pass1_retry["errors"]
            
            # Re-run Pass 2 on newly completed pages
            pass2_retry = await self.run_pass2(project_id)
            pass2_results["completed"] += pass2_retry["completed"]
            pass2_results["errors"] += pass2_retry["errors"]
            
            # Check for any remaining orphans
            sweep_result = await self._sweep_and_retry_orphans(project_id)
        
        summary = {
            "pass1_completed": pass1_results["completed"],
            "pass1_errors": pass1_results["errors"],
            "pass2_completed": pass2_results["completed"],
            "pass2_errors": pass2_results["errors"],
            "permanently_failed": sweep_result["failed"],
        }
        
        self._emit_progress("processing_complete", summary)
        logger.info(f"Context tree processing complete: {summary}")
        
        return summary
    
    async def run_pass1(self, project_id: str) -> dict:
        """
        Run Pass 1 on all unprocessed pages in parallel with concurrency limit.
        """
        self._semaphore = asyncio.Semaphore(self.concurrency_limit)
        
        db = SessionLocal()
        try:
            pages = get_pages_for_processing(db, project_id)
            page_ids = [p.id for p in pages]
            # Build lookup for sheet numbers to include in progress events
            page_info = {p.id: {"sheet_number": p.sheet_number, "discipline": p.discipline_code} for p in pages}
            total = len(page_ids)
        finally:
            db.close()
        
        if total == 0:
            return {"completed": 0, "errors": 0}
        
        completed = 0
        errors = 0
        discovered_disciplines: set[str] = set()
        
        async def process_with_semaphore(page_id: str, index: int):
            nonlocal completed, errors, discovered_disciplines
            async with self._semaphore:
                try:
                    discipline = await self.process_pass1(page_id)
                    if discipline:
                        discovered_disciplines.add(discipline)
                    completed += 1
                    # Emit event with frontend-expected format
                    self._emit_progress("page_pass1_complete", {
                        "pageId": page_id,
                        "sheetNumber": page_info.get(page_id, {}).get("sheet_number"),
                        "discipline": discipline,
                        "pass1Progress": completed,
                        "pass1Total": total
                    })
                except Exception as e:
                    errors += 1
                    logger.error(f"Pass 1 error for page {page_id}: {e}")
                    self._emit_progress("error", {
                        "pageId": page_id,
                        "pass": 1,
                        "error": str(e)
                    })
        
        # Process all pages concurrently
        tasks = [
            process_with_semaphore(page_id, i)
            for i, page_id in enumerate(page_ids)
        ]
        await asyncio.gather(*tasks)
        
        # Create DisciplineContext records for discovered disciplines
        if discovered_disciplines:
            db = SessionLocal()
            try:
                ensure_discipline_contexts_exist(db, project_id, discovered_disciplines)
            finally:
                db.close()
        
        self._emit_progress("pass1_complete", {
            "completed": completed,
            "errors": errors,
            "disciplines": list(discovered_disciplines)
        })
        
        return {"completed": completed, "errors": errors}
    
    async def process_pass1(self, page_id: str) -> Optional[str]:
        """
        Process a single page through Pass 1.
        
        Returns:
            The discipline code if successful, None if failed
        """
        db = SessionLocal()
        try:
            page = db.query(PageContext).filter(PageContext.id == page_id).first()
            if not page:
                logger.error(f"Page not found: {page_id}")
                return None
            
            # Update status to processing
            page.processing_status = "pass1_processing"
            db.commit()
            
            # Get file info for sheet number
            file = db.query(ProjectFile).filter(ProjectFile.id == page.file_id).first()
            sheet_number = page.sheet_number or f"Page {page.page_number}"
            page_title = page.page_title or file.name if file else "Unknown"
            
            # Get pointers on this page (with text_content for element matching)
            pointers = db.query(ContextPointer).filter(
                ContextPointer.file_id == page.file_id,
                ContextPointer.page_number == page.page_number
            ).all()

            # Build and send prompt (uses pointer text_content.text_elements for ref matching)
            prompt = build_pass1_prompt(sheet_number, page_title, pointers)
            
            try:
                result = await _call_gemini_json(prompt)
            except Exception as e:
                page.processing_status = "error"
                page.error_message = f"Pass 1 Gemini error: {str(e)}"
                db.commit()
                raise
            
            # Extract results
            discipline = result.get("discipline", "G")
            summary = result.get("summary", "")
            pointers_output = result.get("pointers", [])
            sheet_number_extracted = result.get("sheet_number")

            # Validate discipline code
            if discipline not in DISCIPLINE_CODES:
                discipline = "G"

            # Build legacy identifiers for backwards compatibility
            # Flatten outbound_refs from all pointers into identifiers format
            legacy_identifiers = []
            for ptr in pointers_output:
                for ref in ptr.get("outbound_refs", []):
                    legacy_identifiers.append({
                        "ref": ref.get("ref", ""),
                        "type": ref.get("type", "detail"),
                        "content": ptr.get("summary", "")
                    })

            # Update page
            page.discipline_code = discipline
            page.context_description = summary
            page.identifiers = legacy_identifiers  # Backwards compat
            page.pass1_output = result  # NEW: Store full structured output
            if sheet_number_extracted:
                page.sheet_number = sheet_number_extracted
            elif file:
                # Fallback: try to extract sheet number from filename pattern
                # Matches patterns like "A002", "M3.2", "AS2.1" at start of filename
                match = re.match(r'^([A-Z]{1,2}\d{2,3}(?:\.\d+)?)', file.name)
                if match:
                    page.sheet_number = match.group(1)
            page.processing_status = "pass1_complete"
            page.error_message = None
            page.updated_at = datetime.utcnow()
            
            db.commit()
            
            logger.info(f"Pass 1 complete for page {page_id}: discipline={discipline}")
            return discipline
            
        except Exception as e:
            logger.error(f"Pass 1 failed for page {page_id}: {e}")
            # Try to mark as error
            try:
                page = db.query(PageContext).filter(PageContext.id == page_id).first()
                if page:
                    page.processing_status = "error"
                    page.error_message = str(e)
                    db.commit()
            except Exception as recovery_error:
                logger.error(f"Failed to mark page {page_id} as error: {recovery_error}")
            raise
        finally:
            db.close()
    
    async def run_pass2(self, project_id: str) -> dict:
        """
        Run Pass 2 on all Pass 1 complete pages sequentially.
        """
        db = SessionLocal()
        try:
            pages = get_pages_for_pass2(db, project_id)
            page_ids = [p.id for p in pages]
            # Build lookup for sheet numbers to include in progress events
            page_sheet_numbers = {p.id: p.sheet_number for p in pages}
            ready_count = len(page_ids)
            # Get total page count for accurate progress display (includes orphaned pages)
            total_pages = get_total_page_count(db, project_id)
        finally:
            db.close()
        
        if ready_count == 0:
            return {"completed": 0, "errors": 0}

        # Get all page summaries for context addition
        db = SessionLocal()
        try:
            all_page_summaries = get_all_page_summaries(db, project_id)
        finally:
            db.close()

        completed = 0
        errors = 0

        for i, page_id in enumerate(page_ids):
            try:
                await self.process_pass2(page_id, all_page_summaries, project_id)
                completed += 1
                # Emit event with frontend-expected format
                # Use total_pages (all pages) not ready_count (only pass1_complete pages)
                self._emit_progress("page_pass2_complete", {
                    "pageId": page_id,
                    "sheetNumber": page_sheet_numbers.get(page_id),
                    "pass2Progress": completed,
                    "pass2Total": total_pages
                })
            except Exception as e:
                errors += 1
                logger.error(f"Pass 2 error for page {page_id}: {e}")
                self._emit_progress("error", {
                    "pageId": page_id,
                    "pass": 2,
                    "error": str(e)
                })
        
        self._emit_progress("pass2_complete", {
            "completed": completed,
            "errors": errors
        })
        
        return {"completed": completed, "errors": errors}
    
    async def _sweep_and_retry_orphans(
        self, 
        project_id: str,
        max_retries: int = 3
    ) -> dict:
        """
        Find pages that didn't complete Pass 2 and retry if under retry limit.
        
        Returns dict with:
        - retried: count of pages reset for retry
        - failed: list of permanently failed page info
        """
        db = SessionLocal()
        try:
            file_ids = get_pdf_file_ids(db, project_id)
            if not file_ids:
                return {"retried": 0, "failed": []}
            
            # Find orphaned pages (not pass2_complete)
            orphans = db.query(PageContext).filter(
                PageContext.file_id.in_(file_ids),
                PageContext.processing_status.in_(["unprocessed", "error", "pass1_processing"])
            ).all()
            
            if not orphans:
                return {"retried": 0, "failed": []}
            
            retryable = [p for p in orphans if p.retry_count < max_retries]
            permanently_failed = [p for p in orphans if p.retry_count >= max_retries]
            
            # Log and emit for permanently failed
            if permanently_failed:
                failed_info = [
                    {"pageId": p.id, "sheetNumber": p.sheet_number or f"Page {p.page_number}"} 
                    for p in permanently_failed
                ]
                logger.warning(f"Pages exceeded retry limit ({max_retries}): {failed_info}")
                self._emit_progress("pass2_orphans_detected", {
                    "orphans": failed_info,
                    "message": f"{len(permanently_failed)} pages failed after {max_retries} attempts"
                })
            
            # Reset retryable pages and increment retry_count
            retried_info = []
            for page in retryable:
                retried_info.append({
                    "pageId": page.id, 
                    "sheetNumber": page.sheet_number or f"Page {page.page_number}",
                    "retryCount": page.retry_count + 1
                })
                page.processing_status = "unprocessed"
                page.retry_count += 1
                page.error_message = None
            
            if retryable:
                db.commit()
                logger.info(f"Reset {len(retryable)} orphaned pages for retry: {retried_info}")
            
            return {
                "retried": len(retryable), 
                "failed": [
                    {"pageId": p.id, "sheetNumber": p.sheet_number or f"Page {p.page_number}"} 
                    for p in permanently_failed
                ]
            }
        finally:
            db.close()
    
    async def process_pass2(
        self,
        page_id: str,
        all_page_summaries: list[dict],
        project_id: str
    ) -> bool:
        """
        Process a single page through Pass 2.

        Pass 2 adds context to outbound references identified in Pass 1.

        Returns:
            True if successful, False otherwise
        """
        db = SessionLocal()
        try:
            page = db.query(PageContext).filter(PageContext.id == page_id).first()
            if not page:
                logger.error(f"Page not found: {page_id}")
                return False

            # Update status
            page.processing_status = "pass2_processing"
            db.commit()

            # Get file info
            file = db.query(ProjectFile).filter(ProjectFile.id == page.file_id).first()
            sheet_number = page.sheet_number or f"Page {page.page_number}"
            page_title = page.page_title or file.name if file else "Unknown"

            # Get pass1_output for this page
            pass1_output = page.pass1_output or {}

            # Filter out this page from summaries list
            other_pages_summaries = [p for p in all_page_summaries if p["page_id"] != page_id]

            # Build prompt with new signature
            prompt = build_pass2_prompt(
                sheet_number=sheet_number,
                page_title=page_title,
                pass1_output=pass1_output,
                other_pages_summaries=other_pages_summaries
            )

            try:
                result = await _call_gemini_json(prompt)
            except Exception as e:
                page.processing_status = "error"
                page.error_message = f"Pass 2 Gemini error: {str(e)}"
                db.commit()
                raise

            # Extract results
            outbound_refs_context = result.get("outbound_refs_context", [])

            # Store the full Pass 2 output
            page.pass2_output = result

            # Build legacy cross_refs for backwards compatibility
            # Convert outbound_refs_context to cross_refs format
            legacy_cross_refs = []
            for ref_ctx in outbound_refs_context:
                legacy_cross_refs.append({
                    "target_sheet": ref_ctx.get("ref", ""),
                    "relationship": ref_ctx.get("context", "")
                })

            # Build legacy updated_context for backwards compatibility
            # Append context info to the base context_description
            context_additions = []
            for ref_ctx in outbound_refs_context:
                ref = ref_ctx.get("ref", "")
                ctx = ref_ctx.get("context", "")
                if ref and ctx:
                    context_additions.append(f"Reference to {ref}: {ctx}")

            updated_context = page.context_description or ""
            if context_additions:
                updated_context += " Cross-references: " + "; ".join(context_additions)

            # Update page with both new and legacy fields
            page.cross_refs = legacy_cross_refs  # Backwards compat
            page.updated_context = updated_context  # Backwards compat
            page.processing_status = "pass2_complete"
            page.error_message = None
            page.updated_at = datetime.utcnow()

            db.commit()

            # Check if this completes a discipline
            discipline_code = page.discipline_code
            if discipline_code:
                self.check_discipline_ready(db, discipline_code, project_id)

            logger.info(f"Pass 2 complete for page {page_id}")
            return True

        except Exception as e:
            logger.error(f"Pass 2 failed for page {page_id}: {e}")
            try:
                page = db.query(PageContext).filter(PageContext.id == page_id).first()
                if page:
                    page.processing_status = "error"
                    page.error_message = str(e)
                    db.commit()
            except Exception as recovery_error:
                logger.error(f"Failed to mark page {page_id} as error: {recovery_error}")
            raise
        finally:
            db.close()
    
    def check_discipline_ready(self, db: Session, discipline_code: str, project_id: str) -> bool:
        """
        Check if all pages for a discipline are Pass 2 complete.
        If so, update discipline status to 'ready' and trigger Pass 3.
        """
        # Get all PDF files
        pdf_files = db.query(ProjectFile).filter(
            ProjectFile.project_id == project_id,
            ProjectFile.is_folder == False,
            ProjectFile.name.ilike("%.pdf")
        ).all()
        file_ids = [f.id for f in pdf_files]
        
        # Count pages in this discipline
        total_pages = db.query(PageContext).filter(
            PageContext.file_id.in_(file_ids),
            PageContext.discipline_code == discipline_code
        ).count()
        
        complete_pages = db.query(PageContext).filter(
            PageContext.file_id.in_(file_ids),
            PageContext.discipline_code == discipline_code,
            PageContext.processing_status == "pass2_complete"
        ).count()
        
        if total_pages > 0 and total_pages == complete_pages:
            # All pages complete - update discipline to ready
            discipline = db.query(DisciplineContext).filter(
                DisciplineContext.project_id == project_id,
                DisciplineContext.code == discipline_code
            ).first()
            
            if discipline and discipline.processing_status == "waiting":
                discipline.processing_status = "ready"
                db.commit()
                
                logger.info(f"Discipline {discipline_code} is ready for Pass 3")
                
                self._emit_progress("discipline_ready", {
                    "discipline_code": discipline_code,
                    "discipline_name": get_discipline_name(discipline_code)
                })
                
                # Trigger discipline processor if available
                if self.discipline_processor:
                    self.discipline_processor.on_discipline_ready(discipline_code, project_id)
                
                return True
        
        return False


# =============================================================================
# DisciplineProcessor Class
# =============================================================================

class DisciplineProcessor:
    """
    Processes disciplines through Pass 3 (rollup).
    
    Maintains a queue of ready disciplines and processes them sequentially.
    Note: Pass 3 is triggered AFTER all Pass 2 completes, not during.
    """
    
    def __init__(self, progress_callback: Optional[Callable[[str, dict], None]] = None):
        self.ready_disciplines: list[tuple[str, str]] = []  # (discipline_code, project_id)
        self.progress_callback = progress_callback
    
    def _emit_progress(self, event_type: str, data: dict) -> None:
        """Emit progress event if callback is registered."""
        if self.progress_callback:
            try:
                self.progress_callback(event_type, data)
            except Exception as e:
                logger.error(f"Progress callback error: {e}")
    
    def on_discipline_ready(self, discipline_code: str, project_id: str) -> None:
        """
        Called when a discipline becomes ready for Pass 3.
        Queues the discipline for later processing (after all Pass 2 completes).
        
        Note: We don't start processing immediately to avoid race conditions.
        Call process_all_ready() after page processing completes.
        """
        # Avoid duplicates
        if (discipline_code, project_id) not in self.ready_disciplines:
            self.ready_disciplines.append((discipline_code, project_id))
            logger.info(f"Discipline {discipline_code} queued for Pass 3")
    
    async def process_queue(self) -> dict:
        """
        Process all disciplines in the ready queue.
        Called after Pass 2 completes to avoid race conditions.
        """
        completed = 0
        errors = 0
        
        while self.ready_disciplines:
            discipline_code, project_id = self.ready_disciplines.pop(0)
            
            try:
                success = await self.run_pass3(discipline_code, project_id)
                if success:
                    completed += 1
                else:
                    errors += 1
            except Exception as e:
                errors += 1
                logger.error(f"Pass 3 error for discipline {discipline_code}: {e}")
                self._emit_progress("error", {
                    "discipline_code": discipline_code,
                    "pass": 3,
                    "error": str(e)
                })
        
        return {"completed": completed, "errors": errors}
    
    async def run_pass3(self, discipline_code: str, project_id: str) -> bool:
        """
        Run Pass 3 for a discipline - aggregate page contexts into discipline summary.
        """
        db = SessionLocal()
        try:
            # Update discipline status
            discipline = db.query(DisciplineContext).filter(
                DisciplineContext.project_id == project_id,
                DisciplineContext.code == discipline_code
            ).first()
            
            if not discipline:
                logger.error(f"Discipline not found: {discipline_code}")
                return False
            
            discipline.processing_status = "processing"
            db.commit()
            
            # Get all PDF files
            pdf_files = db.query(ProjectFile).filter(
                ProjectFile.project_id == project_id,
                ProjectFile.is_folder == False,
                ProjectFile.name.ilike("%.pdf")
            ).all()
            file_ids = [f.id for f in pdf_files]
            
            # Get all pages in this discipline
            pages = db.query(PageContext).filter(
                PageContext.file_id.in_(file_ids),
                PageContext.discipline_code == discipline_code,
                PageContext.processing_status == "pass2_complete"
            ).all()
            
            # Build page data for prompt
            pages_data = []
            for p in pages:
                file = db.query(ProjectFile).filter(ProjectFile.id == p.file_id).first()
                pages_data.append({
                    "sheet_number": p.sheet_number or f"Page {p.page_number}",
                    "page_title": p.page_title or (file.name if file else "Unknown"),
                    "updated_context": p.updated_context or p.context_description or "",
                    "cross_refs": p.cross_refs or []
                })
            
            # Build prompt
            prompt = build_pass3_prompt(
                discipline_name=discipline.name,
                discipline_code=discipline_code,
                pages=pages_data
            )
            
            try:
                result = await _call_gemini_json(prompt)
            except Exception as e:
                discipline.processing_status = "error"
                db.commit()
                raise
            
            # Extract results
            context = result.get("context", "")
            key_contents = result.get("key_contents", [])
            connections = result.get("connections", [])
            
            # Update discipline
            discipline.context_description = context
            discipline.key_contents = key_contents
            discipline.connections = connections
            discipline.processing_status = "complete"
            discipline.updated_at = datetime.utcnow()
            
            # Link pages to discipline
            for p in pages:
                p.discipline_id = discipline.id
            
            db.commit()
            
            logger.info(f"Pass 3 complete for discipline {discipline_code}")
            
            self._emit_progress("discipline_complete", {
                "discipline_code": discipline_code,
                "discipline_name": discipline.name,
                "page_count": len(pages),
                "key_contents_count": len(key_contents)
            })
            
            return True
            
        except Exception as e:
            logger.error(f"Pass 3 failed for discipline {discipline_code}: {e}")
            try:
                db2 = SessionLocal()
                discipline = db2.query(DisciplineContext).filter(
                    DisciplineContext.project_id == project_id,
                    DisciplineContext.code == discipline_code
                ).first()
                if discipline:
                    discipline.processing_status = "error"
                    db2.commit()
                db2.close()
            except Exception as recovery_error:
                logger.error(f"Failed to mark discipline {discipline_code} as error: {recovery_error}")
            return False
        finally:
            db.close()
    
    async def process_all_ready(self, project_id: str) -> dict:
        """
        Process all disciplines that are in 'ready' status.
        
        First processes any disciplines queued during Pass 2, then
        queries the database for any additional 'ready' disciplines.
        """
        # First process the internal queue (from on_discipline_ready calls)
        queue_results = await self.process_queue()
        
        # Then check database for any 'ready' disciplines we might have missed
        db = SessionLocal()
        try:
            ready_disciplines = db.query(DisciplineContext).filter(
                DisciplineContext.project_id == project_id,
                DisciplineContext.processing_status == "ready"
            ).all()
            
            discipline_codes = [d.code for d in ready_disciplines]
        finally:
            db.close()
        
        db_completed = 0
        db_errors = 0
        
        for code in discipline_codes:
            try:
                success = await self.run_pass3(code, project_id)
                if success:
                    db_completed += 1
                else:
                    db_errors += 1
            except Exception as e:
                db_errors += 1
                logger.error(f"Pass 3 error for {code}: {e}")
        
        return {
            "completed": queue_results["completed"] + db_completed,
            "errors": queue_results["errors"] + db_errors
        }


# =============================================================================
# Convenience Function
# =============================================================================

async def process_project_context_tree(
    project_id: str,
    concurrency_limit: int = 5,
    progress_callback: Optional[Callable[[str, dict], None]] = None
) -> dict:
    """
    Convenience function to run the full context tree processing pipeline.
    
    Args:
        project_id: The project to process
        concurrency_limit: Max concurrent Gemini calls for Pass 1
        progress_callback: Optional callback for progress events
        
    Returns:
        Summary dict with pass1/pass2/pass3 completion counts
    """
    discipline_processor = DisciplineProcessor(progress_callback=progress_callback)
    
    page_processor = PageProcessor(
        concurrency_limit=concurrency_limit,
        progress_callback=progress_callback,
        discipline_processor=discipline_processor
    )
    
    # Run page processing (Pass 1 and Pass 2)
    page_results = await page_processor.start_processing(project_id)
    
    # Run any remaining discipline processing (Pass 3)
    discipline_results = await discipline_processor.process_all_ready(project_id)
    
    return {
        "pass1_completed": page_results.get("pass1_completed", 0),
        "pass1_errors": page_results.get("pass1_errors", 0),
        "pass2_completed": page_results.get("pass2_completed", 0),
        "pass2_errors": page_results.get("pass2_errors", 0),
        "pass3_completed": discipline_results.get("completed", 0),
        "pass3_errors": discipline_results.get("errors", 0),
    }

