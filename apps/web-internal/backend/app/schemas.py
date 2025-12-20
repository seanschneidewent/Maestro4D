"""
Pydantic schemas for request/response validation.
Uses Field(alias=...) for camelCase JSON serialization to match TypeScript frontend.
"""
from datetime import datetime
from typing import Optional, List, Any, Dict
from pydantic import BaseModel, Field, ConfigDict


# =============================================================================
# Project Schemas
# =============================================================================

class ProjectBase(BaseModel):
    name: str
    status: Optional[str] = "active"
    progress: Optional[float] = 0.0
    image_url: Optional[str] = Field(None, alias="imageUrl")

    model_config = ConfigDict(populate_by_name=True)


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None
    progress: Optional[float] = None
    image_url: Optional[str] = Field(None, alias="imageUrl")

    model_config = ConfigDict(populate_by_name=True)


class ProjectResponse(ProjectBase):
    id: str
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ProjectDetailResponse(ProjectResponse):
    """Project with nested relationships."""
    scans: List["ScanResponse"] = []
    master_files: List["ProjectFileResponse"] = Field(default=[], alias="masterFiles")
    agent_states: List["AgentStateResponse"] = Field(default=[], alias="agentStates")
    batches: List["BatchSummaryResponse"] = []


# =============================================================================
# Scan Schemas
# =============================================================================

class ScanBase(BaseModel):
    date: str  # ISO date string
    model_url: Optional[str] = Field(None, alias="modelUrl")
    pdf_url: Optional[str] = Field(None, alias="pdfUrl")

    model_config = ConfigDict(populate_by_name=True)


class ScanCreate(ScanBase):
    project_id: str = Field(alias="projectId")


class ScanUpdate(BaseModel):
    date: Optional[str] = None
    model_url: Optional[str] = Field(None, alias="modelUrl")
    pdf_url: Optional[str] = Field(None, alias="pdfUrl")

    model_config = ConfigDict(populate_by_name=True)


class ScanResponse(ScanBase):
    id: str
    project_id: str = Field(alias="projectId")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ScanDetailResponse(ScanResponse):
    """Scan with nested relationships."""
    files: List["ScanFileResponse"] = []
    insights: List["InsightResponse"] = []


# =============================================================================
# Project File Schemas
# =============================================================================

class ProjectFileBase(BaseModel):
    name: str
    file_type: Optional[str] = Field(None, alias="fileType")
    size: Optional[int] = None
    parent_id: Optional[str] = Field(None, alias="parentId")
    is_folder: bool = Field(False, alias="isFolder")

    model_config = ConfigDict(populate_by_name=True)


class ProjectFileCreate(ProjectFileBase):
    path: str  # Set by server during upload


class ProjectFileResponse(ProjectFileBase):
    id: str
    project_id: str = Field(alias="projectId")
    path: str
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class ProjectFileTreeNode(BaseModel):
    """Recursive tree structure for files."""
    id: str
    name: str
    is_folder: bool = Field(alias="isFolder")
    file_type: Optional[str] = Field(None, alias="fileType")
    size: Optional[int] = None
    children: List["ProjectFileTreeNode"] = []

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Scan File Schemas
# =============================================================================

class ScanFileBase(BaseModel):
    name: str
    file_type: Optional[str] = Field(None, alias="fileType")
    size: Optional[int] = None
    parent_id: Optional[str] = Field(None, alias="parentId")
    is_folder: bool = Field(False, alias="isFolder")

    model_config = ConfigDict(populate_by_name=True)


class ScanFileCreate(ScanFileBase):
    path: str


class ScanFileResponse(ScanFileBase):
    id: str
    scan_id: str = Field(alias="scanId")
    path: str
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# =============================================================================
# Context Pointer Schemas
# =============================================================================

class ContextPointerBounds(BaseModel):
    """Bounds as nested object matching TypeScript interface."""
    x_norm: float = Field(alias="xNorm")
    y_norm: float = Field(alias="yNorm")
    w_norm: float = Field(alias="wNorm")
    h_norm: float = Field(alias="hNorm")

    model_config = ConfigDict(populate_by_name=True)


