"""
Agent router - ViewM4D conversational agent sessions and messages.

Provides endpoints for managing multi-turn conversations with the Gemini agent,
including session management and message handling with context pointer selection.
"""

import re
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query as FQuery
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (
    AgentSession,
    AgentMessage,
    AgentMessagePointer,
    User,
    Project,
    ContextPointer,
    ProjectFile,
)
from ..schemas import (
    AgentSessionCreate,
    AgentSessionUpdate,
    AgentMessageCreate,
    AgentSessionSummary,
    AgentSessionResponse,
    AgentMessageResponse,
)
from ..security import get_current_user
from ..services.gemini_agent_service import query_agent

router = APIRouter()


def extract_highlighted_ids(response_text: str) -> List[str]:
    """Extract text element IDs from <highlighted_text> tags in agent response."""
    match = re.search(r'<highlighted_text>(.*?)</highlighted_text>', response_text, re.DOTALL)
    if not match:
        return []
    return [id.strip() for id in match.group(1).split(',') if id.strip()]


def get_highlights_from_ids(ids: List[str], pointers_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Look up text elements by ID and convert to highlight format.
    
    Args:
        ids: List of text element IDs from agent response
        pointers_data: List of context pointers with text_content
        
    Returns:
        List of highlight objects with normalized coordinates
    """
    highlights = []
    ids_set = set(ids)
    
    for pointer in pointers_data:
        text_content = pointer.get("text_content") or {}
        elements = text_content.get("text_elements", [])
        clip_rect = text_content.get("clip_rect", {})
        
        if not elements or not clip_rect:
            continue
        
        for el in elements:
            if el.get("id") in ids_set:
                # Convert absolute PDF coords to normalized coords relative to pointer bounds
                bbox = el["bbox"]
                px = clip_rect.get("x0", 0)
                py = clip_rect.get("y0", 0)
                pw = clip_rect.get("x1", 1) - px
                ph = clip_rect.get("y1", 1) - py
                
                norm_x = (bbox["x0"] - px) / pw if pw else 0
                norm_y = (bbox["y0"] - py) / ph if ph else 0
                norm_w = (bbox["x1"] - bbox["x0"]) / pw if pw else 0
                norm_h = (bbox["y1"] - bbox["y0"]) / ph if ph else 0
                
                # #region agent log
                import json, time
                with open("/Users/seanschneidewent/Maestro4D-2/.cursor/debug.log", "a") as _dbg:
                    _dbg.write(json.dumps({"sessionId":"debug-session","runId":"coord-debug","hypothesisId":"H2-normalize","location":"agent.py:get_highlights_from_ids","message":"Highlight normalization","data":{"element_id":el.get("id"),"element_bbox":bbox,"clip_rect":clip_rect,"px":px,"py":py,"pw":pw,"ph":ph,"norm_x":norm_x,"norm_y":norm_y,"norm_w":norm_w,"norm_h":norm_h,"text_preview":el.get("text","")[:40]},"timestamp":int(time.time()*1000)})+"\n")
                # #endregion
                
                highlights.append({
                    "pointer_id": pointer["id"],
                    "bbox_normalized": {
                        "x": norm_x,
                        "y": norm_y,
                        "width": norm_w,
                        "height": norm_h,
                    },
                    "matched_text": el["text"],
                })
    
    return highlights


def _verify_session_ownership(db: Session, session_id: str, user_id: str) -> AgentSession:
    """Verify that a session exists and belongs to the current user."""
    session = db.query(AgentSession).filter(AgentSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to access this session")
    return session


@router.get("/agent/sessions", response_model=List[AgentSessionSummary])
def list_sessions(
    project_id: str = FQuery(..., alias="projectId"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List all agent sessions for the current user in a project.
    Returns sessions ordered by updated_at DESC.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Query sessions for this user and project
    sessions = (
        db.query(AgentSession)
        .filter(
            AgentSession.user_id == current_user.id,
            AgentSession.project_id == project_id,
        )
        .order_by(AgentSession.updated_at.desc())
        .all()
    )
    
    # Build response with message counts
    result = []
    for session in sessions:
        message_count = db.query(AgentMessage).filter(AgentMessage.session_id == session.id).count()
        result.append(AgentSessionSummary(
            id=session.id,
            title=session.title,
            project_id=session.project_id,
            message_count=message_count,
            created_at=session.created_at,
            updated_at=session.updated_at,
        ))
    
    return result


@router.post("/agent/sessions", response_model=AgentSessionResponse, status_code=201)
def create_session(
    data: AgentSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new agent session for the current user.
    Returns the new session with an empty messages array.
    """
    # Verify project exists
    project = db.query(Project).filter(Project.id == data.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Create new session
    session = AgentSession(
        user_id=current_user.id,
        project_id=data.project_id,
        title=None,  # Will be auto-generated from first message
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    
    return AgentSessionResponse(
        id=session.id,
        title=session.title,
        project_id=session.project_id,
        messages=[],
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get("/agent/sessions/{session_id}", response_model=AgentSessionResponse)
def get_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get a session with all its messages and pointer references.
    Messages are ordered by created_at ASC.
    """
    session = _verify_session_ownership(db, session_id, current_user.id)
    
    # Load messages with pointers
    messages = (
        db.query(AgentMessage)
        .options(joinedload(AgentMessage.pointers))
        .filter(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.created_at.asc())
        .all()
    )
    
    # Build response
    message_responses = [AgentMessageResponse.from_orm_model(msg) for msg in messages]
    
    return AgentSessionResponse(
        id=session.id,
        title=session.title,
        project_id=session.project_id,
        messages=message_responses,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/agent/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Delete a session and all its messages (CASCADE handles cleanup).
    """
    session = _verify_session_ownership(db, session_id, current_user.id)
    
    db.delete(session)
    db.commit()
    return None


@router.patch("/agent/sessions/{session_id}", response_model=AgentSessionResponse)
def update_session(
    session_id: str,
    data: AgentSessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Update session properties (currently just title).
    """
    session = _verify_session_ownership(db, session_id, current_user.id)
    
    if data.title is not None:
        session.title = data.title
    
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(session)
    
    # Load messages for response
    messages = (
        db.query(AgentMessage)
        .options(joinedload(AgentMessage.pointers))
        .filter(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.created_at.asc())
        .all()
    )
    
    message_responses = [AgentMessageResponse.from_orm_model(msg) for msg in messages]
    
    return AgentSessionResponse(
        id=session.id,
        title=session.title,
        project_id=session.project_id,
        messages=message_responses,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.post("/agent/sessions/{session_id}/messages", response_model=AgentMessageResponse, status_code=201)
async def create_message(
    session_id: str,
    data: AgentMessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Send a message to the agent and get a response.
    
    Flow:
    1. Create user message record
    2. Load conversation history from session
    3. Load ALL committed context pointers for the project
    4. Call query_agent() with history + pointers
    5. Create agent message record with response
    6. Create agent_message_pointer records for each selected pointer
    7. If first message, auto-generate session title
    8. Update session's updated_at
    9. Return the agent message response
    """
    session = _verify_session_ownership(db, session_id, current_user.id)
    
    # 1. Create user message record
    user_message = AgentMessage(
        session_id=session_id,
        role="user",
        content=data.query,
        narrative=None,
    )
    db.add(user_message)
    db.commit()
    
    # 2. Load conversation history (all prior messages in session)
    prior_messages = (
        db.query(AgentMessage)
        .filter(AgentMessage.session_id == session_id)
        .filter(AgentMessage.id != user_message.id)  # Exclude the message we just added
        .order_by(AgentMessage.created_at.asc())
        .all()
    )
    
    conversation_history = []
    for msg in prior_messages:
        conversation_history.append({
            "role": msg.role,
            "content": msg.content,
        })
    
    # 3. Load ALL committed context pointers for the project
    pointers_with_files = (
        db.query(ContextPointer, ProjectFile)
        .join(ProjectFile, ContextPointer.file_id == ProjectFile.id)
        .filter(ProjectFile.project_id == session.project_id)
        .filter(ContextPointer.committed_at.isnot(None))  # Only committed pointers
        .all()
    )
    
    # Format pointers for the agent
    pointer_data = []
    pointer_lookup = {}  # id -> (pointer, file)
    for pointer, file in pointers_with_files:
        pointer_lookup[pointer.id] = (pointer, file)
        pointer_data.append({
            "id": pointer.id,
            "sheet_id": file.id,
            "sheet_name": file.name,
            "title": pointer.title,
            "description": pointer.description,
            "page_number": pointer.page_number,
            # AI Analysis fields
            "trade": pointer.ai_trade_category,
            "elements": pointer.ai_elements,
            "recommendations": pointer.ai_recommendations,
            "technical_description": pointer.ai_technical_description,
            # Text content for highlight matching
            "text_content": pointer.text_content,
        })
    
    # 4. Call the agent
    try:
        agent_response = await query_agent(
            user_query=data.query,
            conversation_history=conversation_history,
            context_pointers=pointer_data,
        )
    except Exception as e:
        # Log error and provide fallback response
        print(f"Agent error: {e}")
        agent_response = {
            "shortAnswer": "I encountered an issue processing your question. Please try again.",
            "narrative": f"Error: {str(e)}",
            "selectedPointers": [],
        }
    
    # 5. Create agent message record
    agent_message = AgentMessage(
        session_id=session_id,
        role="agent",
        content=agent_response.get("shortAnswer", ""),
        narrative=agent_response.get("narrative", ""),
    )
    db.add(agent_message)
    db.commit()
    db.refresh(agent_message)
    
    # 6. Create agent_message_pointer records for each selected pointer
    for selected in agent_response.get("selectedPointers", []):
        pointer_id = selected.get("id")
        if pointer_id and pointer_id in pointer_lookup:
            pointer, file = pointer_lookup[pointer_id]
            pointer_record = AgentMessagePointer(
                message_id=agent_message.id,
                context_pointer_id=pointer_id,
                sheet_id=file.id,
                sheet_name=file.name,
                reason=selected.get("reason", ""),
            )
            db.add(pointer_record)
    
    # 7. If this is the first message, auto-generate session title
    message_count = db.query(AgentMessage).filter(AgentMessage.session_id == session_id).count()
    if message_count <= 2 and not session.title:  # 2 = user message + agent response
        # Use first 50 chars of query as title
        session.title = data.query[:50] + ("..." if len(data.query) > 50 else "")
    
    # 8. Update session's updated_at
    session.updated_at = datetime.utcnow()
    db.commit()
    
    # Refresh agent message to get pointers
    db.refresh(agent_message)
    
    # 9. Extract highlights from agent response using ID-based lookup
    # Gather context pointers that were selected by the agent
    selected_pointer_ids = []
    for selected in agent_response.get("selectedPointers", []):
        pointer_id = selected.get("id")
        if pointer_id:
            selected_pointer_ids.append(pointer_id)
    
    # Get full pointer data with text_content for selected pointers
    selected_pointers_data = []
    for pointer_id in selected_pointer_ids:
        if pointer_id in pointer_lookup:
            pointer, file = pointer_lookup[pointer_id]
            selected_pointers_data.append({
                "id": pointer.id,
                "text_content": pointer.text_content
            })
    
    # Extract highlighted text element IDs from agent response JSON field
    highlighted_ids = agent_response.get("highlightedTextIds", [])
    
    # #region Debug logging: Highlighted IDs from JSON
    print("=== AGENT HIGHLIGHTED TEXT IDS ===")
    print(f"highlightedTextIds from JSON: {highlighted_ids}")
    print(f"Selected pointers count: {len(selected_pointers_data)}")
    # #endregion
    
    highlights = get_highlights_from_ids(highlighted_ids, selected_pointers_data)
    
    # 10. Return the agent message response
    # Need to reload with pointers relationship
    agent_message = (
        db.query(AgentMessage)
        .options(joinedload(AgentMessage.pointers))
        .filter(AgentMessage.id == agent_message.id)
        .first()
    )
    
    response = AgentMessageResponse.from_orm_model(agent_message)
    # Add highlights to response
    response.highlights = highlights
    return response

