"""
FastAPI application entry point with CORS, lifespan, and router configuration.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import projects, scans, files, context, batches, insights, agents
from .schemas import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan context manager.
    Initializes database on startup.
    """
    # Startup: Initialize database tables
    init_db()
    print("Database initialized successfully")
    yield
    # Shutdown: Cleanup if needed
    print("Application shutting down")


# Create FastAPI application
app = FastAPI(
    title="Maestro4D Web Internal API",
    description="Backend API for Maestro4D internal web tool with SQLite persistence",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS configuration for frontend dev servers
origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(projects.router, prefix="/api", tags=["Projects"])
app.include_router(scans.router, prefix="/api", tags=["Scans"])
app.include_router(files.router, prefix="/api", tags=["Files"])
app.include_router(context.router, prefix="/api", tags=["Context"])
app.include_router(batches.router, prefix="/api", tags=["Batches"])
app.include_router(insights.router, prefix="/api", tags=["Insights"])
app.include_router(agents.router, prefix="/api", tags=["Agents"])


@app.get("/api/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy")

