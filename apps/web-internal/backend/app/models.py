"""
SQLAlchemy ORM models for Maestro4D Web Internal.
"""
from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, 
    ForeignKey, JSON, UniqueConstraint
)
from sqlalchemy.orm import relationship
from .database import Base


def generate_uuid() -> str:
    """Generate a new UUID string."""
    return str(uuid4())


class Project(Base):
    """Project model - top level entity."""
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    status = Column(String, default="active")  # active, archived, completed
    progress = Column(Float, default=0.0)
    image_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    scans = relationship("Scan", back_populates="project", cascade="all, delete-orphan")
    master_files = relationship("ProjectFile", back_populates="project", cascade="all, delete-orphan")
    agent_states = relationship("AgentState", back_populates="project", cascade="all, delete-orphan")
    batches = relationship("Batch", back_populates="project", cascade="all, delete-orphan")
    assigned_users = relationship("UserProject", back_populates="project", cascade="all, delete-orphan")
    queries = relationship("Query", back_populates="project", cascade="all, delete-orphan")
    agent_sessions = relationship("AgentSession", back_populates="project", cascade="all, delete-orphan")


class Scan(Base):
    """Scan model - represents a single scan session."""
    __tablename__ = "scans"

    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    date = Column(String, nullable=False)  # ISO date string
    model_url = Column(String, nullable=True)  # Point cloud URL
    pdf_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="scans")
    files = relationship("ScanFile", back_populates="scan", cascade="all, delete-orphan")
    insights = relationship("Insight", back_populates="scan", cascade="all, delete-orphan")


class ProjectFile(Base):
    """Project file model - for project master files (PDFs, plans)."""
    __tablename__ = "project_files"

    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)  # Storage path on disk
    file_type = Column(String, nullable=True)  # pdf, image, etc.
    size = Column(Integer, nullable=True)
    parent_id = Column(String, ForeignKey("project_files.id"), nullable=True)  # Folder hierarchy
    is_folder = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="master_files")
    children = relationship("ProjectFile", backref="parent", remote_side=[id], cascade="all, delete-orphan", single_parent=True)
    context_pointers = relationship("ContextPointer", back_populates="file", cascade="all, delete-orphan")
    page_contexts = relationship("PageContext", back_populates="file", cascade="all, delete-orphan")
    sheet_context = relationship("SheetContext", back_populates="file", uselist=False, cascade="all, delete-orphan")


class ScanFile(Base):
    """Scan file model - files associated with a specific scan."""
    __tablename__ = "scan_files"

    id = Column(String, primary_key=True, default=generate_uuid)
    scan_id = Column(String, ForeignKey("scans.id"), nullable=False)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    file_type = Column(String, nullable=True)
    size = Column(Integer, nullable=True)
    parent_id = Column(String, ForeignKey("scan_files.id"), nullable=True)
    is_folder = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    scan = relationship("Scan", back_populates="files")
    children = relationship("ScanFile", backref="parent", remote_side=[id], cascade="all, delete-orphan", single_parent=True)


class ContextPointer(Base):
    """Context pointer model - annotations on PDF pages."""
    __tablename__ = "context_pointers"

    id = Column(String, primary_key=True, default=generate_uuid)
    file_id = Column(String, ForeignKey("project_files.id"), nullable=False)
    page_context_id = Column(String, ForeignKey("page_contexts.id"), nullable=True)  # Links to page context
    page_number = Column(Integer, nullable=False)
    # Bounds (normalized 0-1)
    bounds_x = Column(Float, nullable=False)
    bounds_y = Column(Float, nullable=False)
    bounds_w = Column(Float, nullable=False)
    bounds_h = Column(Float, nullable=False)
    # Style
    style_color = Column(String, default="#ff0000")
    style_stroke_width = Column(Integer, default=2)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    snapshot_data_url = Column(Text, nullable=True)  # Base64 image
    crop_path = Column(Text, nullable=True)  # Path to saved crop image file
    status = Column(String, default="complete")  # processing, complete, error
    committed_at = Column(DateTime, nullable=True)  # When committed to ViewM4D
    # AI Analysis fields (populated after "Process with AI")
    ai_technical_description = Column(Text, nullable=True)
    ai_trade_category = Column(String, nullable=True)
    ai_elements = Column(JSON, nullable=True)  # List of identified elements
    ai_recommendations = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    file = relationship("ProjectFile", back_populates="context_pointers")
    page_context = relationship("PageContext", back_populates="context_pointers")


