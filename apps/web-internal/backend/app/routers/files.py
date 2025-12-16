"""
Files router - File upload, download, and tree operations for ProjectFile and ScanFile.
"""
import os
import shutil
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, Scan, ProjectFile, ScanFile

from ..schemas import (
    ProjectFileResponse, ProjectFileTreeNode,
    ScanFileResponse
)

router = APIRouter()

# Upload directories
UPLOAD_BASE = Path(__file__).parent.parent.parent / "uploads"
PROJECT_UPLOADS = UPLOAD_BASE / "projects"
SCAN_UPLOADS = UPLOAD_BASE / "scans"


def ensure_upload_dirs():
    """Ensure upload directories exist."""
    PROJECT_UPLOADS.mkdir(parents=True, exist_ok=True)
    SCAN_UPLOADS.mkdir(parents=True, exist_ok=True)


def build_file_tree(files: List[ProjectFile], parent_id: Optional[str] = None) -> List[ProjectFileTreeNode]:
    """Build recursive tree structure from flat file list."""
    tree = []
    for f in files:
        if f.parent_id == parent_id:
            node = ProjectFileTreeNode(
                id=f.id,
                name=f.name,
                is_folder=f.is_folder,
                file_type=f.file_type,
                size=f.size,
                children=[],
            )
            if f.is_folder:
                node.children = build_file_tree(files, f.id)
            tree.append(node)
    # Sort: folders first, then alphabetically
    return sorted(tree, key=lambda x: (not x.is_folder, x.name.lower()))


# =============================================================================
# Project Files
# =============================================================================

@router.get("/projects/{project_id}/files", response_model=List[ProjectFileResponse])
def list_project_files(project_id: str, db: Session = Depends(get_db)):
    """List all files for a project (flat list)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    files = db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()
    return files


@router.get("/projects/{project_id}/files/tree", response_model=List[ProjectFileTreeNode])
def get_project_file_tree(project_id: str, db: Session = Depends(get_db)):
    """Get project files as a tree structure."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    files = db.query(ProjectFile).filter(ProjectFile.project_id == project_id).all()
    return build_file_tree(files)


