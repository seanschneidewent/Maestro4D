export type PdfTool = 'pen' | 'text' | 'arrow' | 'rectangle';

export interface PdfNormalizedPoint {
  xNorm: number;
  yNorm: number;
}

export type PdfAnnotation =
  | { kind: 'stroke'; points: PdfNormalizedPoint[]; color: string; width: number }
  | { kind: 'text'; id: string; xNorm: number; yNorm: number; wNorm: number; hNorm: number; text: string; html?: string; color?: string; fontSize?: number }
  | { kind: 'arrow'; id: string; startXNorm: number; startYNorm: number; endXNorm: number; endYNorm: number; color: string; width: number; xNorm: number; yNorm: number; wNorm: number; hNorm: number; text: string; html?: string; textColor?: string; fontSize?: number; linkedRectangleId?: string; groupId?: string }
  | { kind: 'rectangle'; id: string; xNorm: number; yNorm: number; wNorm: number; hNorm: number; color: string; width: number; groupId?: string; snapshotDataUrl?: string };

// Legacy interface for backward compatibility
export interface PdfStroke {
  points: PdfNormalizedPoint[];
  color: string;
  width: number;
  tool: PdfTool;
}

// Annotation group linking rectangle snapshots with arrow text annotations
export interface AnnotationGroup {
  id: string; // Unique group ID shared between rectangle and arrow
  rectangleId: string; // ID of the rectangle annotation
  arrowId: string; // ID of the arrow annotation
  pageNumber: number; // Page number where annotations exist
  snapshotDataUrl: string; // PNG data URL of the captured region
  text: string; // Text content from arrow annotation
  html?: string; // HTML content from arrow annotation
  createdAt: string; // ISO timestamp of creation
}

export interface ScanData {
  date: string;
  modelUrl?: string;
  pdfUrl?: string;
  pdfAnnotations?: Record<number, PdfAnnotation[]>;
  pdfAnnotationGroups?: AnnotationGroup[]; // Linked annotation groups with snapshots
  insights: Insight[];
}

export type AgentType = 'market' | 'spec';

export interface Message {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export interface SerializableFile {
  name: string;
  type: string;
  size: number;
  content: string; // base64 data URL
}

export interface AgentState {
    chatHistory: Message[];
    uploadedFiles: SerializableFile[];
}


export interface Project {
  id: string;
  name: string;
  status: 'Active' | 'Completed';
  lastScan: {
    type: 'As-Built Scan' | 'Progress Scan';
    date: string; // YYYY-MM-DD
  };
  lastScanTimeAgo: string;
  imageUrl?: string;
  progress: number;
  issues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  modelUrl?: string;
  scans?: ScanData[];
  agentStates?: Record<AgentType, AgentState>;
}

// Fix: Add InsightType enum
export enum InsightType {
  Clash = 'Clash',
}

// Fix: Add Severity enum
export enum Severity {
  Critical = 'Critical',
  High = 'High',
  Medium = 'Medium',
  Low = 'Low',
}

// Fix: Add InsightStatus enum
export enum InsightStatus {
  Open = 'Open',
  Acknowledged = 'Acknowledged',
  Resolved = 'Resolved',
  Muted = 'Muted',
}

// Fix: Add Status type alias for InsightStatus
export type Status = InsightStatus;

// Fix: Add Note interface
export interface Note {
  id: string;
  text: string;
  author: string;
  timestamp: string;
}

// Fix: Add Insight interface
export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  assignedTo?: string;
  status: InsightStatus;
  severity: Severity;
  elementIds: string[];
  detectedAt: string;
  tags: string[];
  source: {
    system: string;
    file: string;
    row: number;
    // Add these new optional fields:
    itemA?: string;
    itemB?: string;
    clearance?: string;
    approved?: string;
    group?: string;
  };
  notes: Note[];
  files?: File[];
}

// Fix: Add ProjectSummary interface to fix type errors in MetricsPanel
export interface ProjectSummary {
  projectName: string;
  captureDate: string;
  totalDeviations: number;
  deviationsBySeverity: Record<string, number>;
  deviationsByStatus: Record<string, number>;
}