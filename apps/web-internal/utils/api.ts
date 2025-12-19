/**
 * API Client for FastAPI Backend (localhost:8000)
 * Handles projects, files, and context pointers persistence
 */

export const API_BASE = 'http://localhost:8000';

// =============================================================================
// Types matching backend schemas
// =============================================================================

export interface ProjectResponse {
  id: string;
  name: string;
  status: string;
  progress: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreate {
  name: string;
  status?: string;
  progress?: number;
  imageUrl?: string | null;
}

export interface ProjectUpdate {
  name?: string;
  status?: string;
  progress?: number;
  imageUrl?: string | null;
}

export interface ProjectFileResponse {
  id: string;
  projectId: string;
  name: string;
  path: string;
  fileType: string | null;
  size: number | null;
  parentId: string | null;
  isFolder: boolean;
  createdAt: string;
}

export interface ContextPointerBounds {
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
}

export interface ContextPointerStyle {
  color: string;
  strokeWidth: number;
}

export interface ContextPointerResponse {
  id: string;
  fileId: string;
  pageNumber: number;
  bounds: ContextPointerBounds;
  style: ContextPointerStyle;
  title: string;
  description: string | null;
  snapshotDataUrl: string | null;
  createdAt: string;
}

export interface ContextPointerCreate {
  fileId: string;
  pageNumber: number;
  bounds: ContextPointerBounds;
  style?: ContextPointerStyle;
  title: string;
  description?: string;
  snapshotDataUrl?: string | null;
}

export interface ContextPointerUpdate {
  title?: string;
  description?: string;
  bounds?: ContextPointerBounds;
  style?: ContextPointerStyle;
}

// =============================================================================
// User Types
// =============================================================================

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'superintendent';
  createdAt: string;
}

export interface UserCreate {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'superintendent';
}

export interface UserProjectResponse {
  id: string;
  userId: string;
  projectId: string;
  assignedAt: string;
}

// =============================================================================
// Error handling
// =============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail: string | undefined;
    try {
      const errorData = await response.json();
      detail = errorData.detail;
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      detail
    );
  }
  
  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }
  
  return response.json();
}

// =============================================================================
// Projects API
// =============================================================================

export async function fetchProjects(): Promise<ProjectResponse[]> {
  const response = await fetch(`${API_BASE}/api/projects`);
  return handleResponse<ProjectResponse[]>(response);
}

export async function fetchProject(projectId: string): Promise<ProjectResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}`);
  return handleResponse<ProjectResponse>(response);
}

export async function createProject(project: ProjectCreate): Promise<ProjectResponse> {
  const response = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project),
  });
  return handleResponse<ProjectResponse>(response);
}

export async function updateProject(projectId: string, update: ProjectUpdate): Promise<ProjectResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return handleResponse<ProjectResponse>(response);
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

// =============================================================================
// Files API
// =============================================================================

export async function fetchProjectFiles(projectId: string): Promise<ProjectFileResponse[]> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/files`);
  return handleResponse<ProjectFileResponse[]>(response);
}

export async function uploadProjectFile(
  projectId: string,
  file: File,
  parentId?: string
): Promise<ProjectFileResponse> {
  const formData = new FormData();
  formData.append('file', file);
  
  let url = `${API_BASE}/api/projects/${projectId}/files`;
  if (parentId) {
    url += `?parentId=${encodeURIComponent(parentId)}`;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  return handleResponse<ProjectFileResponse>(response);
}

export async function downloadFile(fileId: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}/download`);
  if (!response.ok) {
    throw new ApiError(
      `Failed to download file: ${response.status}`,
      response.status
    );
  }
  return response.blob();
}

export async function deleteFile(fileId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

export async function deleteAllProjectFiles(projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/files`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

export async function getFileMetadata(fileId: string): Promise<ProjectFileResponse> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}`);
  return handleResponse<ProjectFileResponse>(response);
}

// =============================================================================
// Context Pointers API
// =============================================================================

export async function fetchFilePointers(fileId: string): Promise<ContextPointerResponse[]> {
  const response = await fetch(`${API_BASE}/api/files/${fileId}/pointers`);
  return handleResponse<ContextPointerResponse[]>(response);
}

export async function createPointer(pointer: ContextPointerCreate): Promise<ContextPointerResponse> {
  const response = await fetch(`${API_BASE}/api/pointers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pointer),
  });
  return handleResponse<ContextPointerResponse>(response);
}

