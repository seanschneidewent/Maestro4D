"""
Service for matching agent response text to context pointer text elements.
Returns highlight coordinates for frontend rendering.
"""

from difflib import SequenceMatcher
import re
from typing import List, Dict, Any


def normalize_text(text: str) -> str:
    """Normalize text for fuzzy matching with construction-specific handling."""
    text = text.lower().strip()
    
    # Construction abbreviation expansions
    replacements = [
        (r'(\d+)\s*["″]', r'\1 inch'),           # 16" → 16 inch
        (r'(\d+)\s*[\'′]', r'\1 foot'),           # 8' → 8 foot
        (r'\bo\.?c\.?\b', 'on center'),           # O.C. → on center
        (r'\btyp\.?\b', 'typical'),               # TYP → typical
        (r'\bsim\.?\b', 'similar'),               # SIM → similar
        (r'\bn\.?t\.?s\.?\b', 'not to scale'),    # NTS → not to scale
        (r'\beq\.?\b', 'equal'),                  # EQ → equal
        (r'\bmax\.?\b', 'maximum'),               # MAX → maximum
        (r'\bmin\.?\b', 'minimum'),               # MIN → minimum
        (r'\bconc\.?\b', 'concrete'),             # CONC → concrete
        (r'\bcontin\.?\b', 'continuous'),         # CONTIN → continuous
        (r'\bea\.?\b', 'each'),                   # EA → each
        (r'\bw/\b', 'with'),                      # w/ → with
        (r'\b@\b', 'at'),                         # @ → at
        (r'\binfo\.?\b', 'information'),          # INFO → information
        (r'\bspec\.?\b', 'specification'),        # SPEC → specification
        (r'\bdwg\.?\b', 'drawing'),               # DWG → drawing
        (r'\bdet\.?\b', 'detail'),                # DET → detail
        (r'\bsht\.?\b', 'sheet'),                 # SHT → sheet
        (r'\bstd\.?\b', 'standard'),              # STD → standard
        (r'\bmt[lr]\.?\b', 'metal'),              # MTL → metal
        (r'\bconstr\.?\b', 'construction'),       # CONSTR → construction
        (r'\bapprox\.?\b', 'approximately'),      # APPROX → approximately
        (r'\s+', ' '),                            # collapse whitespace
    ]
    
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    
    return text


def find_matching_elements(
    agent_text: str,
    text_elements: List[Dict],
    threshold: float = 0.6
) -> List[Dict]:
    """
    Find text elements that match content referenced by the agent.
    Returns elements with match scores.
    """
    matches = []
    agent_normalized = normalize_text(agent_text)
    
    for element in text_elements:
        original = element["text"]
        normalized = normalize_text(original)
        
        # Skip very short elements
        if len(normalized) < 2:
            continue
        
        # Strategy 1: Direct substring match
        if normalized in agent_normalized or agent_normalized in normalized:
            matches.append({
                **element,
                "match_type": "substring",
                "score": 1.0
            })
            continue
        
        # Strategy 2: Fuzzy ratio match
        ratio = SequenceMatcher(None, normalized, agent_normalized).ratio()
        if ratio >= threshold:
            matches.append({
                **element,
                "match_type": "fuzzy",
                "score": ratio
            })
            continue
        
        # Strategy 3: Token overlap
        element_tokens = set(normalized.split())
        agent_tokens = set(agent_normalized.split())
        
        stopwords = {'the', 'a', 'an', 'to', 'of', 'and', 'or', 'see', 'per', 'at', 'in', 'is', 'are', 'for', 'this', 'that', 'with'}
        element_tokens -= stopwords
        agent_tokens -= stopwords
        
        if element_tokens and agent_tokens:
            overlap = len(element_tokens & agent_tokens) / len(element_tokens)
            if overlap >= threshold:
                matches.append({
                    **element,
                    "match_type": "token_overlap",
                    "score": overlap
                })
    
    matches.sort(key=lambda x: x["score"], reverse=True)
    return matches


def bboxes_overlap(a: Dict, b: Dict, threshold: float = 0.5) -> bool:
    """Check if two bboxes significantly overlap."""
    x_overlap = max(0, min(a["x1"], b["x1"]) - max(a["x0"], b["x0"]))
    y_overlap = max(0, min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]))
    intersection = x_overlap * y_overlap
    
    area_a = (a["x1"] - a["x0"]) * (a["y1"] - a["y0"])
    area_b = (b["x1"] - b["x0"]) * (b["y1"] - b["y0"])
    min_area = min(area_a, area_b)
    
    if min_area <= 0:
        return False
    return (intersection / min_area) > threshold


def deduplicate_highlights(highlights: List[Dict]) -> List[Dict]:
    """Remove duplicate/overlapping highlights, keeping highest scored."""
    if not highlights:
        return []
    
    highlights.sort(key=lambda x: x["score"], reverse=True)
    
    kept = []
    for h in highlights:
        dominated = False
        for k in kept:
            if (k["pointer_id"] == h["pointer_id"] and
                bboxes_overlap(k["bbox"], h["bbox"])):
                dominated = True
                break
        if not dominated:
            kept.append(h)
    
    return kept


def extract_highlights_from_response(
    agent_response: str,
    context_pointers: List[Dict],
    min_score: float = 0.7
) -> List[Dict]:
    """
    Parse agent response and find highlightable regions.
    
    Args:
        agent_response: The agent's text response (content + narrative)
        context_pointers: List of context pointers with text_content
        min_score: Minimum match score to include
    
    Returns:
        List of highlight objects with coordinates relative to pointer bounds
    """
    highlights = []
    
    # Split response into sentences/phrases
    sentences = re.split(r'[.;:\n]', agent_response)
    
    for sentence in sentences:
        sentence = sentence.strip()
        if len(sentence) < 10:
            continue
        
        for cp in context_pointers:
            text_content = cp.get("text_content") or {}
            text_elements = text_content.get("text_elements", [])
            clip_rect = text_content.get("clip_rect", {})
            page_width = text_content.get("page_width", 1)
            page_height = text_content.get("page_height", 1)
            
            if not text_elements or not clip_rect:
                continue
            
            matches = find_matching_elements(sentence, text_elements)
            
            for match in matches:
                if match["score"] >= min_score:
                    # Convert absolute PDF coords to normalized coords relative to pointer bounds
                    bbox = match["bbox"]
                    pointer_x = clip_rect.get("x0", 0)
                    pointer_y = clip_rect.get("y0", 0)
                    pointer_w = clip_rect.get("x1", 1) - pointer_x
                    pointer_h = clip_rect.get("y1", 1) - pointer_y
                    
                    # Normalize within pointer region (0-1 relative to pointer bounds)
                    highlights.append({
                        "pointer_id": cp["id"],
                        "bbox_normalized": {
                            "x": (bbox["x0"] - pointer_x) / pointer_w if pointer_w else 0,
                            "y": (bbox["y0"] - pointer_y) / pointer_h if pointer_h else 0,
                            "width": (bbox["x1"] - bbox["x0"]) / pointer_w if pointer_w else 0,
                            "height": (bbox["y1"] - bbox["y0"]) / pointer_h if pointer_h else 0
                        },
                        "bbox": bbox,  # Keep absolute coords for reference
                        "matched_text": match["text"],
                        "agent_reference": sentence[:100],
                        "score": match["score"],
                        "match_type": match["match_type"]
                    })
    
    return deduplicate_highlights(highlights)

