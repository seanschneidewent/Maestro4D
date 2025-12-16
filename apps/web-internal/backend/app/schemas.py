"""
Pydantic schemas for request/response validation.
Uses Field(alias=...) for camelCase JSON serialization to match TypeScript frontend.
"""
from datetime import datetime
from typing import Optional, List, Any
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
# Health Check Schema
# =============================================================================

class HealthResponse(BaseModel):
    status: str


# Update forward references for nested models
ProjectFileTreeNode.model_rebuild()
ProjectDetailResponse.model_rebuild()
ScanDetailResponse.model_rebuild()
BatchDetailResponse.model_rebuild()
SheetContextWithPointersResponse.model_rebuild()