class ContextPointerStyle(BaseModel):
    """Style as nested object matching TypeScript interface."""
    color: str = "#ff0000"
    stroke_width: int = Field(2, alias="strokeWidth")

    model_config = ConfigDict(populate_by_name=True)


class ContextPointerBase(BaseModel):
    page_number: int = Field(alias="pageNumber")
    bounds: ContextPointerBounds
    style: Optional[ContextPointerStyle] = None
    title: str
    description: Optional[str] = None
    snapshot_data_url: Optional[str] = Field(None, alias="snapshotDataUrl")

    model_config = ConfigDict(populate_by_name=True)


class ContextPointerCreate(ContextPointerBase):
    file_id: str = Field(alias="fileId")


class ContextPointerUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    bounds: Optional[ContextPointerBounds] = None
    style: Optional[ContextPointerStyle] = None

    model_config = ConfigDict(populate_by_name=True)


class HighlightBbox(BaseModel):
    """Bounding box for a highlight region (normalized 0-1 coordinates)."""
    x: float
    y: float
    width: float
    height: float

    model_config = ConfigDict(populate_by_name=True)


class ContextPointerCreateFromHighlight(BaseModel):
    """Create context pointer from a user-drawn highlight box."""
    bbox: HighlightBbox

    model_config = ConfigDict(populate_by_name=True)


class ContextPointerResponse(BaseModel):
    """Response schema matching TypeScript ContextPointer interface."""
    id: str
    file_id: str = Field(alias="fileId")
    page_number: int = Field(alias="pageNumber")
    bounds: ContextPointerBounds
    style: ContextPointerStyle
    title: str
    description: Optional[str] = None
    snapshot_data_url: Optional[str] = Field(None, alias="snapshotDataUrl")
    committed_at: Optional[datetime] = Field(None, alias="committedAt")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @classmethod
    def from_orm_model(cls, obj):
        """Convert from flat ORM model to nested response."""
        return cls(
            id=obj.id,
            file_id=obj.file_id,
            page_number=obj.page_number,
            bounds=ContextPointerBounds(
                x_norm=obj.bounds_x,
                y_norm=obj.bounds_y,
                w_norm=obj.bounds_w,
                h_norm=obj.bounds_h,
            ),
            style=ContextPointerStyle(
                color=obj.style_color,
                stroke_width=obj.style_stroke_width,
            ),
            title=obj.title,
            description=obj.description,
            snapshot_data_url=obj.snapshot_data_url,
            committed_at=obj.committed_at,
            created_at=obj.created_at,
        )


# =============================================================================
# Sheet Context Schemas
# =============================================================================

class SheetContextBase(BaseModel):
    added_to_context: bool = Field(False, alias="addedToContext")
    markdown_content: Optional[str] = Field(None, alias="markdownContent")
    generation_status: str = Field("idle", alias="generationStatus")
    generation_error: Optional[str] = Field(None, alias="generationError")

    model_config = ConfigDict(populate_by_name=True)


class SheetContextCreate(SheetContextBase):
    file_id: str = Field(alias="fileId")


class SheetContextUpdate(BaseModel):
    added_to_context: Optional[bool] = Field(None, alias="addedToContext")
    markdown_content: Optional[str] = Field(None, alias="markdownContent")
    generation_status: Optional[str] = Field(None, alias="generationStatus")
    generation_error: Optional[str] = Field(None, alias="generationError")

    model_config = ConfigDict(populate_by_name=True)


