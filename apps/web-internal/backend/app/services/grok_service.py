"""
Grok 4.1 Fast agent service for processing superintendent queries.

Sends ALL context pointers for a project to Grok and lets it find relevant ones.
No vector search or embeddings - relies on Grok's 2M token context window.
"""

import os
import json
import time
from typing import List, Dict, Any
from pathlib import Path

import httpx


# Debug logging helper
def _debug_log(location: str, message: str, data: dict, hypothesis_id: str = "GROK"):
    """Log debug information to file for troubleshooting."""
    try:
        log_path = Path(r"c:\Users\Sean Schneidewent\Maestro4D\.cursor\debug.log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "location": location,
            "message": message,
            "data": data,
            "timestamp": time.time() * 1000,
            "sessionId": "grok-debug",
            "hypothesisId": hypothesis_id
        }
        with open(log_path, "a") as f:
            f.write(json.dumps(entry) + "\n")
        # Also print to console for immediate visibility
        print(f"[GROK DEBUG] {location}: {message}")
        if data:
            print(f"  Data: {json.dumps(data, indent=2)[:2000]}")  # Truncate large data
    except Exception as e:
        print(f"[GROK DEBUG LOG ERROR] {e}")

# xAI API configuration
XAI_API_KEY = os.getenv("XAI_API_KEY")
XAI_BASE_URL = "https://api.x.ai/v1"
GROK_MODEL = "grok-4-1-fast-non-reasoning"

# Timeout for large context queries (500K+ tokens possible)
GROK_TIMEOUT = 60.0