class SheetContext(Base):
    """Sheet context model - metadata about a file's context state."""
    __tablename__ = "sheet_contexts"

    id = Column(String, primary_key=True, default=generate_uuid)
    file_id = Column(String, ForeignKey("project_files.id"), nullable=False, unique=True)
    added_to_context = Column(Boolean, default=False)
    markdown_content = Column(Text, nullable=True)
    markdown_generated_at = Column(DateTime, nullable=True)
    generation_status = Column(String, default="idle")  # idle, generating, complete, error
    generation_error = Column(Text, nullable=True)

    # Relationships
    file = relationship("ProjectFile", back_populates="sheet_context")


class PageContext(Base):
    """Page context model - AI-generated description for each page in a document."""
    __tablename__ = "page_contexts"

    id = Column(String, primary_key=True, default=generate_uuid)
    file_id = Column(String, ForeignKey("project_files.id"), nullable=False)
    page_number = Column(Integer, nullable=False)
    content = Column(Text, nullable=True)  # AI-generated description, user-editable
    status = Column(String, default="pending")  # pending, processing, complete, error
    error_message = Column(Text, nullable=True)
    committed_at = Column(DateTime, nullable=True)  # When committed to ViewM4D
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    file = relationship("ProjectFile", back_populates="page_contexts")
    context_pointers = relationship("ContextPointer", back_populates="page_context", cascade="all, delete-orphan")

    # Unique constraint: one context per file+page
    __table_args__ = (
        UniqueConstraint('file_id', 'page_number', name='uq_page_context'),
    )


class Batch(Base):
    """Batch model - n8n processing batch."""
    __tablename__ = "batches"

    id = Column(String, primary_key=True)  # batch_TIMESTAMP format, not auto-generated
    project_id = Column(String, ForeignKey("projects.id"), nullable=True)
    status = Column(String, default="pending")  # pending, processing, complete, error
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="batches")
    processed_pointers = relationship("ProcessedPointer", back_populates="batch", cascade="all, delete-orphan")


class ProcessedPointer(Base):
    """Processed pointer model - AI analysis results."""
    __tablename__ = "processed_pointers"

    id = Column(String, primary_key=True, default=generate_uuid)
    batch_id = Column(String, ForeignKey("batches.id"), nullable=False)
    pointer_id = Column(String, nullable=False)  # Original context pointer ID
    sheet_id = Column(String, nullable=False)
    file_name = Column(String, nullable=False)
    original_title = Column(String, nullable=True)
    original_description = Column(Text, nullable=True)
    original_page_number = Column(Integer, nullable=True)
    ai_analysis = Column(JSON, nullable=True)  # Full AI response as JSON
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    batch = relationship("Batch", back_populates="processed_pointers")


class Insight(Base):
    """Insight model - issues, RFIs, notes discovered during analysis."""
    __tablename__ = "insights"

    id = Column(String, primary_key=True, default=generate_uuid)
    scan_id = Column(String, ForeignKey("scans.id"), nullable=False)
    type = Column(String, nullable=False)  # clash, rfi, issue, note
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    severity = Column(String, default="info")  # info, warning, critical
    status = Column(String, default="open")  # open, resolved, dismissed
    tags = Column(JSON, default=list)
    notes = Column(Text, nullable=True)
    element_ids = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    scan = relationship("Scan", back_populates="insights")


