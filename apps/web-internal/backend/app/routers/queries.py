"""
Queries router - voice query history and links to context pointers.
RBAC:
- Admin: full access.
- Superintendent: can only access own queries and only for assigned projects.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query as FQuery, Body
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Query as QueryModel, QueryResult as QueryResultModel, UserProject, Project, User, ContextPointer, ProjectFile
from ..schemas import (
    QueryCreate,
    QueryResponse,
    QueryWithResultsResponse,
    QueryResultResponse,
    QueryResultBase,
    QueryResultWithPointerResponse,
    ContextPointerResponse,
    EnhancedQueryResponse,
    ContextPointerResultResponse,
)
from ..security import get_current_user
from ..services.grok_service import query_grok

router = APIRouter()


def _is_admin(user: User) -> bool:
    return user.role == "admin"


def _require_project_assignment(db: Session, user_id: str, project_id: str) -> None:
    assignment = (
        db.query(UserProject)
        .filter(UserProject.user_id == user_id, UserProject.project_id == project_id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=403, detail="User is not assigned to this project")


def _require_query_access(db: Session, current_user: User, q: QueryModel) -> None:
    if _is_admin(current_user):
        return
    if q.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    _require_project_assignment(db, current_user.id, q.project_id)


@router.get("/queries", response_model=List[QueryResponse])
def list_queries(
    user_id: Optional[str] = FQuery(None, alias="user_id"),
    project_id: Optional[str] = FQuery(None, alias="project_id"),
    limit: int = FQuery(50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List queries with optional filters."""
    q = db.query(QueryModel)

    if _is_admin(current_user):
        if user_id:
            q = q.filter(QueryModel.user_id == user_id)
        if project_id:
            q = q.filter(QueryModel.project_id == project_id)
    else:
        # Superintendent: only self + assigned projects
        q = q.filter(QueryModel.user_id == current_user.id)
        if project_id:
            _require_project_assignment(db, current_user.id, project_id)
            q = q.filter(QueryModel.project_id == project_id)
        else:
            assigned_ids = [
                up.project_id
                for up in db.query(UserProject).filter(UserProject.user_id == current_user.id).all()
            ]
            if not assigned_ids:
                return []
            q = q.filter(QueryModel.project_id.in_(assigned_ids))

    return q.order_by(QueryModel.created_at.desc()).limit(limit).all()


