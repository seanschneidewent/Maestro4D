import { useState, useCallback, useRef } from 'react';
import { fetchProjectCommitPreview } from '../../../utils/api';

// Types for the streaming API
interface PointerInput {
  id: string;
  imageBase64: string;
  title: string;
  description: string;
  pageNumber: number;
  sourceFile: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface SheetInput {
  sheetId: string;
  fileName: string;
  pointers: PointerInput[];
}

// Matches ProcessedPointer from types/n8n.ts
interface ProcessedPointer {
  id: string;
  originalMetadata: {
    title: string;
    description: string;
    pageNumber: number;
    boundingBox?: object;
    sourceFile: string;
  };
  aiAnalysis: {
    technicalDescription: string;
    identifiedElements: Array<{ name: string; type: string; details: string }> | string[];
    tradeCategory: string;
    measurements?: Array<{ value: string; unit: string; context: string }>;
    issues?: Array<{ severity: string; description: string }>;
    recommendations?: string;
  } | null;
  error?: string;
}

interface StreamingResult {
  success: boolean;
  batchId: string;
  sheetId: string;
  fileName: string;
  pointer: ProcessedPointer;
  progress: {
    current: number;
    total: number;
  };
}

interface ProcessingState {
  isProcessing: boolean;
  progress: { current: number; total: number };
  processedPointers: StreamingResult[];
  error: string | null;
  batchId: string | null;
}

const API_BASE = 'http://localhost:8000';

// #region agent log
const debugLog = (location: string, message: string, data: object, hypothesisId: string) => {
  fetch('http://127.0.0.1:7243/ingest/6d569bee-72b8-4760-bb05-e3f164c6af6f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location,message,data,timestamp:Date.now(),sessionId:'debug-session',hypothesisId})}).catch(()=>{});
};
// #endregion

export function useAIProcessing() {
  const [state, setState] = useState<ProcessingState>({
    isProcessing: false,
    progress: { current: 0, total: 0 },
    processedPointers: [],
    error: null,
    batchId: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const processWithAI = useCallback(async (
    batchId: string,
    sheets: SheetInput[],
    onPointerComplete?: (result: StreamingResult) => void
  ): Promise<boolean> => {
    // Reset state
    setState({
      isProcessing: true,
      progress: { current: 0, total: 0 },
      processedPointers: [],
      error: null,
      batchId,
    });

    abortControllerRef.current = new AbortController();

    try {
      // Transform to API format (snake_case)
      const requestBody = {
        batch_id: batchId,
        sheets: sheets.map(sheet => ({
          sheet_id: sheet.sheetId,
          file_name: sheet.fileName,
          pointers: sheet.pointers.map(p => ({
            id: p.id,
            image_base64: p.imageBase64,
            title: p.title,
            description: p.description,
            page_number: p.pageNumber,
            source_file: p.sourceFile,
            bounding_box: p.boundingBox || null,
          })),
        })),
      };

      // #region agent log
      debugLog('useAIProcessing.ts:beforeFetch', 'About to call API', { url: `${API_BASE}/api/ai/process-stream`, sheetCount: sheets.length, pointerCount: sheets.reduce((s, sh) => s + sh.pointers.length, 0) }, 'H2-H3');
      // #endregion

      const response = await fetch(`${API_BASE}/api/ai/process-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      // #region agent log
      debugLog('useAIProcessing.ts:afterFetch', 'Got response', { status: response.status, ok: response.ok, statusText: response.statusText }, 'H2-H3');
      // #endregion

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (eventType === 'batch_start') {
                setState(prev => ({
                  ...prev,
                  progress: { current: 0, total: data.totalPointers },
                }));
              } else if (eventType === 'pointer_complete') {
                const result = data as StreamingResult;
                setState(prev => ({
                  ...prev,
                  progress: result.progress,
                  processedPointers: [...prev.processedPointers, result],
                }));
                onPointerComplete?.(result);
              } else if (eventType === 'batch_complete') {
                setState(prev => ({
                  ...prev,
                  isProcessing: false,
                }));
              } else if (eventType === 'error') {
                console.error('Pointer error:', data);
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
            eventType = '';
          }
        }
      }

      return true;
    } catch (error) {
      // #region agent log
      debugLog('useAIProcessing.ts:catch', 'Error caught', { errorName: (error as Error).name, errorMessage: (error as Error).message }, 'H2-H3');
      // #endregion
      if ((error as Error).name === 'AbortError') {
        setState(prev => ({ ...prev, isProcessing: false, error: 'Cancelled' }));
        return false;
      }
      const msg = error instanceof Error ? error.message : 'Unknown error';
      setState(prev => ({ ...prev, isProcessing: false, error: msg }));
      return false;
    }
  }, []);

  const cancelProcessing = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancelProcessing();
    setState({
      isProcessing: false,
      progress: { current: 0, total: 0 },
      processedPointers: [],
      error: null,
      batchId: null,
    });
  }, [cancelProcessing]);

  /**
   * Load persisted pointers with AI analysis from the database.
   * Called on mount to restore processed pointers after browser refresh.
   */
  const loadPersistedPointers = useCallback(async (projectId: string) => {
    try {
      const preview = await fetchProjectCommitPreview(projectId);
      const results: StreamingResult[] = [];
      
      for (const file of preview.files) {
        for (const pointer of file.pointers) {
          if (pointer.aiAnalysis) {
            results.push({
              success: true,
              batchId: 'persisted',
              sheetId: file.id,
              fileName: file.name,
              pointer: {
                id: pointer.id,
                originalMetadata: {
                  title: pointer.title,
                  description: pointer.description || '',
                  pageNumber: pointer.pageNumber,
                  sourceFile: file.name,
                },
                aiAnalysis: {
                  technicalDescription: pointer.aiAnalysis.technicalDescription || '',
                  tradeCategory: pointer.aiAnalysis.tradeCategory || '',
                  identifiedElements: pointer.aiAnalysis.identifiedElements || [],
                  recommendations: pointer.aiAnalysis.recommendations || '',
                },
              },
              progress: { current: 0, total: 0 },
            });
          }
        }
      }
      
      setState(prev => ({ ...prev, processedPointers: results }));
      return results.length;
    } catch (error) {
      console.error('Failed to load persisted pointers:', error);
      return 0;
    }
  }, []);

  return {
    ...state,
    processWithAI,
    cancelProcessing,
    reset,
    loadPersistedPointers,
  };
}

// Helper to strip data URL prefix from base64
export function stripBase64Prefix(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  return match ? match[1] : dataUrl;
}

// Export types for consumers
export type { SheetInput, PointerInput, StreamingResult, ProcessedPointer, ProcessingState };