async def query_grok(
    user_query: str,
    context_pointers: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Send query + all context pointers to Grok and get structured response.
    
    Args:
        user_query: The superintendent's question
        context_pointers: ALL context pointers for the project
        
    Returns:
        {
            "selectedPointers": [
                {"id": "cp_123", "reason": "Primary detail showing..."},
                ...
            ],
            "narrative": "The aluminum rail details are on A401..."
        }
    """
    if not XAI_API_KEY:
        raise ValueError("XAI_API_KEY environment variable is not set")
    
    # Format context pointers for the prompt
    pointers_text = format_pointers_for_prompt(context_pointers)
    
    system_prompt = build_system_prompt()
    user_message = build_user_message(user_query, pointers_text)
    
    # DEBUG: Log the full prompt being sent to Grok
    _debug_log(
        "grok_service:query_grok:prompt",
        "Full prompt being sent to Grok",
        {
            "user_query": user_query,
            "pointer_count": len(context_pointers),
            "system_prompt_length": len(system_prompt),
            "user_message_length": len(user_message),
            "user_message_preview": user_message[:3000],  # First 3000 chars
            "full_user_message": user_message,  # Full message for debugging
        }
    )
    
    async with httpx.AsyncClient(timeout=GROK_TIMEOUT) as client:
        response = await client.post(
            f"{XAI_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {XAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROK_MODEL,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                "temperature": 0.3,
                "response_format": {"type": "json_object"},
            },
        )
        response.raise_for_status()
        
        result = response.json()
        
        # DEBUG: Log the raw API response
        _debug_log(
            "grok_service:query_grok:raw_response",
            "Raw response from Grok API",
            {
                "status_code": response.status_code,
                "model_used": result.get("model"),
                "usage": result.get("usage"),
            }
        )
        
        # Extract the generated content
        generated_text = result["choices"][0]["message"]["content"]
        
        # DEBUG: Log the generated text before parsing
        _debug_log(
            "grok_service:query_grok:generated_text",
            "Generated text from Grok",
            {
                "generated_text": generated_text,
            }
        )
        
        # Parse the JSON response
        parsed_response = json.loads(generated_text)
        
        # DEBUG: Log the parsed response
        _debug_log(
            "grok_service:query_grok:parsed_response",
            "Parsed JSON response",
            {
                "selected_pointer_count": len(parsed_response.get("selectedPointers", [])),
                "narrative_length": len(parsed_response.get("narrative", "")),
                "full_response": parsed_response,
            }
        )
        
        return parsed_response


def format_pointers_for_prompt(pointers: List[Dict[str, Any]]) -> str:
    """
    Format all context pointers into a structured list.
    Each pointer gets a consistent format for easy scanning.
    Includes AI analysis data (trade, elements, recommendations) when available.
    """
    if not pointers:
        return "<no_pointers>No context pointers available for this project.</no_pointers>"
    
    lines = []
    for p in pointers:
        # Build the basic info
        parts = [
            f'<pointer id="{p["id"]}">',
            f"Sheet: {p.get('sheet_name', 'Unknown')} ({p.get('sheet_id', '')})",
            f"Page: {p.get('page_number', 1)}",
            f"Title: {p.get('title', 'Untitled')}",
            f"Description: {p.get('description') or 'No description'}",
        ]
        
        # Add bounding box location if present
        bounds = p.get('bounds')
        if bounds:
            parts.append(f"Location: x={bounds.get('x', 0):.2f}, y={bounds.get('y', 0):.2f}, w={bounds.get('width', 0):.2f}, h={bounds.get('height', 0):.2f}")
        
        # Add AI analysis if present
        if p.get('trade'):
            parts.append(f"Trade: {p['trade']}")
        
        if p.get('technical_description'):
            parts.append(f"AI Analysis: {p['technical_description']}")
        
        if p.get('elements'):
            elements = p['elements']
            if isinstance(elements, list):
                element_strs = []
                for el in elements:
                    if isinstance(el, str):
                        element_strs.append(el)
                    elif isinstance(el, dict) and 'name' in el:
                        element_strs.append(el['name'])
                if element_strs:
                    parts.append(f"Elements: {', '.join(element_strs)}")
        
        if p.get('recommendations'):
            parts.append(f"Recommendations: {p['recommendations']}")
        
        parts.append("</pointer>")
        lines.append("\n".join(parts))
    
    return "\n\n".join(lines)


def build_system_prompt() -> str:
    """System prompt establishing the agent's role and output format."""
    return """You are an AI assistant helping construction superintendents find information in their project plans.

You will receive:
1. A question from a superintendent
2. A list of context pointers (annotations) from the construction plans

Each pointer includes:
- Sheet name and page number
- Title and description
- Location on the page (bounding box coordinates)
- Trade category (e.g., "Structural", "Mechanical", "Electrical")
- AI Analysis describing the technical content
- Identified elements and components
- Recommendations for review

Your job is to:
1. Read through ALL the context pointers carefully
2. Identify which ones could help answer the superintendent's question
3. Order them in the sequence the superintendent should review them (primary answer first, then supporting details)
4. Write a brief narrative connecting the pointers and explaining the answer

MATCHING GUIDELINES:
- Use the Trade field to match questions about specific trades
- Use the Elements field to find specific components (e.g., "aluminum rail", "HVAC unit")
- Use the AI Analysis field for detailed technical matching
- Select any pointer that could help answer the question, even if it's a partial match
- Match by topic, trade, or related subject matter — not just exact keywords
- If someone asks about "roofing", include pointers about roofs, membranes, equipment stands on roofs, etc.
- If someone asks about "ADA" or "accessibility", include all accessibility-related pointers
- When in doubt, INCLUDE the pointer — it's better to show something potentially relevant than nothing
- The order matters: start with the primary answer, then specs/schedules, then related coordination items

OUTPUT GUIDELINES:
- Keep the narrative concise (2-4 sentences) and practical
- Use plain language a superintendent would understand
- Reference sheet names so they know where to look
- Mention the trade when relevant
- Pointer IDs must exactly match the IDs provided — never make up IDs

RESPONSE FORMAT:
You must respond with valid JSON in exactly this structure:
{
  "selectedPointers": [
    {"id": "exact_pointer_id", "reason": "Brief reason why this is relevant"},
    ...
  ],
  "narrative": "Your explanation connecting the pointers and answering the question."
}

ONLY if absolutely no context pointers are even remotely related to the question, respond with:
{
  "selectedPointers": [],
  "narrative": "I couldn't find relevant information in the plans for this question. Try asking about a specific detail, spec, or area shown in the drawings."
}"""


def build_user_message(query: str, pointers_text: str) -> str:
    """Build the user message with question and all pointers."""
    return f"""SUPERINTENDENT'S QUESTION:
"{query}"

CONTEXT POINTERS FROM PROJECT PLANS:
{pointers_text}

Find the relevant pointers, order them logically, and explain the answer."""