export async function updatePointer(
  pointerId: string,
  update: ContextPointerUpdate
): Promise<ContextPointerResponse> {
  const response = await fetch(`${API_BASE}/api/pointers/${pointerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return handleResponse<ContextPointerResponse>(response);
}

export async function deletePointer(pointerId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/pointers/${pointerId}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

// =============================================================================
// Page Context API (AI-generated page descriptions)
// =============================================================================

export interface PageContextResponse {
  id: string;
  fileId: string;
  pageNumber: number;
  content: string | null;
  status: 'pending' | 'processing' | 'complete' | 'error';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageContextWithPointersResponse extends PageContextResponse {
  pointers: ContextPointerResponse[];
}

export interface PageContextUpdate {
  content?: string;
}

export async function fetchPageContext(contextId: string): Promise<PageContextWithPointersResponse> {
  const response = await fetch(`${API_BASE}/api/page-context/${contextId}`);
  return handleResponse<PageContextWithPointersResponse>(response);
}

export async function updatePageContext(
  contextId: string,
  update: PageContextUpdate
): Promise<PageContextResponse> {
  const response = await fetch(`${API_BASE}/api/page-context/${contextId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return handleResponse<PageContextResponse>(response);
}

export async function updateContextPointer(
  pointerId: string,
  update: ContextPointerUpdate
): Promise<ContextPointerResponse> {
  const response = await fetch(`${API_BASE}/api/context-pointers/${pointerId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  return handleResponse<ContextPointerResponse>(response);
}

export async function deleteContextPointer(pointerId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/context-pointers/${pointerId}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

// =============================================================================
// Plan Processing Status API
// =============================================================================

export interface ProcessingStatusResponse {
  total: number;
  completed: number;
  processing: number;
  pending: number;
  errors: number;
}

export async function fetchProcessingStatus(planId: string): Promise<ProcessingStatusResponse> {
  const response = await fetch(`${API_BASE}/api/plans/${planId}/processing-status`);
  return handleResponse<ProcessingStatusResponse>(response);
}

// =============================================================================
// Page Context Processing API (AI-generated page analysis)
// =============================================================================

export interface ProcessContextTriggerResponse {
  jobId: string;
  message: string;
  totalPages: number;
}

/**
 * Trigger background processing of all pages in a plan PDF.
 * Returns immediately with a job ID. Frontend can poll processing-status.
 */
export async function triggerPageContextProcessing(fileId: string): Promise<ProcessContextTriggerResponse> {
  const response = await fetch(`${API_BASE}/api/plans/${fileId}/process-context`, {
    method: 'POST',
  });
  return handleResponse<ProcessContextTriggerResponse>(response);
}

/**
 * Get the PageContext for a specific page, including related ContextPointers.
 */
export async function fetchPageContextByPage(
  fileId: string,
  pageNumber: number
): Promise<PageContextWithPointersResponse> {
  const response = await fetch(`${API_BASE}/api/pages/${fileId}/${pageNumber}/context`);
  return handleResponse<PageContextWithPointersResponse>(response);
}

// =============================================================================
// Highlight-based Context Pointer Creation (AI-analyzed)
// =============================================================================

export interface HighlightBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreatePointerFromHighlightRequest {
  bbox: HighlightBbox;
}

/**
 * Create a context pointer from a user-drawn highlight box.
 * The backend will:
 * 1. Crop the highlighted region from the PDF page
 * 2. Call Gemini to analyze the crop with page context
 * 3. Return a ContextPointer with AI-generated title/description
 */
export async function createPointerFromHighlight(
  pageContextId: string,
  bbox: HighlightBbox
): Promise<ContextPointerResponse> {
  const response = await fetch(`${API_BASE}/api/pages/${pageContextId}/context-pointers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bbox }),
  });
  return handleResponse<ContextPointerResponse>(response);
}

// =============================================================================
// Context Preview API
// =============================================================================

export interface ContextPointerPreview {
  id: string;
  title: string;
  description: string | null;
}

export interface PagePreview {
  pageId: string;
  pageNumber: number;
  pageName: string;
  context: string | null;
  contextStatus: 'pending' | 'processing' | 'complete' | 'error';
  committedAt: string | null;
  pointers: ContextPointerPreview[];
}

