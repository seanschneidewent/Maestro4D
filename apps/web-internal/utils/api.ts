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

