import type {
  AgentMessage,
  AgentSession,
  AgentSessionSummary,
  ContextPointer,
  EnhancedQueryResponse,
  ProjectFile,
  ProjectFileTreeNode,
  Query,
  QueryResultWithPointer,
  User,
  UserWithProjects,
} from '../types';

// Use relative URL - Vite proxy forwards /api/* to backend
const API_BASE = '/api';

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Request failed';
}

class ApiService {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('viewm4d_token', token);
    } else {
      localStorage.removeItem('viewm4d_token');
    }
  }

  getToken(): string | null {
    if (!this.token) {
      this.token = localStorage.getItem('viewm4d_token');
    }
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const token = this.getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const fullUrl = `${API_BASE}${path}`;

    let res: Response;
    try {
      res = await fetch(fullUrl, { ...options, headers });
    } catch (fetchError) {
      throw fetchError;
    }

    if (res.status === 401) {
      this.setToken(null);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const detail =
        (data && typeof data.detail === 'string' && data.detail) ||
        (data && typeof data.message === 'string' && data.message) ||
        `Request failed (${res.status})`;
      throw new Error(detail);
    }

    if (res.status === 204) return null as T;
    return res.json();
  }

  private async requestBlob(path: string, options: RequestInit = {}): Promise<Blob> {
    const headers = new Headers(options.headers);
    const token = this.getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch (fetchError) {
      throw fetchError;
    }

    if (res.status === 401) {
      this.setToken(null);
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const detail =
        (data && typeof data.detail === 'string' && data.detail) ||
        `Request failed (${res.status})`;
      throw new Error(detail);
    }

    return res.blob();
  }

  // Auth
  async login(email: string, password: string) {
    const data = await this.request<{ user: User; token: string }>('/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  logout() {
    this.setToken(null);
  }

  // Users
  async getCurrentUser(userId: string) {
    return this.request<UserWithProjects>(`/users/${userId}`);
  }

  // Queries
  async getQueryHistory(userId: string, projectId?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (projectId) params.set('project_id', projectId);
    return this.request<EnhancedQueryResponse[]>(`/queries/user/${userId}/history?${params.toString()}`);
  }

  async createQuery(userId: string, projectId: string, transcript: string) {
    return this.request<EnhancedQueryResponse>('/queries', {
      method: 'POST',
      body: JSON.stringify({ userId, projectId, transcript }),
    });
  }

  async getQueryResults(queryId: string) {
    return this.request<QueryResultWithPointer[]>(`/queries/${queryId}/results`);
  }

  // Projects & Files
  async getProjectFilesTree(projectId: string) {
    return this.request<ProjectFileTreeNode[]>(`/projects/${projectId}/files/tree`);
  }

  async getProjectFiles(projectId: string) {
    return this.request<ProjectFile[]>(`/projects/${projectId}/files`);
  }

  async getFile(fileId: string) {
    return this.request<ProjectFile>(`/files/${fileId}`);
  }

  async getContextPointers(fileId: string) {
    return this.request<ContextPointer[]>(`/files/${fileId}/pointers`);
  }

  // Agent Sessions

  async getAgentSessions(projectId: string): Promise<AgentSessionSummary[]> {
    return this.request<AgentSessionSummary[]>(`/agent/sessions?projectId=${projectId}`);
  }

  async createAgentSession(projectId: string): Promise<AgentSession> {
    return this.request<AgentSession>('/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
  }

  async getAgentSession(sessionId: string): Promise<AgentSession> {
    return this.request<AgentSession>(`/agent/sessions/${sessionId}`);
  }

  async deleteAgentSession(sessionId: string): Promise<void> {
    return this.request<void>(`/agent/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async updateAgentSession(sessionId: string, title: string): Promise<AgentSession> {
    return this.request<AgentSession>(`/agent/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async sendAgentMessage(sessionId: string, query: string): Promise<AgentMessage> {
    return this.request<AgentMessage>(`/agent/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  async downloadFile(fileId: string) {
    return this.requestBlob(`/files/${fileId}/download`);
  }

  getFileDownloadUrl(fileId: string) {
    return `${API_BASE}/files/${fileId}/download`;
  }

  formatError(err: unknown) {
    return toErrorMessage(err);
  }
}

export const api = new ApiService();