class AgentState(Base):
    """Agent state model - persistent chat state for AI agents."""
    __tablename__ = "agent_states"

    id = Column(String, primary_key=True, default=generate_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    agent_type = Column(String, nullable=False)  # planReader, superintendent, modelAnalyzer, issueTracker
    chat_history = Column(JSON, default=list)
    uploaded_files = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    project = relationship("Project", back_populates="agent_states")

    # Unique constraint on (project_id, agent_type)
    __table_args__ = (
        UniqueConstraint('project_id', 'agent_type', name='uq_agent_project_type'),
    )


class User(Base):
    """User model - admin and superintendents."""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="superintendent")  # 'admin' or 'superintendent'
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project_assignments = relationship("UserProject", back_populates="user", cascade="all, delete-orphan")
    queries = relationship("Query", back_populates="user", cascade="all, delete-orphan")
    agent_sessions = relationship("AgentSession", back_populates="user", cascade="all, delete-orphan")


class UserProject(Base):
    """Links users to their assigned projects."""
    __tablename__ = "user_projects"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    assigned_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="project_assignments")
    project = relationship("Project", back_populates="assigned_users")

    __table_args__ = (
        UniqueConstraint('user_id', 'project_id', name='uq_user_project'),
    )


class Query(Base):
    """Voice query history."""
    __tablename__ = "queries"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    transcript = Column(Text, nullable=False)
    response = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="queries")
    project = relationship("Project", back_populates="queries")
    results = relationship("QueryResult", back_populates="query", cascade="all, delete-orphan")


class QueryResult(Base):
    """Links queries to the context pointers that answered them."""
    __tablename__ = "query_results"

    id = Column(String, primary_key=True, default=generate_uuid)
    query_id = Column(String, ForeignKey("queries.id"), nullable=False)
    context_pointer_id = Column(String, ForeignKey("context_pointers.id"), nullable=False)
    relevance_score = Column(Float, nullable=True)
    reason = Column(Text, nullable=True)  # Why this pointer was selected by Grok

    # Relationships
    query = relationship("Query", back_populates="results")
    context_pointer = relationship("ContextPointer")


# =============================================================================
# Agent Session Models (ViewM4D conversational agent)
# =============================================================================

class AgentSession(Base):
    """Agent session model - multi-turn conversation session for ViewM4D agent."""
    __tablename__ = "agent_sessions"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    title = Column(String, nullable=True)  # Auto-generated from first message
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user = relationship("User", back_populates="agent_sessions")
    project = relationship("Project", back_populates="agent_sessions")
    messages = relationship("AgentMessage", back_populates="session", cascade="all, delete-orphan", order_by="AgentMessage.created_at")


class AgentMessage(Base):
    """Agent message model - individual message in an agent session."""
    __tablename__ = "agent_messages"

    id = Column(String, primary_key=True, default=generate_uuid)
    session_id = Column(String, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String, nullable=False)  # 'user' or 'agent'
    content = Column(Text, nullable=False)  # User's question OR agent's short answer
    narrative = Column(Text, nullable=True)  # Agent only: full response for viewer overlay
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    session = relationship("AgentSession", back_populates="messages")
    pointers = relationship("AgentMessagePointer", back_populates="message", cascade="all, delete-orphan")


class AgentMessagePointer(Base):
    """Agent message pointer model - links agent messages to context pointers."""
    __tablename__ = "agent_message_pointers"

    id = Column(String, primary_key=True, default=generate_uuid)
    message_id = Column(String, ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False)
    context_pointer_id = Column(String, ForeignKey("context_pointers.id"), nullable=False)
    sheet_id = Column(String, nullable=False)  # Denormalized for efficient display
    sheet_name = Column(String, nullable=False)  # Denormalized for efficient display
    reason = Column(Text, nullable=True)  # Why agent selected this pointer

    # Relationships
    message = relationship("AgentMessage", back_populates="pointers")
    context_pointer = relationship("ContextPointer")

