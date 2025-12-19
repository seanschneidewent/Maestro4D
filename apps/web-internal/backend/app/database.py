"""
SQLite database configuration with SQLAlchemy ORM.
"""
import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Database directory and file path
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH = DATA_DIR / "maestro.db"

# SQLite connection string
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_PATH}"

# Create engine with SQLite-specific settings
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},  # Required for SQLite with FastAPI
    echo=False,  # Set to True for SQL query logging
)

# Session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for declarative models
Base = declarative_base()


def get_db():
    """
    Dependency that provides a database session.
    Yields a session and ensures it's closed after use.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """
    Initialize the database by creating all tables.
    Called on application startup.
    """
    from . import models  # Import models to register them with Base
    Base.metadata.create_all(bind=engine)
    
    # Schema migration: Add missing columns to existing tables
    _run_migrations()


def _run_migrations():
    """
    Run schema migrations for columns added after initial table creation.
    SQLite doesn't support adding columns with ALTER TABLE in create_all,
    so we handle them manually.
    """
    from sqlalchemy import text
    
    migrations = [
        # Add 'reason' column to query_results if missing
        ("query_results", "reason", "ALTER TABLE query_results ADD COLUMN reason TEXT"),
        # Add new columns to context_pointers for AI analysis pipeline
        ("context_pointers", "page_context_id", "ALTER TABLE context_pointers ADD COLUMN page_context_id TEXT REFERENCES page_contexts(id)"),
        ("context_pointers", "crop_path", "ALTER TABLE context_pointers ADD COLUMN crop_path TEXT"),
        ("context_pointers", "status", "ALTER TABLE context_pointers ADD COLUMN status TEXT DEFAULT 'complete'"),
        ("context_pointers", "updated_at", "ALTER TABLE context_pointers ADD COLUMN updated_at DATETIME"),
        # Add committed_at to page_contexts for ViewM4D publishing
        ("page_contexts", "committed_at", "ALTER TABLE page_contexts ADD COLUMN committed_at DATETIME"),
        # Add committed_at to context_pointers for ViewM4D publishing
        ("context_pointers", "committed_at", "ALTER TABLE context_pointers ADD COLUMN committed_at DATETIME"),
        # AI Analysis fields for context_pointers (populated after "Process with AI")
        ("context_pointers", "ai_technical_description", "ALTER TABLE context_pointers ADD COLUMN ai_technical_description TEXT"),
        ("context_pointers", "ai_trade_category", "ALTER TABLE context_pointers ADD COLUMN ai_trade_category TEXT"),
        ("context_pointers", "ai_elements", "ALTER TABLE context_pointers ADD COLUMN ai_elements JSON"),
        ("context_pointers", "ai_recommendations", "ALTER TABLE context_pointers ADD COLUMN ai_recommendations TEXT"),
    ]
    
    with engine.connect() as conn:
        for table_name, column_name, alter_sql in migrations:
            # Check if column exists
            result = conn.execute(text(f"PRAGMA table_info({table_name})"))
            columns = [row[1] for row in result.fetchall()]
            
            if column_name not in columns:
                print(f"Migration: Adding column '{column_name}' to table '{table_name}'")
                conn.execute(text(alter_sql))
                conn.commit()

