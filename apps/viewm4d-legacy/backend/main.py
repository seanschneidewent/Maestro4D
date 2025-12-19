"""
ViewM4D - Construction Plan Retrieval Agent
FastAPI backend for superintendent queries
"""

import os
import json
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import google.generativeai as genai

# ============================================================
# Configuration
# ============================================================

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
PLANS_DIR = Path(os.getenv("PLANS_DIR", "./plans"))
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="ViewM4D", description="Construction Plan Retrieval Agent")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Frontend directory
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

# ============================================================
# Data Models
# ============================================================

class SearchQuery(BaseModel):
    query: str
    project_id: str
    max_results: int = 5

class BoundingBox(BaseModel):
    xNorm: float
    yNorm: float
    wNorm: float
    hNorm: float

class PointerResult(BaseModel):
    pointer_id: str
    sheet_id: str
    file_name: str
    title: str
    bounding_box: BoundingBox
    description: str
    trade_category: str
    relevance_reason: str

class SearchResponse(BaseModel):
    query: str
    results: list[PointerResult]
    total_pointers_searched: int

# ============================================================
# Data Loading
# ============================================================

def load_project_data(project_id: str) -> dict:
    """Load the processed results.json for a project"""
    project_path = DATA_DIR / project_id / "results.json"
    if not project_path.exists():
        raise HTTPException(status_code=404, detail=f"Project not found: {project_id}")
    
    with open(project_path) as f:
        return json.load(f)

def get_all_pointers(project_data: dict) -> list[dict]:
    """Flatten all pointers from all sheets"""
    pointers = []
    for sheet in project_data.get("sheets", []):
        for pointer in sheet.get("pointers", []):
            pointers.append({
                "pointer_id": pointer["id"],
                "sheet_id": sheet["sheetId"],
                "file_name": sheet["fileName"],
                "title": pointer["originalMetadata"].get("title", ""),
                "description": pointer["originalMetadata"].get("description", ""),
                "bounding_box": pointer["originalMetadata"].get("boundingBox"),
                "technical_description": pointer["aiAnalysis"].get("technicalDescription", ""),
                "trade_category": pointer["aiAnalysis"].get("tradeCategory", ""),
                "transcribed_text": pointer["aiAnalysis"].get("transcribedText", []),
                "identified_elements": pointer["aiAnalysis"].get("identifiedElements", [])
            })
    return pointers

# ============================================================
# Gemini Search
# ============================================================

def build_search_prompt(query: str, pointers: list[dict], max_results: int) -> str:
    """Build the prompt for Gemini to find relevant pointers"""
    
    pointer_summaries = []
    for i, p in enumerate(pointers):
        summary = f"""
[{i}] ID: {p['pointer_id']}
Sheet: {p['file_name']}
Title: {p['title']}
Trade: {p['trade_category']}
Description: {p['technical_description']}
Content: {' '.join(p['transcribed_text'][:5]) if p['transcribed_text'] else 'N/A'}
"""
        pointer_summaries.append(summary)
    
    return f"""You are a construction document retrieval system. A superintendent is looking for specific information in the construction plans.

SUPERINTENDENT'S QUESTION:
"{query}"

AVAILABLE DOCUMENT SECTIONS:
{chr(10).join(pointer_summaries)}

TASK:
Find the {max_results} most relevant document sections that answer the superintendent's question.
Return ONLY a JSON array with objects containing:
- "index": the bracket number [X] of the relevant section
- "reason": brief explanation of why this section is relevant (1 sentence)

Example response format:
[
  {{"index": 0, "reason": "Contains ADA accessibility requirements for bathrooms"}},
  {{"index": 3, "reason": "Shows door hardware mounting heights"}}
]

If no sections are relevant, return an empty array: []

Return ONLY valid JSON, no other text."""

