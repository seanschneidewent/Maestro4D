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

// Text content extracted from PDF region with bounding boxes
export interface TextElement {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  font: string;
  size: number;
}

export interface TextContent {
  fullText: string;
  textElements: TextElement[];
  clipRect: { x0: number; y0: number; x1: number; y1: number };
  pageWidth: number;
  pageHeight: number;
}

// Text highlight from agent response matching pointer text content
export interface TextHighlight {
  pointerId: string;
  bboxNormalized: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  matchedText: string;
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
  textContent?: TextContent;  // Extracted text with bounding boxes
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

// Agent session summary (for history list)
export interface AgentSessionSummary {
  id: string;
  projectId: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// Full agent session with messages
export interface AgentSession {
  id: string;
  projectId: string;
  title: string | null;
  messages: AgentMessage[];
  createdAt: string;
  updatedAt: string;
}

// Individual message in a session
export interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;              // User question OR agent short answer
  narrative?: string;           // Agent only: full response for viewer overlay
  sheets?: AgentSheetResult[];  // Agent only: grouped pointers by sheet
  highlights?: TextHighlight[]; // Agent only: text highlights within pointers
  createdAt: string;
}

// Sheet with its relevant pointers
export interface AgentSheetResult {
  sheetId: string;
  sheetName: string;
  pointers: AgentPointerResult[];
}

// Individual pointer result
export interface AgentPointerResult {
  id: string;
  reason: string;
}

// API request for creating a message
export interface AgentMessageRequest {
  query: string;
}

// API request for creating a session
export interface AgentSessionCreateRequest {
  projectId: string;
}

// API request for updating session
export interface AgentSessionUpdateRequest {
  title: string;
}