@router.post("/projects/{project_id}/files", response_model=ProjectFileResponse, status_code=201)
async def upload_project_file(
    project_id: str,
    file: UploadFile = File(...),
    parent_id: Optional[str] = Query(None, alias="parentId"),
    db: Session = Depends(get_db)
):
    """Upload a file to a project."""
    ensure_upload_dirs()
    
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Verify parent exists if specified
    if parent_id:
        parent = db.query(ProjectFile).filter(
            ProjectFile.id == parent_id,
            ProjectFile.project_id == project_id,
            ProjectFile.is_folder == True
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
    
    # Create project upload directory
    project_dir = PROJECT_UPLOADS / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    
    # Save file to disk
    file_path = project_dir / file.filename
    
    # Create parent directories if file has nested path (e.g., "subfolder/file.pdf")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Determine file type from extension
    ext = Path(file.filename).suffix.lower().lstrip(".")
    file_type = ext if ext else None
    
    # Get file size
    file_size = os.path.getsize(file_path)
    
    # Create database record
    db_file = ProjectFile(
        project_id=project_id,
        name=file.filename,
        path=str(file_path),
        file_type=file_type,
        size=file_size,
        parent_id=parent_id,
        is_folder=False,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    
    return db_file


@router.post("/projects/{project_id}/folders", response_model=ProjectFileResponse, status_code=201)
def create_project_folder(
    project_id: str,
    name: str = Query(...),
    parent_id: Optional[str] = Query(None, alias="parentId"),
    db: Session = Depends(get_db)
):
    """Create a folder in a project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Verify parent exists if specified
    if parent_id:
        parent = db.query(ProjectFile).filter(
            ProjectFile.id == parent_id,
            ProjectFile.project_id == project_id,
            ProjectFile.is_folder == True
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
    
    # Create folder record (no actual disk folder needed)
    db_folder = ProjectFile(
        project_id=project_id,
        name=name,
        path=f"virtual://{project_id}/{name}",  # Virtual path for folders
        file_type="folder",
        parent_id=parent_id,
        is_folder=True,
    )
    db.add(db_folder)
    db.commit()
    db.refresh(db_folder)
    
    return db_folder


# =============================================================================
# Individual File Operations
# =============================================================================

@router.get("/files/{file_id}", response_model=ProjectFileResponse)
def get_file(file_id: str, db: Session = Depends(get_db)):
    """Get file metadata."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return file


@router.get("/files/{file_id}/download")
def download_file(file_id: str, db: Session = Depends(get_db)):
    """Download a file."""
    import json, time
    log_path = r"c:\Users\Sean Schneidewent\Maestro4D\apps\web-internal\.cursor\debug.log"
    
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # #region agent log
    try:
        with open(log_path, "a") as lf:
            lf.write(json.dumps({"location":"files.py:download_file:start","message":"Download requested","data":{"file_id":file_id,"name":file.name,"path":file.path,"exists":os.path.exists(file.path)},"timestamp":int(time.time()*1000),"sessionId":"debug-session","hypothesisId":"H1-H3"})+"\n")
    except: pass
    # #endregion
    
    if file.is_folder:
        raise HTTPException(status_code=400, detail="Cannot download a folder")
    
    if not os.path.exists(file.path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    # Extract just the filename (without path components) for Content-Disposition header
    safe_filename = Path(file.name).name
    
    # #region agent log
    try:
        with open(log_path, "a") as lf:
            lf.write(json.dumps({"location":"files.py:download_file:serving","message":"Serving file","data":{"original_name":file.name,"safe_filename":safe_filename,"path":file.path},"timestamp":int(time.time()*1000),"sessionId":"debug-session","hypothesisId":"H1"})+"\n")
    except: pass
    # #endregion
    
    return FileResponse(
        path=file.path,
        filename=safe_filename,
        media_type="application/octet-stream"
    )


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str, db: Session = Depends(get_db)):
    """Delete a file or folder."""
    file = db.query(ProjectFile).filter(ProjectFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete physical file if it exists and is not a folder
    if not file.is_folder and os.path.exists(file.path):
        os.remove(file.path)
    
    db.delete(file)
    db.commit()
    return None


# =============================================================================
# Scan Files
# =============================================================================

@router.get("/scans/{scan_id}/files", response_model=List[ScanFileResponse])
def list_scan_files(scan_id: str, db: Session = Depends(get_db)):
    """List all files for a scan."""
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    files = db.query(ScanFile).filter(ScanFile.scan_id == scan_id).all()
    return files


@router.post("/scans/{scan_id}/files", response_model=ScanFileResponse, status_code=201)
async def upload_scan_file(
    scan_id: str,
    file: UploadFile = File(...),
    parent_id: Optional[str] = Query(None, alias="parentId"),
    db: Session = Depends(get_db)
):
    """Upload a file to a scan."""
    ensure_upload_dirs()
    
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    
    # Verify parent exists if specified
    if parent_id:
        parent = db.query(ScanFile).filter(
            ScanFile.id == parent_id,
            ScanFile.scan_id == scan_id,
            ScanFile.is_folder == True
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
    
    # Create scan upload directory
    scan_dir = SCAN_UPLOADS / scan_id
    scan_dir.mkdir(parents=True, exist_ok=True)
    
    # Save file to disk
    file_path = scan_dir / file.filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Determine file type from extension
    ext = Path(file.filename).suffix.lower().lstrip(".")
    file_type = ext if ext else None
    
    # Get file size
    file_size = os.path.getsize(file_path)
    
    # Create database record
    db_file = ScanFile(
        scan_id=scan_id,
        name=file.filename,
        path=str(file_path),
        file_type=file_type,
        size=file_size,
        parent_id=parent_id,
        is_folder=False,
    )
    db.add(db_file)
    db.commit()
    db.refresh(db_file)
    
    return db_file


@router.get("/scan-files/{file_id}", response_model=ScanFileResponse)
def get_scan_file(file_id: str, db: Session = Depends(get_db)):
    """Get scan file metadata."""
    file = db.query(ScanFile).filter(ScanFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return file


@router.get("/scan-files/{file_id}/download")
def download_scan_file(file_id: str, db: Session = Depends(get_db)):
    """Download a scan file."""
    file = db.query(ScanFile).filter(ScanFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    if file.is_folder:
        raise HTTPException(status_code=400, detail="Cannot download a folder")
    
    if not os.path.exists(file.path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    
    return FileResponse(
        path=file.path,
        filename=file.name,
        media_type="application/octet-stream"
    )


@router.delete("/scan-files/{file_id}", status_code=204)
def delete_scan_file(file_id: str, db: Session = Depends(get_db)):
    """Delete a scan file."""
    file = db.query(ScanFile).filter(ScanFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete physical file if it exists and is not a folder
    if not file.is_folder and os.path.exists(file.path):
        os.remove(file.path)
    
    db.delete(file)
    db.commit()
    return None

