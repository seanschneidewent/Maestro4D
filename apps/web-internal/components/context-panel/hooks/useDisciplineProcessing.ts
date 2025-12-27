import { useState, useCallback, useRef, useEffect } from 'react';
import {
  fetchContextTreeProcessingStatus,
  triggerDisciplineProcessing,
  getProcessingProgressSSEUrl,
  fetchDisciplineContexts,
  DisciplineContext,
} from '../../../utils/api';

// =============================================================================
// Types
// =============================================================================

export type DisciplineProcessingStatus = 'idle' | 'processing' | 'complete';

export interface DisciplineInfo {
  code: string;
  name: string;
  status: 'waiting' | 'ready' | 'processing' | 'complete';
  pageProgress?: { complete: number; total: number };
}

export interface DisciplineProgress {
  complete: number;
  total: number;
}

export interface CurrentDiscipline {
  code: string;
  name: string;
}

interface UseDisciplineProcessingReturn {
  status: DisciplineProcessingStatus;
  disciplines: DisciplineInfo[];
  currentDiscipline: CurrentDiscipline | null;
  progress: DisciplineProgress;
  startProcessing: () => void;
  error: string | null;
}

// SSE Event data types
interface DisciplineReadyEvent {
  disciplineCode: string;
  disciplineName: string;
}

interface DisciplineCompleteEvent {
  disciplineCode: string;
  disciplineName: string;
  progress: number;
  total: number;
}

interface ProcessingCompleteEvent {
  phase: 'pages' | 'disciplines';
}

interface ProcessingErrorEvent {
  phase: 'pages' | 'disciplines';
  error: string;
}

// =============================================================================
// Constants
// =============================================================================

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

// =============================================================================
// Helper Functions
// =============================================================================

function mapDisciplineContextToInfo(ctx: DisciplineContext): DisciplineInfo {
  return {
    code: ctx.code,
    name: ctx.name,
    status: ctx.processingStatus as DisciplineInfo['status'],
  };
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useDisciplineProcessing(projectId: string | null): UseDisciplineProcessingReturn {
  // State
  const [status, setStatus] = useState<DisciplineProcessingStatus>('idle');
  const [disciplines, setDisciplines] = useState<DisciplineInfo[]>([]);
  const [currentDiscipline, setCurrentDiscipline] = useState<CurrentDiscipline | null>(null);
  const [progress, setProgress] = useState<DisciplineProgress>({ complete: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup and reconnection
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);

  // Clear reconnection timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Fetch initial status and disciplines
  const fetchInitialStatus = useCallback(async () => {
    if (!projectId) return;

    try {
      // Fetch both processing status and discipline list in parallel
      // Use ensureExist=true to create default disciplines if none exist
      const [statusResponse, disciplineList] = await Promise.all([
        fetchContextTreeProcessingStatus(projectId),
        fetchDisciplineContexts(projectId, true), // ensureExist: true
      ]);

      if (!isMountedRef.current) return;

      const { disciplines: disciplineStatus } = statusResponse;
      setStatus(disciplineStatus.status);
      setProgress({ complete: disciplineStatus.complete, total: disciplineStatus.total });

      // Map discipline contexts to discipline info
      setDisciplines(disciplineList.map(mapDisciplineContextToInfo));

      // Clear error on successful fetch
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Failed to fetch initial discipline status:', err);
    }
  }, [projectId]);

  // SSE connection handler
  const connectToSSE = useCallback(async () => {
    if (!projectId || !isMountedRef.current) return;

    // Abort any existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(getProcessingProgressSSEUrl(projectId), {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body for SSE');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      // Reset reconnect delay on successful connection
      reconnectDelayRef.current = RECONNECT_DELAY_MS;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6));

              if (!isMountedRef.current) return;

              switch (eventType) {
                case 'connected':
                  // Connection established
                  break;

                case 'discipline_ready': {
                  const evt = data as DisciplineReadyEvent;
                  // Update discipline status to ready
                  setDisciplines(prev =>
                    prev.map(d =>
                      d.code === evt.disciplineCode ? { ...d, status: 'ready' as const } : d
                    )
                  );
                  break;
                }

                case 'discipline_complete': {
                  const evt = data as DisciplineCompleteEvent;
                  setProgress({ complete: evt.progress, total: evt.total });
                  setCurrentDiscipline(null);
                  // Update discipline status to complete
                  setDisciplines(prev =>
                    prev.map(d =>
                      d.code === evt.disciplineCode ? { ...d, status: 'complete' as const } : d
                    )
                  );
                  break;
                }

                case 'discipline_processing': {
                  // Custom event when a discipline starts processing
                  const evt = data as DisciplineReadyEvent;
                  setCurrentDiscipline({ code: evt.disciplineCode, name: evt.disciplineName });
                  setStatus('processing');
                  // Update discipline status to processing
                  setDisciplines(prev =>
                    prev.map(d =>
                      d.code === evt.disciplineCode ? { ...d, status: 'processing' as const } : d
                    )
                  );
                  break;
                }

                case 'processing_complete': {
                  const evt = data as ProcessingCompleteEvent;
                  if (evt.phase === 'disciplines') {
                    setStatus('complete');
                    setCurrentDiscipline(null);
                  }
                  break;
                }

                case 'processing_error': {
                  const evt = data as ProcessingErrorEvent;
                  if (evt.phase === 'disciplines') {
                    setError(evt.error);
                    setStatus('idle');
                    setCurrentDiscipline(null);
                  }
                  break;
                }
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
            eventType = '';
          }
        }
      }
    } catch (err) {
      if (!isMountedRef.current) return;

      // Don't treat abort as an error
      if ((err as Error).name === 'AbortError') {
        return;
      }

      console.error('SSE connection error:', err);

      // Schedule reconnection with exponential backoff
      if (status === 'processing') {
        clearReconnectTimeout();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY_MS
            );
            connectToSSE();
          }
        }, reconnectDelayRef.current);
      }
    }
  }, [projectId, status, clearReconnectTimeout]);

  // Start processing
  const startProcessing = useCallback(async () => {
    if (!projectId) return;

    setError(null);
    setStatus('processing');
    setCurrentDiscipline(null);

    try {
      const result = await triggerDisciplineProcessing(projectId);

      if (result.status === 'already_running') {
        console.log('Discipline processing already running, connecting to progress stream');
      }

      // Connect to SSE for progress updates
      connectToSSE();
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to start discipline processing';
      setError(msg);
      setStatus('idle');
    }
  }, [projectId, connectToSSE]);

  // Fetch initial status on mount
  useEffect(() => {
    isMountedRef.current = true;
    fetchInitialStatus();

    return () => {
      isMountedRef.current = false;
      clearReconnectTimeout();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchInitialStatus, clearReconnectTimeout]);

  // Auto-connect to SSE if already processing
  useEffect(() => {
    if (status === 'processing' && projectId && !abortControllerRef.current) {
      connectToSSE();
    }
  }, [status, projectId, connectToSSE]);

  return {
    status,
    disciplines,
    currentDiscipline,
    progress,
    startProcessing,
    error,
  };
}

