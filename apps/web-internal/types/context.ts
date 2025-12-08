export interface ContextPointer {
  id: string;
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

  title: string;
  description: string;

  snapshotDataUrl: string | null;
  createdAt: string;
}

export interface SheetContext {
  fileId: string;
  fileName: string;
  pointers: ContextPointer[];

  addedToContext: boolean;

  markdownContent: string | null;
  markdownGeneratedAt: string | null;
  generationStatus: 'idle' | 'generating' | 'complete' | 'error';
  generationError?: string;
}

export interface ContextTree {
  sheets: Record<string, SheetContext>;
}

// Helper to create an empty sheet context
export function createEmptySheetContext(fileId: string, fileName: string): SheetContext {
  return {
    fileId,
    fileName,
    pointers: [],
    addedToContext: false,
    markdownContent: null,
    markdownGeneratedAt: null,
    generationStatus: 'idle',
  };
}