class SheetContextResponse(SheetContextBase):
    id: str
    file_id: str = Field(alias="fileId")
    markdown_generated_at: Optional[datetime] = Field(None, alias="markdownGeneratedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class SheetContextWithPointersResponse(SheetContextResponse):
    """Sheet context with nested pointers, matching TypeScript SheetContext."""
    file_name: str = Field(alias="fileName")
    pointers: List[ContextPointerResponse] = []


# =============================================================================
# Batch Schemas
# =============================================================================

class BatchBase(BaseModel):
    project_id: Optional[str] = Field(None, alias="projectId")
    status: str = "pending"

    model_config = ConfigDict(populate_by_name=True)


class BatchCreate(BaseModel):
    id: str  # batch_TIMESTAMP format, provided by client
    project_id: Optional[str] = Field(None, alias="projectId")

    model_config = ConfigDict(populate_by_name=True)


class BatchUpdate(BaseModel):
    status: Optional[str] = None
    processed_at: Optional[datetime] = Field(None, alias="processedAt")

    model_config = ConfigDict(populate_by_name=True)


class BatchResponse(BatchBase):
    id: str
    processed_at: Optional[datetime] = Field(None, alias="processedAt")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class BatchSummaryResponse(BatchResponse):
    """Batch with summary counts."""
    pointer_count: int = Field(0, alias="pointerCount")
    sheet_count: int = Field(0, alias="sheetCount")


class BatchDetailResponse(BatchResponse):
    """Batch with nested processed pointers."""
    processed_pointers: List["ProcessedPointerResponse"] = Field(default=[], alias="processedPointers")


class BatchCommitResponse(BaseModel):
    """Response from committing a batch to ContextPointers."""
    batch_id: str = Field(alias="batchId")
    pointers_created: int = Field(alias="pointersCreated")
    status: str

    model_config = ConfigDict(populate_by_name=True)


# Schemas for batch commit request (from n8n processed data)
class CommitPointerMetadata(BaseModel):
    """Original metadata from a processed pointer."""
    title: str
    description: Optional[str] = None
    page_number: int = Field(alias="pageNumber")

    model_config = ConfigDict(populate_by_name=True)


class CommitAIAnalysis(BaseModel):
    """AI analysis from n8n processing."""
    technical_description: str = Field(alias="technicalDescription")
    identified_elements: List[Any] = Field(default=[], alias="identifiedElements")
    trade_category: str = Field("", alias="tradeCategory")
    measurements: Optional[List[Dict[str, Any]]] = None
    issues: Optional[List[Dict[str, Any]]] = None
    recommendations: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class CommitPointer(BaseModel):
    """A processed pointer to commit."""
    id: str
    original_metadata: CommitPointerMetadata = Field(alias="originalMetadata")
    ai_analysis: CommitAIAnalysis = Field(alias="aiAnalysis")

    model_config = ConfigDict(populate_by_name=True)


class CommitSheet(BaseModel):
    """A sheet with processed pointers to commit."""
    sheet_id: str = Field(alias="sheetId")
    file_name: str = Field(alias="fileName")
    pointers: List[CommitPointer]

    model_config = ConfigDict(populate_by_name=True)


class BatchCommitRequest(BaseModel):
    """Request body for committing a batch from n8n processed data."""
    batch_id: str = Field(alias="batchId")
    project_id: str = Field(alias="projectId")
    processed_at: str = Field(alias="processedAt")
    sheets: List[CommitSheet]

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Processed Pointer Schemas
# =============================================================================

class OriginalMetadata(BaseModel):
    """Original metadata from the pointer."""
    title: Optional[str] = None
    description: Optional[str] = None
    page_number: Optional[int] = Field(None, alias="pageNumber")

    model_config = ConfigDict(populate_by_name=True)


class ProcessedPointerBase(BaseModel):
    pointer_id: str = Field(alias="pointerId")
    sheet_id: str = Field(alias="sheetId")
    file_name: str = Field(alias="fileName")
    original_title: Optional[str] = Field(None, alias="originalTitle")
    original_description: Optional[str] = Field(None, alias="originalDescription")
    original_page_number: Optional[int] = Field(None, alias="originalPageNumber")
    ai_analysis: Optional[Any] = Field(None, alias="aiAnalysis")

    model_config = ConfigDict(populate_by_name=True)


class ProcessedPointerCreate(ProcessedPointerBase):
    pass


class ProcessedPointerBulkCreate(BaseModel):
    """For bulk inserting processed pointers."""
    pointers: List[ProcessedPointerCreate]


class ProcessedPointerResponse(ProcessedPointerBase):
    id: str
    batch_id: str = Field(alias="batchId")
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# =============================================================================
# Insight Schemas
# =============================================================================

class InsightBase(BaseModel):
    type: str  # clash, rfi, issue, note
    title: str
    summary: Optional[str] = None
    severity: str = "info"  # info, warning, critical
    status: str = "open"  # open, resolved, dismissed
    tags: List[str] = []
    notes: Optional[str] = None
    element_ids: List[str] = Field(default=[], alias="elementIds")

    model_config = ConfigDict(populate_by_name=True)


class InsightCreate(InsightBase):
    scan_id: str = Field(alias="scanId")


class InsightUpdate(BaseModel):
    type: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[List[str]] = None
    notes: Optional[str] = None
    element_ids: Optional[List[str]] = Field(None, alias="elementIds")

    model_config = ConfigDict(populate_by_name=True)


class InsightResponse(InsightBase):
    id: str
    scan_id: str = Field(alias="scanId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# =============================================================================
# Agent State Schemas
# =============================================================================

class MessagePart(BaseModel):
    """Message part matching TypeScript interface."""
    text: str


class Message(BaseModel):
    """Chat message matching TypeScript interface."""
    role: str  # 'user' | 'model'
    parts: List[MessagePart]


class SerializableFile(BaseModel):
    """File reference matching TypeScript interface."""
    name: str
    type: str
    size: int
    content: Optional[str] = None  # base64 data URL
    storage_id: Optional[str] = Field(None, alias="storageId")
    path: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class AgentStateBase(BaseModel):
    agent_type: str = Field(alias="agentType")
    chat_history: List[Message] = Field(default=[], alias="chatHistory")
    uploaded_files: List[SerializableFile] = Field(default=[], alias="uploadedFiles")

    model_config = ConfigDict(populate_by_name=True)


class AgentStateCreate(AgentStateBase):
    project_id: str = Field(alias="projectId")


class AgentStateUpdate(BaseModel):
    chat_history: Optional[List[Message]] = Field(None, alias="chatHistory")
    uploaded_files: Optional[List[SerializableFile]] = Field(None, alias="uploadedFiles")

    model_config = ConfigDict(populate_by_name=True)


class AgentStateResponse(AgentStateBase):
    id: str
    project_id: str = Field(alias="projectId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# =============================================================================
# User Schemas
# =============================================================================

class UserBase(BaseModel):
    name: str
    email: str
    role: str = "superintendent"

    model_config = ConfigDict(populate_by_name=True)


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class UserResponse(UserBase):
    id: str
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class UserWithProjectsResponse(UserResponse):
    assigned_projects: List["ProjectResponse"] = Field(default=[], alias="assignedProjects")


# =============================================================================
# User-Project Assignment Schemas
# =============================================================================

class UserProjectCreate(BaseModel):
    user_id: str = Field(alias="userId")
    project_id: str = Field(alias="projectId")

    model_config = ConfigDict(populate_by_name=True)


class UserProjectResponse(BaseModel):
    id: str
    user_id: str = Field(alias="userId")
    project_id: str = Field(alias="projectId")
    assigned_at: datetime = Field(alias="assignedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# =============================================================================
# Query Schemas
# =============================================================================

class QueryBase(BaseModel):
    transcript: str
    project_id: str = Field(alias="projectId")

    model_config = ConfigDict(populate_by_name=True)


class QueryCreate(QueryBase):
    user_id: str = Field(alias="userId")


class QueryResponse(QueryBase):
    id: str
    user_id: str = Field(alias="userId")
    response: Optional[str] = None
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class QueryWithResultsResponse(QueryResponse):
    results: List["QueryResultResponse"] = []


# =============================================================================
# Query Result Schemas
# =============================================================================

class QueryResultBase(BaseModel):
    context_pointer_id: str = Field(alias="contextPointerId")
    relevance_score: Optional[float] = Field(None, alias="relevanceScore")
    reason: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class QueryResultCreate(QueryResultBase):
    query_id: str = Field(alias="queryId")


class QueryResultResponse(QueryResultBase):
    id: str
    query_id: str = Field(alias="queryId")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class QueryResultWithPointerResponse(QueryResultResponse):
    context_pointer: "ContextPointerResponse" = Field(alias="contextPointer")


# =============================================================================
# Enhanced Query Response for ViewM4D (Grok Agent Integration)
# =============================================================================

class ContextPointerResultResponse(BaseModel):
    """Context pointer result with sheet info and reason - for ViewM4D query results."""
    id: str
    sheet_id: str = Field(alias="sheetId")
    sheet_name: str = Field(alias="sheetName")
    reason: str
    bbox: Dict[str, float]  # {x, y, width, height} normalized 0-1

    model_config = ConfigDict(populate_by_name=True)


class EnhancedQueryResponse(BaseModel):
    """Enhanced query response for ViewM4D with full context pointer data."""
    id: str
    query: str
    context_pointers: List[ContextPointerResultResponse] = Field(alias="contextPointers")
    narrative: str
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Page Context Schemas (AI-generated page descriptions)
# =============================================================================

class PageContextBase(BaseModel):
    content: Optional[str] = None
    status: str = "pending"  # pending, processing, complete, error
    error_message: Optional[str] = Field(None, alias="errorMessage")

    model_config = ConfigDict(populate_by_name=True)


class PageContextUpdate(BaseModel):
    """For user editing AI-generated content."""
    content: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class PageContextResponse(PageContextBase):
    id: str
    file_id: str = Field(alias="fileId")
    page_number: int = Field(alias="pageNumber")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class PageContextWithPointersResponse(PageContextResponse):
    """Page context with related context pointers."""
    pointers: List[ContextPointerResponse] = []


class ProcessingStatusResponse(BaseModel):
    """Status of page context generation for a plan."""
    total: int
    completed: int
    processing: int
    pending: int
    errors: int

    model_config = ConfigDict(populate_by_name=True)


class ProcessContextTriggerResponse(BaseModel):
    """Response when triggering background processing."""
    job_id: str = Field(alias="jobId")
    message: str
    total_pages: int = Field(alias="totalPages")

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Context Preview and Commit Schemas
# =============================================================================

class ContextPointerPreview(BaseModel):
    """Simplified context pointer for preview."""
    id: str
    title: str
    description: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class PagePreview(BaseModel):
    """Page preview with context and pointers."""
    page_id: str = Field(alias="pageId")
    page_number: int = Field(alias="pageNumber")
    page_name: str = Field(alias="pageName")
    context: Optional[str] = None
    context_status: str = Field(alias="contextStatus")
    committed_at: Optional[datetime] = Field(None, alias="committedAt")
    pointers: List[ContextPointerPreview] = []

    model_config = ConfigDict(populate_by_name=True)


class ContextPreviewSummary(BaseModel):
    """Summary statistics for the preview."""
    total_pages: int = Field(alias="totalPages")
    total_pointers: int = Field(alias="totalPointers")
    pages_complete: int = Field(alias="pagesComplete")
    pages_with_errors: int = Field(alias="pagesWithErrors")
    pages_committed: int = Field(alias="pagesCommitted")

    model_config = ConfigDict(populate_by_name=True)


class ContextPreviewResponse(BaseModel):
    """Full context preview for the preview modal."""
    plan_id: str = Field(alias="planId")
    plan_name: str = Field(alias="planName")
    pages: List[PagePreview]
    summary: ContextPreviewSummary

    model_config = ConfigDict(populate_by_name=True)


class ContextCommitResponse(BaseModel):
    """Response after committing context to ViewM4D."""
    pages_committed: int = Field(alias="pagesCommitted")
    pointers_committed: int = Field(alias="pointersCommitted")
    committed_at: datetime = Field(alias="committedAt")
    warnings: List[str] = []

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Project-Wide Commit Preview Schemas (All pointers with AI analysis)
# =============================================================================

class AIAnalysisPreview(BaseModel):
    """AI analysis data for preview display."""
    technical_description: Optional[str] = Field(None, alias="technicalDescription")
    trade_category: Optional[str] = Field(None, alias="tradeCategory")
    identified_elements: Optional[List[Any]] = Field(None, alias="identifiedElements")
    recommendations: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class PointerCommitPreview(BaseModel):
    """Full pointer data for commit preview, including AI analysis and crop image."""
    id: str
    title: str
    description: Optional[str] = None
    page_number: int = Field(alias="pageNumber")
    bounds: Optional[ContextPointerBounds] = None
    crop_path: Optional[str] = Field(None, alias="cropPath")
    ai_analysis: Optional[AIAnalysisPreview] = Field(None, alias="aiAnalysis")
    committed_at: Optional[datetime] = Field(None, alias="committedAt")

    model_config = ConfigDict(populate_by_name=True)


class FileCommitPreview(BaseModel):
    """File with all pointers for commit preview."""
    id: str
    name: str
    pointer_count: int = Field(alias="pointerCount")
    pointers_with_ai: int = Field(alias="pointersWithAi")
    pointers: List[PointerCommitPreview] = []

    model_config = ConfigDict(populate_by_name=True)


class ProjectCommitPreviewSummary(BaseModel):
    """Summary statistics for project-wide commit preview."""
    total_files: int = Field(alias="totalFiles")
    total_pointers: int = Field(alias="totalPointers")
    pointers_with_ai: int = Field(alias="pointersWithAi")
    pointers_committed: int = Field(alias="pointersCommitted")
    files_with_ai: int = Field(alias="filesWithAi")

    model_config = ConfigDict(populate_by_name=True)


class ProjectCommitPreviewResponse(BaseModel):
    """Project-wide commit preview with all files and pointers."""
    project_id: str = Field(alias="projectId")
    project_name: str = Field(alias="projectName")
    files: List[FileCommitPreview]
    summary: ProjectCommitPreviewSummary

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Project Context Summary Schemas (Global context across all files)
# =============================================================================

class PointerSummary(BaseModel):
    """Minimal pointer data for tree display."""
    id: str
    title: str
    description: Optional[str] = None
    page_number: int = Field(alias="pageNumber")
    bounds: Optional[ContextPointerBounds] = None  # For zoom-to-fit on navigation

    model_config = ConfigDict(populate_by_name=True)


class PageSummary(BaseModel):
    """Page summary with context status and pointers."""
    id: str
    page_number: int = Field(alias="pageNumber")
    status: str  # pending, processing, complete, error
    has_context: bool = Field(alias="hasContext")
    context_preview: Optional[str] = Field(None, alias="contextPreview")  # First 200 chars
    committed_at: Optional[datetime] = Field(None, alias="committedAt")
    pointer_count: int = Field(alias="pointerCount")
    pointers: List[PointerSummary] = []

    model_config = ConfigDict(populate_by_name=True)


class FileSummary(BaseModel):
    """File summary with pages and total counts."""
    id: str
    name: str
    file_type: Optional[str] = Field(None, alias="fileType")
    page_count: int = Field(alias="pageCount")
    pointer_count: int = Field(alias="pointerCount")
    pages_complete: int = Field(alias="pagesComplete")
    pages_with_errors: int = Field(alias="pagesWithErrors")
    pages_committed: int = Field(alias="pagesCommitted")
    pages: List[PageSummary] = []

    model_config = ConfigDict(populate_by_name=True)


class ProjectContextSummaryResponse(BaseModel):
    """Full project context summary across all files."""
    project_id: str = Field(alias="projectId")
    total_files: int = Field(alias="totalFiles")
    total_pages: int = Field(alias="totalPages")
    total_pointers: int = Field(alias="totalPointers")
    pages_complete: int = Field(alias="pagesComplete")
    pages_with_errors: int = Field(alias="pagesWithErrors")
    pages_committed: int = Field(alias="pagesCommitted")
    files: List[FileSummary] = []

    model_config = ConfigDict(populate_by_name=True)


# =============================================================================
# Auth Schemas
# =============================================================================

class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    user: UserResponse
    token: str


# =============================================================================
# Health Check Schema
# =============================================================================

class HealthResponse(BaseModel):
    status: str


# =============================================================================
# Agent Session Schemas (ViewM4D conversational agent)
# =============================================================================

# Request schemas
class AgentSessionCreate(BaseModel):
    """Create a new agent session."""
    project_id: str = Field(alias="projectId")

    model_config = ConfigDict(populate_by_name=True)


class AgentSessionUpdate(BaseModel):
    """Update an agent session (e.g., rename title)."""
    title: Optional[str] = None

    model_config = ConfigDict(populate_by_name=True)


class AgentMessageCreate(BaseModel):
    """Create a new message in an agent session."""
    query: str

    model_config = ConfigDict(populate_by_name=True)


# Response schemas (building blocks first, then composite)
class AgentPointerResult(BaseModel):
    """Individual pointer result from agent response."""
    id: str
    reason: Optional[str] = None

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class AgentSheetResult(BaseModel):
    """Sheet with grouped pointers from agent response."""
    sheet_id: str = Field(alias="sheetId")
    sheet_name: str = Field(alias="sheetName")
    pointers: List[AgentPointerResult] = []

    model_config = ConfigDict(populate_by_name=True)


class AgentMessageResponse(BaseModel):
    """Individual message in an agent session."""
    id: str
    role: str  # 'user' or 'agent'
    content: str
    narrative: Optional[str] = None
    sheets: List[AgentSheetResult] = []
    created_at: datetime = Field(alias="createdAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    @classmethod
    def from_orm_model(cls, message):
        """Convert from ORM model, grouping pointers by sheet."""
        # Group pointers by sheet_id
        sheets_map: Dict[str, AgentSheetResult] = {}
        for pointer in message.pointers:
            if pointer.sheet_id not in sheets_map:
                sheets_map[pointer.sheet_id] = AgentSheetResult(
                    sheet_id=pointer.sheet_id,
                    sheet_name=pointer.sheet_name,
                    pointers=[]
                )
            sheets_map[pointer.sheet_id].pointers.append(
                AgentPointerResult(id=pointer.context_pointer_id, reason=pointer.reason)
            )

        return cls(
            id=message.id,
            role=message.role,
            content=message.content,
            narrative=message.narrative,
            sheets=list(sheets_map.values()),
            created_at=message.created_at,
        )


class AgentSessionSummary(BaseModel):
    """Summary of an agent session for list views."""
    id: str
    title: Optional[str] = None
    project_id: str = Field(alias="projectId")
    message_count: int = Field(alias="messageCount")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class AgentSessionResponse(BaseModel):
    """Full agent session with messages."""
    id: str
    title: Optional[str] = None
    project_id: str = Field(alias="projectId")
    messages: List[AgentMessageResponse] = []
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


# Update forward references for nested models
UserWithProjectsResponse.model_rebuild()
QueryWithResultsResponse.model_rebuild()
QueryResultWithPointerResponse.model_rebuild()
ProjectFileTreeNode.model_rebuild()
ProjectDetailResponse.model_rebuild()
ScanDetailResponse.model_rebuild()
BatchDetailResponse.model_rebuild()
SheetContextWithPointersResponse.model_rebuild()
EnhancedQueryResponse.model_rebuild()
PageContextWithPointersResponse.model_rebuild()
AgentSessionResponse.model_rebuild()
AgentMessageResponse.model_rebuild()

