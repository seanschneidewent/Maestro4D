"""
Projects router - CRUD operations for projects.
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Project, User, UserProject
from ..schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetailResponse,
    ScanResponse, ProjectFileResponse, AgentStateResponse, BatchSummaryResponse,
    UserResponse
)

router = APIRouter()


@router.get("/projects", response_model=List[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    """List all projects."""
    projects = db.query(Project).order_by(Project.updated_at.desc()).all()
    return projects


@router.post("/projects", response_model=ProjectResponse, status_code=201)
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    """Create a new project."""
    db_project = Project(
        name=project.name,
        status=project.status,
        progress=project.progress,
        image_url=project.image_url,
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@router.get("/projects/{project_id}", response_model=ProjectDetailResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    """Get a project with all relationships."""
    project = db.query(Project).options(
        joinedload(Project.scans),
        joinedload(Project.master_files),
        joinedload(Project.agent_states),
        joinedload(Project.batches),
    ).filter(Project.id == project_id).first()
    
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Build response with nested data
    scans = [ScanResponse.model_validate(s) for s in project.scans]
    master_files = [ProjectFileResponse.model_validate(f) for f in project.master_files]
    agent_states = [AgentStateResponse.model_validate(a) for a in project.agent_states]
    
    # Build batch summaries with counts
    batches = []
    for batch in project.batches:
        pointer_count = len(batch.processed_pointers)
        # Count unique sheet IDs
        sheet_ids = set(p.sheet_id for p in batch.processed_pointers)
        batches.append(BatchSummaryResponse(
            id=batch.id,
            project_id=batch.project_id,
            status=batch.status,
            processed_at=batch.processed_at,
            created_at=batch.created_at,
            pointer_count=pointer_count,
            sheet_count=len(sheet_ids),
        ))
    
    return ProjectDetailResponse(
        id=project.id,
        name=project.name,
        status=project.status,
        progress=project.progress,
        image_url=project.image_url,
        created_at=project.created_at,
        updated_at=project.updated_at,
        scans=scans,
        master_files=master_files,
        agent_states=agent_states,
        batches=batches,
    )


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, project: ProjectUpdate, db: Session = Depends(get_db)):
    """Update a project."""
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    update_data = project.model_dump(exclude_unset=True, by_alias=False)
    for field, value in update_data.items():
        setattr(db_project, field, value)
    
    db.commit()
    db.refresh(db_project)
    return db_project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    """Delete a project and all related data (cascade)."""
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if not db_project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db.delete(db_project)
    db.commit()
    return None


@router.get("/projects/{project_id}/users", response_model=List[UserResponse])
def list_project_users(project_id: str, db: Session = Depends(get_db)):
    """List all users assigned to a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Get user IDs from assignments
    assignments = db.query(UserProject).filter(UserProject.project_id == project_id).all()
    user_ids = [a.user_id for a in assignments]
    
    if not user_ids:
        return []
    
    users = db.query(User).filter(User.id.in_(user_ids)).order_by(User.name).all()
    return users

