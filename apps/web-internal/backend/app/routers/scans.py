"""
Scans router - CRUD operations for scans.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Scan, Project
from ..schemas import (
    ScanCreate, ScanUpdate, ScanResponse, ScanDetailResponse,
    ScanFileResponse, InsightResponse
)

router = APIRouter()


@router.get("/scans", response_model=List[ScanResponse])
def list_scans(
    project_id: Optional[str] = Query(None, alias="projectId"),
    db: Session = Depends(get_db)
):
    """List scans, optionally filtered by project."""
    query = db.query(Scan)
    if project_id:
        query = query.filter(Scan.project_id == project_id)
    scans = query.order_by(Scan.created_at.desc()).all()
    return scans


@router.post("/scans", response_model=ScanResponse, status_code=201)
def create_scan(scan: ScanCreate, db: Session = Depends(get_db)):
    """Create a new scan."""
    # Verify project exists
    project = db.query(Project).filter(Project.id == scan.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_scan = Scan(
        project_id=scan.project_id,
        date=scan.date,
        model_url=scan.model_url,
        pdf_url=scan.pdf_url,
    )
    db.add(db_scan)
    db.commit()
    db.refresh(db_scan)
    return db_scan


@router.get("/scans/{scan_id}", response_model=ScanDetailResponse)
def get_scan(scan_id: str, db: Session = Depends(get_db)):
    """Get a scan with files and insights."""
    scan = db.query(Scan).options(
        joinedload(Scan.files),
        joinedload(Scan.insights),
    ).filter(Scan.id == scan_id).first()
    
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    files = [ScanFileResponse.model_validate(f) for f in scan.files]
    insights = [InsightResponse.model_validate(i) for i in scan.insights]
    
    return ScanDetailResponse(
        id=scan.id,
        project_id=scan.project_id,
        date=scan.date,
        model_url=scan.model_url,
        pdf_url=scan.pdf_url,
        created_at=scan.created_at,
        files=files,
        insights=insights,
    )


@router.patch("/scans/{scan_id}", response_model=ScanResponse)
def update_scan(scan_id: str, scan: ScanUpdate, db: Session = Depends(get_db)):
    """Update a scan."""
    db_scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    update_data = scan.model_dump(exclude_unset=True, by_alias=False)
    for field, value in update_data.items():
        setattr(db_scan, field, value)
    
    db.commit()
    db.refresh(db_scan)
    return db_scan


@router.delete("/scans/{scan_id}", status_code=204)
def delete_scan(scan_id: str, db: Session = Depends(get_db)):
    """Delete a scan and all related files and insights."""
    db_scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not db_scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    db.delete(db_scan)
    db.commit()
    return None

