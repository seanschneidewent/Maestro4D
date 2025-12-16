"""
Agents router - AgentState management with get-or-create pattern.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, AgentState
from ..schemas import (
    AgentStateUpdate, AgentStateResponse, Message, MessagePart
)

router = APIRouter()


@router.get("/agents/projects/{project_id}", response_model=List[AgentStateResponse])
def list_agent_states(project_id: str, db: Session = Depends(get_db)):
    """List all agent states for a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    agents = db.query(AgentState).filter(AgentState.project_id == project_id).all()
    return agents


@router.get("/agents/projects/{project_id}/{agent_type}", response_model=AgentStateResponse)
def get_agent_state(project_id: str, agent_type: str, db: Session = Depends(get_db)):
    """Get a specific agent state."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    agent = db.query(AgentState).filter(
        AgentState.project_id == project_id,
        AgentState.agent_type == agent_type
    ).first()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent state not found")
    
    return agent


@router.post("/agents/projects/{project_id}/{agent_type}", response_model=AgentStateResponse, status_code=201)
def create_or_get_agent_state(
    project_id: str,
    agent_type: str,
    db: Session = Depends(get_db)
):
    """Create or get existing agent state (get-or-create pattern)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Check if agent already exists
    agent = db.query(AgentState).filter(
        AgentState.project_id == project_id,
        AgentState.agent_type == agent_type
    ).first()
    
    if agent:
        return agent
    
    # Create new agent state
    agent = AgentState(
        project_id=project_id,
        agent_type=agent_type,
        chat_history=[],
        uploaded_files=[],
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    
    return agent


@router.patch("/agents/projects/{project_id}/{agent_type}", response_model=AgentStateResponse)
def update_agent_state(
    project_id: str,
    agent_type: str,
    update: AgentStateUpdate,
    db: Session = Depends(get_db)
):
    """Update agent state (chat_history, uploaded_files)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    agent = db.query(AgentState).filter(
        AgentState.project_id == project_id,
        AgentState.agent_type == agent_type
    ).first()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent state not found")
    
    if update.chat_history is not None:
        # Convert Pydantic models to dicts for JSON storage
        agent.chat_history = [m.model_dump() for m in update.chat_history]
    if update.uploaded_files is not None:
        agent.uploaded_files = [f.model_dump(by_alias=True) for f in update.uploaded_files]
    
    db.commit()
    db.refresh(agent)
    
    return agent


@router.post("/agents/projects/{project_id}/{agent_type}/message", response_model=AgentStateResponse)
def add_message(
    project_id: str,
    agent_type: str,
    role: str = Query(..., description="Message role: 'user' or 'model'"),
    content: str = Query(..., description="Message text content"),
    db: Session = Depends(get_db)
):
    """Add a single message to the agent's chat history."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    agent = db.query(AgentState).filter(
        AgentState.project_id == project_id,
        AgentState.agent_type == agent_type
    ).first()
    
    if not agent:
        # Create agent if it doesn't exist
        agent = AgentState(
            project_id=project_id,
            agent_type=agent_type,
            chat_history=[],
            uploaded_files=[],
        )
        db.add(agent)
    
    # Add the new message
    new_message = Message(
        role=role,
        parts=[MessagePart(text=content)]
    )
    
    # Ensure chat_history is a list
    if agent.chat_history is None:
        agent.chat_history = []
    
    # Append the new message
    chat_history = list(agent.chat_history)
    chat_history.append(new_message.model_dump())
    agent.chat_history = chat_history
    
    db.commit()
    db.refresh(agent)
    
    return agent


@router.delete("/agents/projects/{project_id}/{agent_type}/history", response_model=AgentStateResponse)
def clear_chat_history(
    project_id: str,
    agent_type: str,
    db: Session = Depends(get_db)
):
    """Clear agent's chat history."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    agent = db.query(AgentState).filter(
        AgentState.project_id == project_id,
        AgentState.agent_type == agent_type
    ).first()
    
    if not agent:
        raise HTTPException(status_code=404, detail="Agent state not found")
    
    agent.chat_history = []
    
    db.commit()
    db.refresh(agent)
    
    return agent

