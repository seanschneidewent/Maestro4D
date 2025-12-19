"""
Users router - authentication, user CRUD, and user-project assignments.
Note: Auth checks removed for internal admin tool use.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query as FQuery
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import User, UserProject, Project
from ..schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserWithProjectsResponse,
    UserProjectResponse,
    LoginRequest,
    LoginResponse,
    ProjectResponse,
)
from ..security import (
    hash_password,
    verify_password,
    create_access_token,
)

router = APIRouter()


def _validate_role(role: str) -> None:
    if role not in ("admin", "superintendent"):
        raise HTTPException(status_code=400, detail="Invalid role")


@router.post("/users/login", response_model=LoginResponse)
def login(data: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate by email/password and return JWT."""
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user_id=user.id, role=user.role)
    return LoginResponse(user=UserResponse.model_validate(user), token=token)


@router.get("/users", response_model=List[UserResponse])
def list_users(
    role: Optional[str] = FQuery(None),
    db: Session = Depends(get_db),
):
    """List all users."""
    q = db.query(User).order_by(User.created_at.desc())
    if role:
        _validate_role(role)
        q = q.filter(User.role == role)
    return q.all()


@router.post("/users", response_model=UserResponse, status_code=201)
def create_user(
    data: UserCreate,
    db: Session = Depends(get_db),
):
    """Create a user."""
    _validate_role(data.role)

    db_user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(db_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already exists")
    db.refresh(db_user)
    return db_user


@router.get("/users/{user_id}", response_model=UserWithProjectsResponse)
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
):
    """Get user with assigned projects."""
    user = db.query(User).options(joinedload(User.project_assignments)).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    project_ids = [a.project_id for a in (user.project_assignments or [])]
    projects = []
    if project_ids:
        projects = db.query(Project).filter(Project.id.in_(project_ids)).all()

    return UserWithProjectsResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        assigned_projects=[ProjectResponse.model_validate(p) for p in projects],
    )


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    update: UserUpdate,
    db: Session = Depends(get_db),
):
    """Update user fields."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if update.role is not None:
        _validate_role(update.role)
        user.role = update.role

    if update.name is not None:
        user.name = update.name
    if update.email is not None:
        user.email = update.email
    if update.password is not None:
        user.password_hash = hash_password(update.password)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already exists")
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, db: Session = Depends(get_db)):
    """Delete a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
    return None


@router.get("/users/{user_id}/projects", response_model=List[UserProjectResponse])
def list_user_projects(
    user_id: str,
    db: Session = Depends(get_db),
):
    """List project assignments for a user."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return (
        db.query(UserProject)
        .filter(UserProject.user_id == user_id)
        .order_by(UserProject.assigned_at.desc())
        .all()
    )


@router.post("/users/{user_id}/projects", response_model=UserProjectResponse, status_code=201)
def assign_user_to_project(
    user_id: str,
    project_id: str = FQuery(..., alias="project_id"),
    db: Session = Depends(get_db),
):
    """Assign a user to a project."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    assignment = UserProject(user_id=user_id, project_id=project_id)
    db.add(assignment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User is already assigned to this project")
    db.refresh(assignment)
    return assignment


@router.delete("/users/{user_id}/projects/{project_id}", status_code=204)
def unassign_user_from_project(user_id: str, project_id: str, db: Session = Depends(get_db)):
    """Remove a user-project assignment."""
    assignment = (
        db.query(UserProject)
        .filter(UserProject.user_id == user_id, UserProject.project_id == project_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    db.delete(assignment)
    db.commit()
    return None
