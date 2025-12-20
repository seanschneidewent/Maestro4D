"""
Gemini Agent Service for ViewM4D conversational agent.

Processes superintendent queries using Gemini with conversation history
and context pointers from construction plans.
"""

import os
import asyncio
import json
import logging
from typing import List, Dict, Any

import google.generativeai as genai
from google.api_core import exceptions as google_exceptions

# Configure logging
logger = logging.getLogger(__name__)

# Configuration
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_AGENT_MODEL = os.getenv("GEMINI_AGENT_MODEL", "gemini-3-flash-preview")

# Retry configuration
MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds

# Token limits
AGENT_MAX_TOKENS = 4096


def _configure_client() -> bool:
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
            # Invalid argument - retry with backoff (might be transient)
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


def format_pointers_for_prompt(pointers: List[Dict[str, Any]]) -> str:
    """
    Format all context pointers into a structured list using XML-style tags.
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
2. Conversation history (for follow-up questions)
3. A list of context pointers (annotations) from the construction plans

Each pointer includes:
- Sheet name and page number
- Title and description
- Trade category (e.g., "Structural", "Mechanical", "Electrical")
- AI Analysis describing the technical content
- Identified elements and components
- Recommendations for review

Your job is to:
1. Consider the conversation history to understand follow-up questions
2. Read through ALL the context pointers carefully
3. Identify which ones could help answer the superintendent's question
4. Provide a concise answer and explain where to find the information

MATCHING GUIDELINES:
- Use conversation history to understand context for follow-up questions
- Use the Trade field to match questions about specific trades
- Use the Elements field to find specific components (e.g., "aluminum rail", "HVAC unit")
- Use the AI Analysis field for detailed technical matching
- Match by topic, trade, or related subject matter — not just exact keywords
- If someone asks about "roofing", include pointers about roofs, membranes, equipment stands, etc.
- If someone asks about "ADA" or "accessibility", include all accessibility-related pointers
- When in doubt, INCLUDE the pointer — it's better to show something potentially relevant than nothing
- Order pointers: primary answer first, then specs/schedules, then related coordination items

RESPONSE FORMAT:
You must respond with valid JSON in exactly this structure:
{
  "shortAnswer": "1-2 sentence direct answer to the question, suitable for a chat bubble",
  "narrative": "Fuller 2-4 sentence explanation with context about where to find the information and what to look for",
  "selectedPointers": [
    {"id": "exact_pointer_id", "sheetId": "sheet_uuid", "sheetName": "A-101", "reason": "Brief reason why this is relevant"},
    ...
  ]
}

IMPORTANT:
- shortAnswer should be conversational and direct
- narrative should reference sheet names so they know where to look
- Pointer IDs must exactly match the IDs provided — never make up IDs
- Include sheetId and sheetName for each selected pointer (copy from the pointer data)
- Order selectedPointers by relevance (most relevant first)

If absolutely no context pointers are related to the question, respond with:
{
  "shortAnswer": "I couldn't find specific information about that in the uploaded plans.",
  "narrative": "This topic doesn't appear to be covered in the context pointers I have access to. Try asking about a specific detail, spec, or area shown in the drawings, or check if the relevant plans have been processed.",
  "selectedPointers": []
}"""


def build_messages(
    user_query: str,
    conversation_history: List[Dict[str, str]],
    pointers_text: str
) -> List[Dict[str, Any]]:
    """Build the message list for the Gemini chat."""
    messages = []
    
    # Add conversation history
    for msg in conversation_history:
        role = "user" if msg["role"] == "user" else "model"
        messages.append({
            "role": role,
            "parts": [msg["content"]]
        })
    
    # Add current query with context pointers
    current_message = f"""SUPERINTENDENT'S QUESTION:
"{user_query}"

CONTEXT POINTERS FROM PROJECT PLANS:
{pointers_text}

Find the relevant pointers, provide a concise answer, and explain where to find the information."""
    
    messages.append({
        "role": "user",
        "parts": [current_message]
    })
    
    return messages


def _get_fallback_response(error_msg: str) -> Dict[str, Any]:
    """Return a valid fallback structure when the agent fails."""
    return {
        "shortAnswer": "I encountered an issue processing your question.",
        "narrative": f"There was a problem: {error_msg}. Please try again or rephrase your question.",
        "selectedPointers": []
    }


async def query_agent(
    user_query: str,
    conversation_history: List[Dict[str, str]],
    context_pointers: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Send query + conversation history + all context pointers to Gemini.
    
    Args:
        user_query: The superintendent's question
        conversation_history: List of prior messages [{"role": "user"|"agent", "content": "..."}]
        context_pointers: ALL committed context pointers for the project
        
    Returns:
        {
            "shortAnswer": "1-2 sentence summary",
            "narrative": "Fuller 2-4 sentence explanation",
            "selectedPointers": [
                {"id": "...", "sheetId": "...", "sheetName": "...", "reason": "..."},
                ...
            ]
        }
    """
    if not _configure_client():
        return _get_fallback_response("API key not configured")
    
    # Format context pointers for the prompt
    pointers_text = format_pointers_for_prompt(context_pointers)
    
    # Build system prompt and messages
    system_prompt = build_system_prompt()
    messages = build_messages(user_query, conversation_history, pointers_text)
    
    try:
        # Create model with JSON response mode
        model = genai.GenerativeModel(
            model_name=GEMINI_AGENT_MODEL,
            generation_config={
                "temperature": 0.3,
                "top_p": 0.95,
                "top_k": 40,
                "response_mime_type": "application/json",
                "max_output_tokens": AGENT_MAX_TOKENS,
            },
            system_instruction=system_prompt,
        )
        
        def _generate():
            # Start a chat with history
            chat = model.start_chat(history=messages[:-1] if len(messages) > 1 else [])
            # Send the current message
            response = chat.send_message(messages[-1]["parts"][0])
            return response.text
        
        result = await _retry_with_backoff(_generate)
        
        # Handle empty response
        if not result or len(result.strip()) == 0:
            return _get_fallback_response("Empty response from Gemini")
        
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
                "shortAnswer": parsed.get("shortAnswer", ""),
                "narrative": parsed.get("narrative", ""),
                "selectedPointers": parsed.get("selectedPointers", [])
            }
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON response: {e}\nResponse: {result[:500]}")
            return _get_fallback_response(f"Failed to parse response: {str(e)}")
        
    except Exception as e:
        logger.error(f"Failed to query agent: {e}")
        return _get_fallback_response(str(e))

