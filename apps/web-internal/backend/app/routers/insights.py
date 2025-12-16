"""
Insights router - CRUD operations and status actions for insights.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Scan, Insight
from ..schemas import InsightCreate, InsightUpdate, InsightResponse

router = APIRouter()


@router.get("/insights", response_model=List[InsightResponse])
def list_insights(
    scan_id: Optional[str] = Query(None, alias="scanId"),
    severity: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """List insights with optional filters."""
    query = db.query(Insight)
    
    if scan_id:
        query = query.filter(Insight.scan_id == scan_id)
    if severity:
        query = query.filter(Insight.severity == severity)
    if status:
        query = query.filter(Insight.status == status)
    
    insights = query.order_by(Insight.created_at.desc()).all()
    return insights


@router.post("/insights", response_model=InsightResponse, status_code=201)
def create_insight(insight: InsightCreate, db: Session = Depends(get_db)):
    """Create a new insight."""
    # Verify scan exists
    scan = db.query(Scan).filter(Scan.id == insight.scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    db_insight = Insight(
        scan_id=insight.scan_id,
        type=insight.type,
        title=insight.title,
        summary=insight.summary,
        severity=insight.severity,
        status=insight.status,
        tags=insight.tags,
        notes=insight.notes,
        element_ids=insight.element_ids,
    )
    db.add(db_insight)
    db.commit()
    db.refresh(db_insight)
    
    return db_insight


@router.get("/insights/{insight_id}", response_model=InsightResponse)
def get_insight(insight_id: str, db: Session = Depends(get_db)):
    """Get an insight by ID."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    return insight


@router.patch("/insights/{insight_id}", response_model=InsightResponse)
def update_insight(
    insight_id: str,
    update: InsightUpdate,
    db: Session = Depends(get_db)
):
    """Update an insight."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    
    update_data = update.model_dump(exclude_unset=True, by_alias=False)
    for field, value in update_data.items():
        setattr(insight, field, value)
    
    db.commit()
    db.refresh(insight)
    
    return insight


@router.delete("/insights/{insight_id}", status_code=204)
def delete_insight(insight_id: str, db: Session = Depends(get_db)):
    """Delete an insight."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    
    db.delete(insight)
    db.commit()
    return None


# =============================================================================
# Status Actions
# =============================================================================

@router.post("/insights/{insight_id}/resolve", response_model=InsightResponse)
def resolve_insight(insight_id: str, db: Session = Depends(get_db)):
    """Mark an insight as resolved."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    
    insight.status = "resolved"
    db.commit()
    db.refresh(insight)
    
    return insight


@router.post("/insights/{insight_id}/dismiss", response_model=InsightResponse)
def dismiss_insight(insight_id: str, db: Session = Depends(get_db)):
    """Mark an insight as dismissed."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    
    insight.status = "dismissed"
    db.commit()
    db.refresh(insight)
    
    return insight


@router.post("/insights/{insight_id}/reopen", response_model=InsightResponse)
def reopen_insight(insight_id: str, db: Session = Depends(get_db)):
    """Reopen a resolved or dismissed insight."""
    insight = db.query(Insight).filter(Insight.id == insight_id).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")
    
    insight.status = "open"
    db.commit()
    db.refresh(insight)
    
    return insight