@router.post("/queries", response_model=EnhancedQueryResponse, status_code=201)
async def create_query(
    data: QueryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new query and process it with Grok 4.1 Fast.
    
    Flow:
    1. Fetch ALL context pointers for the project
    2. Send everything to Grok
    3. Save query + results to database
    4. Return enhanced response with context pointers and narrative
    """
    # #region agent log
    _debug_log("queries.py:create_query:entry", "Entered create_query endpoint", {"user_id": data.user_id, "project_id": data.project_id, "transcript": data.transcript[:50] if data.transcript else None, "current_user_id": current_user.id}, "H5")
    # #endregion
    # Verify project exists
    project = db.query(Project).filter(Project.id == data.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    user_id = data.user_id
    if not _is_admin(current_user):
        user_id = current_user.id
        _require_project_assignment(db, current_user.id, data.project_id)
    else:
        # Verify user exists when admin sets user_id
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    # 1. Fetch COMMITTED context pointers for this project via ProjectFile join
    # Only pointers that have been committed to ViewM4D are available for queries
    pointers_with_files = (
        db.query(ContextPointer, ProjectFile)
        .join(ProjectFile, ContextPointer.file_id == ProjectFile.id)
        .filter(ProjectFile.project_id == data.project_id)
        .filter(ContextPointer.committed_at.isnot(None))  # Only committed pointers
        .all()
    )
    
    if not pointers_with_files:
        # No committed pointers - create query record and return empty response
        db_query = QueryModel(
            user_id=user_id,
            project_id=data.project_id,
            transcript=data.transcript,
            response="No committed context pointers found for this project. Make sure the plans have been processed and committed.",
        )
        db.add(db_query)
        db.commit()
        db.refresh(db_query)
        
        return EnhancedQueryResponse(
            id=db_query.id,
            query=data.transcript,
            context_pointers=[],
            narrative="No committed context pointers found for this project. Make sure the plans have been processed and committed.",
            created_at=db_query.created_at,
        )
    
    # 2. Format pointers for the agent (including AI analysis and bounding box)
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
            # Bounding box (normalized coordinates)
            "bounds": {
                "x": pointer.bounds_x,
                "y": pointer.bounds_y,
                "width": pointer.bounds_w,
                "height": pointer.bounds_h,
            },
            # AI Analysis fields (may be None if not yet processed)
            "trade": pointer.ai_trade_category,
            "elements": pointer.ai_elements,
            "recommendations": pointer.ai_recommendations,
            "technical_description": pointer.ai_technical_description,
        })
    
    # 3. Send to Grok
    # #region agent log
    _debug_log("queries.py:create_query:before_grok", "About to call Grok API", {"pointer_count": len(pointer_data), "query": data.transcript[:50] if data.transcript else None}, "H5")
    # #endregion
    try:
        agent_response = await query_grok(
            user_query=data.transcript,
            context_pointers=pointer_data
        )
        # #region agent log
        _debug_log("queries.py:create_query:grok_success", "Grok API succeeded", {"has_narrative": bool(agent_response.get("narrative")), "pointer_count": len(agent_response.get("selectedPointers", []))}, "H5")
        # #endregion
    except Exception as e:
        # Log the error, return graceful failure
        # #region agent log
        _debug_log("queries.py:create_query:grok_error", "Grok API FAILED", {"error": str(e), "error_type": type(e).__name__}, "H5")
        # #endregion
        print(f"Grok API error: {e}")
        
        db_query = QueryModel(
            user_id=user_id,
            project_id=data.project_id,
            transcript=data.transcript,
            response="Something went wrong processing your question. Please try again.",
        )
        db.add(db_query)
        db.commit()
        db.refresh(db_query)
        
        return EnhancedQueryResponse(
            id=db_query.id,
            query=data.transcript,
            context_pointers=[],
            narrative="Something went wrong processing your question. Please try again.",
            created_at=db_query.created_at,
        )
    
    # 4. Create query record with narrative
    narrative = agent_response.get("narrative", "")
    db_query = QueryModel(
        user_id=user_id,
        project_id=data.project_id,
        transcript=data.transcript,
        response=narrative,
    )
    db.add(db_query)
    db.commit()
    db.refresh(db_query)
    
    # 5. Map agent's selected pointers back to full data and save results
    selected_pointers: List[ContextPointerResultResponse] = []
    
    for i, selected in enumerate(agent_response.get("selectedPointers", [])):
        pointer_id = selected.get("id")
        if pointer_id and pointer_id in pointer_lookup:
            pointer, file = pointer_lookup[pointer_id]
            reason = selected.get("reason", "")
            
            # Save to query_results table
            result = QueryResultModel(
                query_id=db_query.id,
                context_pointer_id=pointer_id,
                relevance_score=1.0 - (i * 0.05),  # Order-based score
                reason=reason,
            )
            db.add(result)
            
            # Build response object
            selected_pointers.append(ContextPointerResultResponse(
                id=pointer_id,
                sheet_id=file.id,
                sheet_name=file.name,
                reason=reason,
                bbox={
                    "x": pointer.bounds_x,
                    "y": pointer.bounds_y,
                    "width": pointer.bounds_w,
                    "height": pointer.bounds_h,
                },
            ))
    
    db.commit()
    
    # 6. Return enhanced response
    return EnhancedQueryResponse(
        id=db_query.id,
        query=data.transcript,
        context_pointers=selected_pointers,
        narrative=narrative,
        created_at=db_query.created_at,
    )


@router.get("/queries/{query_id}", response_model=QueryWithResultsResponse)
def get_query(
    query_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a query with linked results (no pointer expansion)."""
    # #region agent log
    _debug_log("queries.py:get_query:entry", "Entered get_query endpoint - possible route conflict!", {"query_id": query_id, "current_user_id": current_user.id}, "H1")
    # #endregion
    q = (
        db.query(QueryModel)
        .options(joinedload(QueryModel.results))
        .filter(QueryModel.id == query_id)
        .first()
    )
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    return QueryWithResultsResponse(
        id=q.id,
        user_id=q.user_id,
        project_id=q.project_id,
        transcript=q.transcript,
        response=q.response,
        created_at=q.created_at,
        results=[QueryResultResponse.model_validate(r) for r in (q.results or [])],
    )


@router.patch("/queries/{query_id}/response", response_model=QueryResponse)
def update_query_response(
    query_id: str,
    response: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the AI response text for a query."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    q.response = response
    db.commit()
    db.refresh(q)
    return q


@router.delete("/queries/{query_id}", status_code=204)
def delete_query(
    query_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a query and its results."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    db.delete(q)
    db.commit()
    return None


@router.post("/queries/{query_id}/results", response_model=QueryResultResponse, status_code=201)
def add_result(
    query_id: str,
    data: QueryResultBase,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a single result to a query."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    pointer = db.query(ContextPointer).filter(ContextPointer.id == data.context_pointer_id).first()
    if not pointer:
        raise HTTPException(status_code=404, detail="Context pointer not found")

    result = QueryResultModel(
        query_id=query_id,
        context_pointer_id=data.context_pointer_id,
        relevance_score=data.relevance_score,
        reason=data.reason,
    )
    db.add(result)
    db.commit()
    db.refresh(result)
    return result


@router.post("/queries/{query_id}/results/bulk", response_model=List[QueryResultResponse], status_code=201)
def bulk_add_results(
    query_id: str,
    data: List[QueryResultBase],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add multiple results to a query."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    results: List[QueryResultModel] = []
    for item in data:
        pointer = db.query(ContextPointer).filter(ContextPointer.id == item.context_pointer_id).first()
        if not pointer:
            raise HTTPException(status_code=404, detail=f"Context pointer not found: {item.context_pointer_id}")
        r = QueryResultModel(
            query_id=query_id,
            context_pointer_id=item.context_pointer_id,
            relevance_score=item.relevance_score,
            reason=item.reason,
        )
        db.add(r)
        results.append(r)

    db.commit()
    for r in results:
        db.refresh(r)
    return results


@router.get("/queries/{query_id}/results", response_model=List[QueryResultWithPointerResponse])
def get_results_with_pointers(
    query_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get results for a query with expanded context pointer data."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    results = (
        db.query(QueryResultModel)
        .options(joinedload(QueryResultModel.context_pointer))
        .filter(QueryResultModel.query_id == query_id)
        .all()
    )

    out: List[QueryResultWithPointerResponse] = []
    for r in results:
        if not r.context_pointer:
            # Shouldn't happen unless pointer was deleted; skip gracefully.
            continue
        out.append(
            QueryResultWithPointerResponse(
                id=r.id,
                query_id=r.query_id,
                context_pointer_id=r.context_pointer_id,
                relevance_score=r.relevance_score,
                reason=r.reason,
                context_pointer=ContextPointerResponse.from_orm_model(r.context_pointer),
            )
        )
    return out


@router.delete("/queries/{query_id}/results/{result_id}", status_code=204)
def delete_result(
    query_id: str,
    result_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Remove a single result from a query."""
    q = db.query(QueryModel).filter(QueryModel.id == query_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Query not found")
    _require_query_access(db, current_user, q)

    r = db.query(QueryResultModel).filter(QueryResultModel.id == result_id, QueryResultModel.query_id == query_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Result not found")
    db.delete(r)
    db.commit()
    return None

# #region agent log
import json as _json
from pathlib import Path as _Path
def _debug_log(location, message, data, hypothesis_id):
    try:
        log_path = _Path(r"c:\Users\Sean Schneidewent\Maestro4D\.cursor\debug.log")
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {"location": location, "message": message, "data": data, "timestamp": __import__("time").time() * 1000, "sessionId": "debug-session", "hypothesisId": hypothesis_id}
        with open(log_path, "a") as f:
            f.write(_json.dumps(entry) + "\n")
    except Exception:
        pass
# #endregion

@router.get("/queries/user/{user_id}/history", response_model=List[EnhancedQueryResponse])
def user_history(
    user_id: str,
    project_id: Optional[str] = FQuery(None, alias="project_id"),
    limit: int = FQuery(20),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Query history for the ViewM4D panel with full pointer data for reload.
    Returns EnhancedQueryResponse format matching what create_query returns.
    """
    # #region agent log
    _debug_log("queries.py:user_history:entry", "Entered user_history endpoint", {"user_id": user_id, "project_id": project_id, "limit": limit, "current_user_id": current_user.id, "current_user_role": current_user.role}, "H3")
    # #endregion
    try:
        target_user_id = user_id
        q = db.query(QueryModel)

        # #region agent log
        _debug_log("queries.py:user_history:check_admin", "Checking admin status", {"is_admin": _is_admin(current_user), "role": current_user.role}, "H3")
        # #endregion

        if _is_admin(current_user):
            q = q.filter(QueryModel.user_id == target_user_id)
            if project_id:
                q = q.filter(QueryModel.project_id == project_id)
        else:
            target_user_id = current_user.id
            q = q.filter(QueryModel.user_id == target_user_id)
            if project_id:
                # #region agent log
                _debug_log("queries.py:user_history:require_assignment", "Checking project assignment", {"user_id": current_user.id, "project_id": project_id}, "H3")
                # #endregion
                _require_project_assignment(db, current_user.id, project_id)
                q = q.filter(QueryModel.project_id == project_id)
            else:
                assigned_ids = [
                    up.project_id
                    for up in db.query(UserProject).filter(UserProject.user_id == current_user.id).all()
                ]
                if not assigned_ids:
                    return []
                q = q.filter(QueryModel.project_id.in_(assigned_ids))

        # #region agent log
        _debug_log("queries.py:user_history:before_query", "About to execute main query", {"target_user_id": target_user_id}, "H3")
        # #endregion

        queries = q.order_by(QueryModel.created_at.desc()).limit(limit).all()
        
        # #region agent log
        _debug_log("queries.py:user_history:after_query", "Query executed", {"query_count": len(queries)}, "H3")
        # #endregion
        
        results: List[EnhancedQueryResponse] = []
        for idx, query_record in enumerate(queries):
            # Get the associated results with pointers
            query_results = (
                db.query(QueryResultModel, ContextPointer, ProjectFile)
                .join(ContextPointer, QueryResultModel.context_pointer_id == ContextPointer.id)
                .join(ProjectFile, ContextPointer.file_id == ProjectFile.id)
                .filter(QueryResultModel.query_id == query_record.id)
                .order_by(QueryResultModel.relevance_score.desc())
                .all()
            )
            
            # Build context pointers list
            context_pointers: List[ContextPointerResultResponse] = []
            for qr, pointer, file in query_results:
                context_pointers.append(ContextPointerResultResponse(
                    id=pointer.id,
                    sheet_id=file.id,
                    sheet_name=file.name,
                    reason=qr.reason or "",
                    bbox={
                        "x": pointer.bounds_x,
                        "y": pointer.bounds_y,
                        "width": pointer.bounds_w,
                        "height": pointer.bounds_h,
                    },
                ))
            
            results.append(EnhancedQueryResponse(
                id=query_record.id,
                query=query_record.transcript,
                context_pointers=context_pointers,
                narrative=query_record.response or "",
                created_at=query_record.created_at,
            ))
    
        # #region agent log
        _debug_log("queries.py:user_history:success", "Returning results", {"result_count": len(results)}, "H3")
        # #endregion
        return results
    except Exception as e:
        # #region agent log
        _debug_log("queries.py:user_history:exception", "Exception in user_history", {"error": str(e), "error_type": type(e).__name__}, "H3")
        # #endregion
        raise