async def search_with_gemini(query: str, pointers: list[dict], max_results: int) -> list[dict]:
    """Use Gemini to find relevant pointers"""
    
    if not GEMINI_API_KEY:
        return keyword_fallback_search(query, pointers, max_results)
    
    model = genai.GenerativeModel("gemini-2.0-flash")
    prompt = build_search_prompt(query, pointers, max_results)
    
    try:
        response = model.generate_content(prompt)
        response_text = response.text.strip()
        
        if response_text.startswith("```"):
            response_text = response_text.split("```")[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
        response_text = response_text.strip()
        
        matches = json.loads(response_text)
        
        results = []
        for match in matches[:max_results]:
            idx = match.get("index")
            if idx is not None and 0 <= idx < len(pointers):
                p = pointers[idx]
                results.append({
                    **p,
                    "relevance_reason": match.get("reason", "")
                })
        
        return results
        
    except Exception as e:
        print(f"Gemini search error: {e}")
        return keyword_fallback_search(query, pointers, max_results)

def keyword_fallback_search(query: str, pointers: list[dict], max_results: int) -> list[dict]:
    """Simple keyword matching fallback"""
    query_lower = query.lower()
    query_words = set(query_lower.split())
    
    scored = []
    for p in pointers:
        searchable = f"{p['title']} {p['technical_description']} {p['trade_category']} {' '.join(p['transcribed_text'])}"
        searchable_lower = searchable.lower()
        
        score = sum(1 for word in query_words if word in searchable_lower)
        if score > 0:
            scored.append((score, p))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    
    results = []
    for score, p in scored[:max_results]:
        results.append({
            **p,
            "relevance_reason": "Keyword match"
        })
    
    return results

# ============================================================
# API Routes
# ============================================================

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ViewM4D Retrieval Agent"}

@app.get("/api/projects")
async def list_projects():
    """List available projects"""
    if not DATA_DIR.exists():
        return {"projects": []}
    
    projects = []
    for item in DATA_DIR.iterdir():
        if item.is_dir() and (item / "results.json").exists():
            projects.append({"id": item.name})
    
    return {"projects": projects}

@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    """Get project metadata and sheet list"""
    data = load_project_data(project_id)
    
    sheets = []
    for sheet in data.get("sheets", []):
        sheets.append({
            "sheet_id": sheet["sheetId"],
            "file_name": sheet["fileName"],
            "pointer_count": len(sheet.get("pointers", []))
        })
    
    return {
        "project_id": project_id,
        "batch_id": data.get("batchId"),
        "processed_at": data.get("processedAt"),
        "sheets": sheets,
        "total_pointers": sum(s["pointer_count"] for s in sheets)
    }

@app.post("/api/search", response_model=SearchResponse)
async def search(request: SearchQuery):
    """Search for relevant pointers based on natural language query"""
    
    data = load_project_data(request.project_id)
    pointers = get_all_pointers(data)
    
    if not pointers:
        return SearchResponse(
            query=request.query,
            results=[],
            total_pointers_searched=0
        )
    
    matches = await search_with_gemini(request.query, pointers, request.max_results)
    
    results = []
    for m in matches:
        if m.get("bounding_box"):
            results.append(PointerResult(
                pointer_id=m["pointer_id"],
                sheet_id=m["sheet_id"],
                file_name=m["file_name"],
                title=m["title"],
                bounding_box=BoundingBox(**m["bounding_box"]),
                description=m["technical_description"],
                trade_category=m["trade_category"],
                relevance_reason=m.get("relevance_reason", "")
            ))
    
    return SearchResponse(
        query=request.query,
        results=results,
        total_pointers_searched=len(pointers)
    )

@app.get("/api/sheets/{project_id}/{sheet_id}/pdf")
async def get_sheet_pdf(project_id: str, sheet_id: str):
    """Serve the sheet PDF for display"""
    data = load_project_data(project_id)
    
    for sheet in data.get("sheets", []):
        if sheet["sheetId"] == sheet_id:
            file_name = sheet["fileName"]
            
            possible_paths = [
                PLANS_DIR / file_name,
                DATA_DIR / project_id / "plans" / file_name,
                DATA_DIR / project_id / file_name,
            ]
            
            for pdf_path in possible_paths:
                if pdf_path.exists():
                    return FileResponse(
                        pdf_path, 
                        media_type="application/pdf",
                        headers={"Content-Disposition": f"inline; filename={pdf_path.name}"}
                    )
            
            raise HTTPException(
                status_code=404, 
                detail=f"PDF not found. Searched: {[str(p) for p in possible_paths]}"
            )
    
    raise HTTPException(status_code=404, detail=f"Sheet not found: {sheet_id}")

# ============================================================
# Serve Frontend (this must be last)
# ============================================================

@app.get("/")
async def serve_root():
    """Serve frontend at root"""
    return FileResponse(FRONTEND_DIR / "index.html")

# ============================================================
# Run
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)