export interface ContextPreviewSummary {
  totalPages: number;
  totalPointers: number;
  pagesComplete: number;
  pagesWithErrors: number;
  pagesCommitted: number;
}

export interface ContextPreviewResponse {
  planId: string;
  planName: string;
  pages: PagePreview[];
  summary: ContextPreviewSummary;
}

export async function fetchContextPreview(planId: string): Promise<ContextPreviewResponse> {
  const response = await fetch(`${API_BASE}/api/plans/${planId}/context-preview`);
  return handleResponse<ContextPreviewResponse>(response);
}

// =============================================================================
// Context Commit API
// =============================================================================

export interface ContextCommitResponse {
  pagesCommitted: number;
  pointersCommitted: number;
  committedAt: string;
  warnings: string[];
}

/**
 * Commit all context for a plan to ViewM4D (marks as published).
 * Sets committed_at timestamp on all PageContext records.
 */
export async function commitContext(planId: string): Promise<ContextCommitResponse> {
  const response = await fetch(`${API_BASE}/api/plans/${planId}/commit-context`, {
    method: 'POST',
  });
  return handleResponse<ContextCommitResponse>(response);
}

// =============================================================================
// Project-Wide Commit Preview API (All pointers with AI analysis)
// =============================================================================

export interface AIAnalysisPreview {
  technicalDescription: string | null;
  tradeCategory: string | null;
  identifiedElements: Array<string | { name: string; type: string; details: string }> | null;
  recommendations: string | null;
}

export interface PointerBounds {
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
}

export interface PointerCommitPreview {
  id: string;
  title: string;
  description: string | null;
  pageNumber: number;
  bounds: PointerBounds | null;
  cropPath: string | null;
  aiAnalysis: AIAnalysisPreview | null;
  committedAt: string | null;
}

export interface FileCommitPreview {
  id: string;
  name: string;
  pointerCount: number;
  pointersWithAi: number;
  pointers: PointerCommitPreview[];
}

export interface ProjectCommitPreviewSummary {
  totalFiles: number;
  totalPointers: number;
  pointersWithAi: number;
  pointersCommitted: number;
  filesWithAi: number;
}

export interface ProjectCommitPreviewResponse {
  projectId: string;
  projectName: string;
  files: FileCommitPreview[];
  summary: ProjectCommitPreviewSummary;
}

/**
 * Get project-wide commit preview showing ALL pointers with their AI analysis.
 * Used by the "Commit to ViewM4D" modal to preview what will be committed.
 */
export async function fetchProjectCommitPreview(projectId: string): Promise<ProjectCommitPreviewResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/commit-preview`);
  return handleResponse<ProjectCommitPreviewResponse>(response);
}

/**
 * Commit all context pointers for a project to ViewM4D.
 * Sets committed_at timestamp on all context pointers across all files.
 */
export async function commitProjectContext(projectId: string): Promise<ContextCommitResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/commit-context`, {
    method: 'POST',
  });
  return handleResponse<ContextCommitResponse>(response);
}

// =============================================================================
// Project Context Management (Un-commit, Clear AI, Delete All)
// =============================================================================

export interface UncommitResponse {
  pointersUncommitted: number;
  pagesUncommitted: number;
}

export interface ClearAIResponse {
  pointersCleared: number;
}

export interface DeletePointersResponse {
  pointersDeleted: number;
}

/**
 * Clear committed_at timestamps on all pointers (reverse commit).
 * Pointers remain but are no longer published to ViewM4D.
 */
export async function uncommitProjectPointers(projectId: string): Promise<UncommitResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/uncommit-pointers`, {
    method: 'POST',
  });
  return handleResponse<UncommitResponse>(response);
}

/**
 * Clear AI analysis from all pointers in a project.
 * Pointers remain but need to be re-processed with AI.
 */
export async function clearProjectAIAnalysis(projectId: string): Promise<ClearAIResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/clear-ai-analysis`, {
    method: 'POST',
  });
  return handleResponse<ClearAIResponse>(response);
}

/**
 * Delete ALL context pointers for a project.
 * Also cleans up associated crop images.
 */
