"""
Gemini service for analyzing construction plan pages.

Provides three main functions:
1. analyze_page - General description of a full plan page
2. analyze_highlight - Specific context for a highlighted region
3. analyze_context_pointer - Detailed AI analysis of a context pointer region
"""

import os
import base64
import asyncio
import json
import logging
from typing import Optional

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions

# Configure logging
logger = logging.getLogger(__name__)

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds
TIMEOUT = 30.0  # seconds

# Token limits for efficiency at scale
PAGE_ANALYSIS_MAX_TOKENS = 500
HIGHLIGHT_ANALYSIS_MAX_TOKENS = 1000
CONTEXT_POINTER_MAX_TOKENS = 8192  # High limit for complete extraction of large keynote tables


def _configure_client() -> bool:
    """Configure the Gemini client. Returns True if successful."""
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API_KEY environment variable is not set")
        return False
    genai.configure(api_key=GEMINI_API_KEY)
    return True


def _get_model() -> genai.GenerativeModel:
    """Get configured Gemini model instance."""
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config={
            "temperature": 0.2,
            "top_p": 0.8,
            "top_k": 40,
        }
    )


async def _retry_with_backoff(func, *args, **kwargs):
    """
    Execute a function with exponential backoff retry logic.
    Handles rate limits and transient failures.
    """
    last_exception = None
    
    for attempt in range(MAX_RETRIES):
        try:
            # Run the sync Gemini call in a thread pool to not block
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, lambda: func(*args, **kwargs))
            return result
        except google_exceptions.ResourceExhausted as e:
            # Rate limited - back off and retry
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Rate limited, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except google_exceptions.DeadlineExceeded as e:
            # Timeout - retry with backoff
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Timeout, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except google_exceptions.ServiceUnavailable as e:
            # Service temporarily unavailable
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Service unavailable, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except google_exceptions.InvalidArgument as e:
            # Invalid argument (e.g., bad image) - retry with backoff (might be transient)
            last_exception = e
            delay = BASE_DELAY * (2 ** attempt)
            logger.warning(f"Invalid argument, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
            await asyncio.sleep(delay)
        except Exception as e:
            # Non-retryable error
            logger.error(f"Non-retryable error: {e}")
            raise
    
    # All retries exhausted
    raise last_exception


def _bytes_to_image_part(image_bytes: bytes) -> dict:
    """Convert image bytes to Gemini image part format."""
    # Detect MIME type from magic bytes
    mime_type = "image/png"  # default
    if image_bytes[:3] == b'\xff\xd8\xff':
        mime_type = "image/jpeg"
    elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        mime_type = "image/png"
    elif image_bytes[:4] == b'%PDF':
        mime_type = "application/pdf"
    
    return {
        "mime_type": mime_type,
        "data": base64.b64encode(image_bytes).decode("utf-8")
    }


async def analyze_page(
    pdf_bytes: bytes,
    page_number: int,
    file_name: str
) -> str:
    """
    Analyze a specific page from a construction plan PDF.
    
    Args:
        pdf_bytes: The full PDF file as bytes
        page_number: The page number to analyze (1-indexed)
        file_name: The name of the PDF file for context
    
    Returns:
        A description of the page content, or "[Analysis unavailable]" on error
    """
    if not _configure_client():
        return "[Analysis unavailable: API key not configured]"
    
    try:
        model = _get_model()
        
        prompt = f"""Analyze page {page_number} of this construction plan PDF (file: "{file_name}").

Focus ONLY on page {page_number}. Provide a concise description covering:
1. Drawing type (floor plan, elevation, section, detail, schedule, cover sheet, etc.)
2. What the drawing shows (which building area, system, or component)
3. Key elements visible (dimensions, callouts, notes, equipment, specifications, etc.)
4. Sheet ID interpretation if visible (what the sheet number suggests about its purpose)

Keep the response to 2-4 sentences. Be specific and technical but accessible to field personnel."""

        pdf_part = {
            "mime_type": "application/pdf",
            "data": base64.b64encode(pdf_bytes).decode("utf-8")
        }
        
        def _generate():
            response = model.generate_content(
                [prompt, pdf_part],
                generation_config={"max_output_tokens": PAGE_ANALYSIS_MAX_TOKENS}
            )
            return response.text
        
        result = await _retry_with_backoff(_generate)
        return result.strip()
        
    except Exception as e:
        logger.error(f"Failed to analyze page {page_number} of {file_name}: {e}")
        # #region agent log H6
        import json as _json, traceback as _tb; open('/Users/seanschneidewent/Maestro4D-2/.cursor/debug.log','a').write(_json.dumps({"hypothesisId":"H6","location":"gemini_service.py:analyze_page","message":"Exception caught","data":{"error_type":type(e).__name__,"error_msg":str(e),"traceback":_tb.format_exc()},"timestamp":__import__('time').time()*1000,"sessionId":"debug-session"})+'\n')
        # #endregion
        return "[Analysis unavailable]"


async def analyze_highlight(
    image_bytes: bytes,
    page_context: str,
    bbox: dict
) -> dict:
    """
    Analyze a highlighted region from a construction plan.
    
    Args:
        image_bytes: The cropped highlight region as bytes
        page_context: Description of the parent page (from analyze_page)
        bbox: Bounding box dict with x, y, width, height (for context, not used in prompt)
    
    Returns:
        {"title": "Short Title", "description": "1-2 sentence description"}
        On error: {"title": "Highlight", "description": "[Analysis unavailable]"}
    """
    if not _configure_client():
        return {
            "title": "Highlight",
            "description": "[Analysis unavailable: API key not configured]"
        }
    
    try:
        model = _get_model()
        
        prompt = f"""This is a highlighted region from a construction drawing.

Parent page context: {page_context}

Provide structural guidance for detailed extraction. Do NOT transcribe the content—just describe what's there.

1. TITLE: What type of content is this? (3-6 words)

2. DESCRIPTION: Answer these questions briefly:
   - Format: Is this a numbered list, table, schedule, detail, diagram, or spec text?
   - Count: Approximately how many items, rows, or callouts?
   - Trades: What disciplines are involved? (arch, struct, mech, elec, plumb)
   - References: Are there drawing cross-references? (detail numbers, sheet refs)
   - Revisions: Any revision markers, clouds, or delta symbols? Which items?
   - Special notes: Any GC responsibilities, coordination items, or critical flags?

Keep it brief. The next stage will extract specifics directly from the image.

Respond in exactly this format:
TITLE: [content type]
DESCRIPTION: [structural guidance]"""

        image_part = _bytes_to_image_part(image_bytes)
        
        def _generate():
            response = model.generate_content(
                [prompt, image_part],
                generation_config={"max_output_tokens": HIGHLIGHT_ANALYSIS_MAX_TOKENS}
            )
            return response.text
        
        result = await _retry_with_backoff(_generate)
        
        # Parse the structured response
        return _parse_highlight_response(result)
        
    except Exception as e:
        logger.error(f"Failed to analyze highlight: {e}")
        return {
            "title": "Highlight",
            "description": "[Analysis unavailable]"
        }


def _parse_highlight_response(response_text: str) -> dict:
    """Parse the structured title/description response from Gemini."""
    title = "Highlight"
    description = ""
    
    lines = response_text.strip().split("\n")
    
    for line in lines:
        line = line.strip()
        if line.upper().startswith("TITLE:"):
            title = line[6:].strip()
        elif line.upper().startswith("DESCRIPTION:"):
            description = line[12:].strip()
    
    # Fallback: if parsing failed, use the whole response as description
    if not description and response_text.strip():
        # Check if it's a simple two-line response without labels
        if len(lines) >= 2 and not any(l.upper().startswith(("TITLE:", "DESCRIPTION:")) for l in lines):
            title = lines[0].strip()
            description = " ".join(lines[1:]).strip()
        else:
            description = response_text.strip()
    
    # Ensure title isn't too long
    if len(title) > 50:
        title = title[:47] + "..."
    
    return {
        "title": title,
        "description": description
    }


def _get_fallback_analysis(error_msg: str) -> dict:
    """Return a valid fallback structure when analysis fails."""
    return {
        "technicalDescription": "Analysis failed to parse",
        "identifiedElements": [],
        "tradeCategory": "other",
        "measurements": [],
        "issues": [{"severity": "warning", "description": f"Error: {error_msg}"}],
        "recommendations": ""
    }


async def analyze_context_pointer(
    image_base64: str,
    title: str,
    description: str,
    page_number: int,
    source_file: str,
    page_context: Optional[str] = None
) -> dict:
    """
    Analyze a context pointer region from a construction plan.
    
    Args:
        image_base64: Base64-encoded PNG image (no data: prefix)
        title: User-provided title for the region
        description: User-provided description
        page_number: Page number in the plan set
        source_file: Source PDF filename
        page_context: Optional context about the full page
    
    Returns:
        dict with AIAnalysis structure:
        {
            "technicalDescription": str,
            "identifiedElements": [{"name": str, "type": str, "details": str}],
            "tradeCategory": str,
            "measurements": [{"value": str, "unit": str, "context": str}],
            "issues": [{"severity": str, "description": str}],
            "recommendations": str
        }
    """
    if not _configure_client():
        return _get_fallback_analysis("API key not configured")
    
    # Build context string
    context_info = f"Page {page_number} of {source_file}"
    if page_context:
        context_info += f"\nPage context: {page_context}"
    
    prompt = f"""TASK: Extract EVERY line item from this construction drawing. This is a data extraction task, NOT a summary task.

Source: {context_info}
Region: "{title}"

CRITICAL REQUIREMENT: You MUST create one identifiedElements entry for EACH numbered item, row, or callout visible in the image. If there are 18 keynotes, output 18 elements. If there are 25 specifications, output 25 elements. DO NOT SUMMARIZE.

EXAMPLE - For a keynote table with items 1-5, the output MUST include:
{{
    "identifiedElements": [
        {{"name": "Keynote 1: NEW BULKHEAD ABOVE TORMAX DOOR. RE:DETAIL 2/A401", "type": "keynote", "details": "Architectural header/bulkhead work above automatic door, reference detail 2 on sheet A401"}},
        {{"name": "Keynote 2: RECESSED AIR CURTAIN & DIVERTER BOX. RE: DETAIL 2/A401 & MECHANICAL DRAWINGS", "type": "keynote", "details": "HVAC coordination item, reference architectural detail and mechanical drawings"}},
        {{"name": "Keynote 3: NEW 7'-0\" A.F.F. HEADER WITH SS CAP", "type": "keynote", "details": "Stainless steel capped header at 7 feet above finish floor"}},
        {{"name": "Keynote 4: NEW 2x2 ACT CEILING TILES AND GRIDS TO MATCH EXISTING", "type": "keynote", "details": "Acoustic ceiling tile replacement to match existing"}},
        {{"name": "Keynote 5: NEW EXIT SIGN. GC TO PROVIDE POWER. RE: ELEC. DWGS", "type": "keynote", "details": "GC responsibility for power, coordinate with electrical drawings"}}
    ]
}}

Return ONLY valid JSON with this structure:

{{
    "technicalDescription": "One paragraph summarizing the content type and total count (e.g., 'Keynote legend with 18 items covering architectural ceiling and mechanical coordination work')",
    
    "identifiedElements": [
        {{
            "name": "[ID]: [FULL VERBATIM TEXT FROM IMAGE] - Put the COMPLETE text here, e.g. 'Keynote 7: NEW MINI SPLIT. RE: MECHANICAL & ELECTRICAL DRAWINGS'",
            "type": "keynote|specification|detail|fixture|equipment|structural|mechanical|electrical|plumbing|architectural",
            "details": "Brief context or trade coordination notes. For revised items, start with 'REVISED - '"
        }}
    ],
    
    "tradeCategory": "architectural|structural|mechanical|electrical|plumbing|fire_protection|general",
    
    "measurements": [
        {{"value": "7'-0\"", "unit": "AFF", "context": "header height"}},
        {{"value": "2x2", "unit": "feet", "context": "ceiling tile size"}}
    ],
    
    "issues": [
        {{"severity": "info", "description": "Items 14, 17, 18 have revision clouds (Revision A)"}}
    ],
    
    "recommendations": "Coordinate keynotes 1, 2, 6 with mechanical drawings. GC responsible for keynote 5 power."
}}

EXTRACTION RULES:
1. ONE ELEMENT PER NUMBERED ITEM - Do not combine or skip items
2. NAME FIELD = FULL TEXT - The "name" field MUST contain "[ID]: [COMPLETE VERBATIM TEXT]" from the image
3. ALL REFERENCES IN NAME - Include every "RE:", "SEE", detail number in the name field
4. REVISION MARKERS - Items with cloud symbols start name with "REVISED - Keynote X: ..."
5. MEASUREMENTS - Extract every dimension, height (AFF), size, or quantity mentioned
6. GC NOTES - Flag any "GC TO..." or contractor responsibility items in recommendations

CRITICAL: The "name" field is the PRIMARY display field. Put ALL important text there. Do NOT put just "Keynote 1" - put "Keynote 1: NEW BULKHEAD ABOVE TORMAX DOOR. RE:DETAIL 2/A401"

COUNT CHECK: Before responding, count your identifiedElements. Does it match the number of items in the image?"""


    try:
        # Create model with JSON response mode
        # Low temperature for deterministic extraction, high token limit for complete output
        model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            generation_config={
                "temperature": 0.1,  # Low temp for consistent extraction
                "top_p": 0.95,  # Higher top_p to allow complete responses
                "top_k": 40,
                "response_mime_type": "application/json",
                "max_output_tokens": CONTEXT_POINTER_MAX_TOKENS,
            }
        )
        
        # Create image part from base64
        image_part = {
            "mime_type": "image/png",
            "data": image_base64
        }
        
        def _generate():
            response = model.generate_content([prompt, image_part])
            return response.text
        
        result = await _retry_with_backoff(_generate)
        
        # Handle empty response
        if not result or len(result.strip()) == 0:
            return _get_fallback_analysis("Empty response from Gemini")

        # Parse JSON response
        try:
            # Try to extract JSON if wrapped in markdown code blocks
            clean_result = result.strip()
            if clean_result.startswith("```"):
                # Remove markdown code fence
                lines = clean_result.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                clean_result = "\n".join(lines)
            
            parsed = json.loads(clean_result)
            
            # Ensure required fields exist with correct types
            return {
                "technicalDescription": parsed.get("technicalDescription", ""),
                "identifiedElements": parsed.get("identifiedElements", []),
                "tradeCategory": parsed.get("tradeCategory", "general"),
                "measurements": parsed.get("measurements", []),
                "issues": parsed.get("issues", []),
                "recommendations": parsed.get("recommendations", "")
            }
        except json.JSONDecodeError as e:
            # Check if this looks like truncation (error near end of response)
            if e.pos and len(result) > 0 and e.pos >= len(result) - 50:
                logger.warning(f"Response appears truncated at position {e.pos}/{len(result)}, retrying with extended limit")
                # Retry with even higher token limit
                retry_model = genai.GenerativeModel(
                    model_name=GEMINI_MODEL,
                    generation_config={
                        "temperature": 0.1,
                        "top_p": 0.95,
                        "response_mime_type": "application/json",
                        "max_output_tokens": 16384,  # Double the limit for retry
                    }
                )
                retry_prompt = f"""Extract ALL items from this construction drawing. Return valid JSON.

Region: "{title}" from {source_file}

{{
    "technicalDescription": "Summary of content",
    "identifiedElements": [{{"name": "Keynote 1: FULL TEXT FROM IMAGE HERE", "type": "keynote", "details": "context"}}],
    "tradeCategory": "architectural|structural|mechanical|electrical|plumbing|general",
    "measurements": [{{"value": "X", "unit": "unit", "context": "what"}}],
    "issues": [{{"severity": "info", "description": "Any concerns"}}],
    "recommendations": "Coordination notes"
}}

IMPORTANT: The "name" field MUST contain the COMPLETE verbatim text, e.g. "Keynote 5: NEW EXIT SIGN. GC TO PROVIDE POWER. RE: ELEC. DWGS"
Create ONE element for EACH numbered item. Do not summarize."""

                try:
                    def _generate_retry():
                        response = retry_model.generate_content([retry_prompt, image_part])
                        return response.text
                    
                    retry_result = await _retry_with_backoff(_generate_retry)
                    
                    if retry_result:
                        retry_clean = retry_result.strip()
                        if retry_clean.startswith("```"):
                            lines = retry_clean.split("\n")
                            if lines[0].startswith("```"):
                                lines = lines[1:]
                            if lines and lines[-1].strip() == "```":
                                lines = lines[:-1]
                            retry_clean = "\n".join(lines)
                        
                        retry_parsed = json.loads(retry_clean)
                        return {
                            "technicalDescription": retry_parsed.get("technicalDescription", ""),
                            "identifiedElements": retry_parsed.get("identifiedElements", []),
                            "tradeCategory": retry_parsed.get("tradeCategory", "general"),
                            "measurements": retry_parsed.get("measurements", []),
                            "issues": retry_parsed.get("issues", []),
                            "recommendations": retry_parsed.get("recommendations", "")
                        }
                except Exception as retry_err:
                    logger.warning(f"Retry with concise prompt also failed: {retry_err}")
            
            logger.error(f"Failed to parse JSON response: {e}\nResponse: {result[:500]}")
            return _get_fallback_analysis(f"JSON parse error: {str(e)}")
        
    except Exception as e:
        logger.error(f"Failed to analyze context pointer '{title}': {e}")
        return _get_fallback_analysis(str(e))


# Synchronous wrappers for non-async contexts
def analyze_page_sync(pdf_bytes: bytes, page_number: int, file_name: str) -> str:
    """Synchronous wrapper for analyze_page."""
    return asyncio.run(analyze_page(pdf_bytes, page_number, file_name))


def analyze_highlight_sync(
    image_bytes: bytes,
    page_context: str,
    bbox: dict
) -> dict:
    """Synchronous wrapper for analyze_highlight."""
    return asyncio.run(analyze_highlight(image_bytes, page_context, bbox))


def analyze_context_pointer_sync(
    image_base64: str,
    title: str,
    description: str,
    page_number: int,
    source_file: str,
    page_context: Optional[str] = None
) -> dict:
    """Synchronous wrapper for analyze_context_pointer."""
    return asyncio.run(analyze_context_pointer(
        image_base64, title, description, page_number, source_file, page_context
    ))
