/**
 * Types for n8n batch export and processing system
 */

// ============================================
// Export Types (Frontend -> API -> n8n)
// ============================================

export interface ExportPointerMetadata {
  title: string;
  description: string;
  pageNumber: number;
  boundingBox: {
    xNorm: number;
    yNorm: number;
    wNorm: number;
    hNorm: number;
  } | null;
}

export interface ExportPointer {
  id: string;
  imageBase64: string; // stripped from data:image/png;base64,
  metadata: ExportPointerMetadata;
}

export interface ExportSheet {
  sheetId: string;
  fileName: string;
  pointers: ExportPointer[];
}

export interface ExportBatchPayload {
  batchId: string;
  sheets: ExportSheet[];
}

export interface ExportBatchResponse {
  success: boolean;
  batchId: string;
  message: string;
  path?: string;
}

// ============================================
// Manifest (written to watch_inbox)
// ============================================

export interface BatchManifest {
  batchId: string;
  exportedAt: string;
  sheets: Array<{
    sheetId: string;
    fileName: string;
    pointerIds: string[];
  }>;
}

// ============================================
// Processed Types (n8n -> API -> Frontend)
// ============================================

// Identified elements can be strings or symbol/meaning pairs (from legend data)
export type IdentifiedElement = string | { symbol: string; meaning: string };

export interface AIAnalysis {
  technicalDescription: string;
  identifiedElements: IdentifiedElement[];
  tradeCategory: string;
  measurements?: Array<{
    element: string;
    value: string;
    unit: string;
  }>;
  issues?: Array<{
    severity: 'info' | 'warning' | 'critical';
    description: string;
  }>;
  recommendations?: string;
}

export interface ProcessedPointer {
  id: string;
  originalMetadata: {
    title: string;
    description: string;
    pageNumber: number;
  };
  aiAnalysis: AIAnalysis;
}

export interface ProcessedSheet {
  sheetId: string;
  fileName: string;
  pointers: ProcessedPointer[];
}

export interface ProcessedBatch {
  batchId: string;
  processedAt: string;
  sheets: ProcessedSheet[];
}

// ============================================
// API Response Types
// ============================================

export interface ProcessedBatchSummary {
  batchId: string;
  hasResults: boolean;
  processedAt: string | null;
  sheetCount: number;
  pointerCount: number;
}

export interface ProcessedBatchesResponse {
  batches: ProcessedBatchSummary[];
}

export interface DeleteBatchResponse {
  success: boolean;
  message: string;
}