export async function deleteAllProjectPointers(projectId: string): Promise<DeletePointersResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/pointers`, {
    method: 'DELETE',
  });
  return handleResponse<DeletePointersResponse>(response);
}

// =============================================================================
// AI Input Preview URLs (for showing images sent to Gemini)
// =============================================================================

/**
 * Get the URL for a context pointer's crop image.
 * This is the exact image that was sent to Gemini for analysis.
 */
export function getPointerCropImageUrl(pointerId: string): string {
  return `${API_BASE}/api/crops/${pointerId}`;
}

/**
 * Get the URL for a PDF page preview image.
 * This shows the equivalent of what was sent to Gemini for page context analysis.
 */
export function getPagePreviewImageUrl(fileId: string, pageNumber: number): string {
  return `${API_BASE}/api/pages/${fileId}/${pageNumber}/preview`;
}

// =============================================================================
// Project Context Summary API (Global context across all files)
// =============================================================================

export interface PointerSummaryBounds {
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
}

export interface PointerSummary {
  id: string;
  title: string;
  description: string | null;
  pageNumber: number;
  bounds?: PointerSummaryBounds;  // For zoom-to-fit on navigation
}

export interface PageSummary {
  id: string;
  pageNumber: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  hasContext: boolean;
  contextPreview: string | null;
  committedAt: string | null;
  pointerCount: number;
  pointers: PointerSummary[];
}

export interface FileSummary {
  id: string;
  name: string;
  fileType: string | null;
  pageCount: number;
  pointerCount: number;
  pagesComplete: number;
  pagesWithErrors: number;
  pagesCommitted: number;
  pages: PageSummary[];
}

export interface ProjectContextSummaryResponse {
  projectId: string;
  totalFiles: number;
  totalPages: number;
  totalPointers: number;
  pagesComplete: number;
  pagesWithErrors: number;
  pagesCommitted: number;
  files: FileSummary[];
}

/**
 * Fetch full context summary for a project across all PDF files.
 * Returns hierarchical data: project -> files -> pages -> pointers.
 */
export async function fetchProjectContextSummary(projectId: string): Promise<ProjectContextSummaryResponse> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/context-summary`);
  return handleResponse<ProjectContextSummaryResponse>(response);
}

// =============================================================================
// Batches API
// =============================================================================

export interface BatchCommitResponse {
  batchId: string;
  pointersCreated: number;
  status: string;
}

export interface BatchCommitRequest {
  batchId: string;
  projectId: string;
  processedAt: string;
  sheets: Array<{
    sheetId: string;
    fileName: string;
    pointers: Array<{
      id: string;
      originalMetadata: {
        title: string;
        description: string;
        pageNumber: number;
      };
      aiAnalysis: {
        technicalDescription: string;
        identifiedElements: Array<string | { symbol: string; meaning: string }>;
        tradeCategory: string;
        measurements?: Array<{ element: string; value: string; unit: string }>;
        issues?: Array<{ severity: string; description: string }>;
        recommendations?: string;
      };
    }>;
  }>;
}

/**
 * Commit a batch by creating ContextPointer records from ProcessedPointers.
 * This sends the full batch data to the Python backend.
 */
export async function commitBatch(request: BatchCommitRequest): Promise<BatchCommitResponse> {
  const response = await fetch(`${API_BASE}/api/batches/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse<BatchCommitResponse>(response);
}

// =============================================================================
// Users API
// =============================================================================

export async function fetchUsers(): Promise<UserResponse[]> {
  const response = await fetch(`${API_BASE}/api/users`);
  return handleResponse<UserResponse[]>(response);
}

export async function createUser(user: UserCreate): Promise<UserResponse> {
  const response = await fetch(`${API_BASE}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  return handleResponse<UserResponse>(response);
}

export async function fetchProjectUsers(projectId: string): Promise<UserResponse[]> {
  const response = await fetch(`${API_BASE}/api/projects/${projectId}/users`);
  return handleResponse<UserResponse[]>(response);
}

export async function assignUserToProject(userId: string, projectId: string): Promise<UserProjectResponse> {
  const response = await fetch(`${API_BASE}/api/users/${userId}/projects?project_id=${encodeURIComponent(projectId)}`, {
    method: 'POST',
  });
  return handleResponse<UserProjectResponse>(response);
}

export async function unassignUserFromProject(userId: string, projectId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/users/${userId}/projects/${projectId}`, {
    method: 'DELETE',
  });
  return handleResponse<void>(response);
}

// =============================================================================
// Utility: Check if backend is available
// =============================================================================

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

