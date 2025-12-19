export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'superintendent';
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  status: string;
  progress: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserWithProjects extends User {
  assignedProjects: Project[];
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  path: string;
  fileType: string | null;
  parentId: string | null;
  isFolder: boolean;
  size: number | null;
  createdAt: string;
}

export interface ProjectFileTreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  fileType: string | null;
  size: number | null;
  children: ProjectFileTreeNode[];
}

export interface ContextPointer {
  id: string;
  fileId: string;
  title: string;
  description: string | null;
  pageNumber: number;
  bounds: {
    xNorm: number;
    yNorm: number;
    wNorm: number;
    hNorm: number;
  };
  style: {
    color: string;
    strokeWidth: number;
  };
  snapshotDataUrl: string | null;
  createdAt: string;
}

export interface Query {
  id: string;
  userId: string;
  projectId: string;
  transcript: string;
  response: string | null;
  createdAt: string;
}

export interface QueryResult {
  id: string;
  queryId: string;
  contextPointerId: string;
  relevanceScore: number | null;
  reason: string | null;
}

export interface QueryResultWithPointer extends QueryResult {
  contextPointer: ContextPointer;
}

// Enhanced query response from Grok agent
export interface ContextPointerResult {
  id: string;
  sheetId: string;
  sheetName: string;
  reason: string;
  bbox: { x: number; y: number; width: number; height: number };
}

export interface EnhancedQueryResponse {
  id: string;
  query: string;
  contextPointers: ContextPointerResult[];
  narrative: string;
  createdAt: string;
}

// Right panel state machine types
export type RightPanelState =
  | { type: 'empty' }
  | { type: 'loading'; query: string }
  | { type: 'results'; query: string; results: QueryResults }
  | { type: 'history' };

export interface QueryResults {
  contextPointers: Array<{
    id: string;
    sheetId: string;
    sheetName: string;
    reason: string;
    bbox?: { x: number; y: number; width: number; height: number };
  }>;
  narrative: string;
  timestamp: Date;
}

export interface QueryHistoryItem extends Query {
  results?: QueryResults;
}
