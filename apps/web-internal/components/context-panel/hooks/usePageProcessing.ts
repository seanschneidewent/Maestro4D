import { useState, useCallback, useRef, useEffect } from 'react';
import {
  fetchContextTreeProcessingStatus,
  triggerPageProcessing,
  getProcessingProgressSSEUrl,
  ProjectProcessingStatusResponse,
} from '../../../utils/api';

// =============================================================================
// Types
// =============================================================================

export type PageProcessingStatus = 'idle' | 'processing' | 'complete';

export interface PageProgress {
  complete: number;
  total: number;
}

export interface CurrentPage {
  sheetNumber: string | null;
  discipline: string | null;
}

interface UsePageProcessingReturn {
  status: PageProcessingStatus;
  pass1Progress: PageProgress;
  pass2Progress: PageProgress;
  currentPage: CurrentPage | null;
  startProcessing: () => void;
  cancelProcessing: () => void;
  error: string | null;
}

// SSE Event data types
interface PagePass1CompleteEvent {
  pageId: string;
  sheetNumber: string | null;
  discipline: string | null;
  pass1Progress: number;
  pass1Total: number;
}

interface PagePass2CompleteEvent {
  pageId: string;
  sheetNumber: string | null;
  pass2Progress: number;
  pass2Total: number;
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
const POLLING_INTERVAL_MS = 2000;

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePageProcessing(projectId: string | null): UsePageProcessingReturn {
  // State
  const [status, setStatus] = useState<PageProcessingStatus>('idle');
  const [pass1Progress, setPass1Progress] = useState<PageProgress>({ complete: 0, total: 0 });
  const [pass2Progress, setPass2Progress] = useState<PageProgress>({ complete: 0, total: 0 });
  const [currentPage, setCurrentPage] = useState<CurrentPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup and reconnection
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_DELAY_MS);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Use ref for status to avoid stale closures in SSE reconnection logic
  const statusRef = useRef<PageProcessingStatus>('idle');

  // Clear reconnection timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Clear polling interval
  const clearPollingInterval = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Poll for status updates as a fallback for SSE
  const pollStatus = useCallback(async () => {
    if (!projectId || !isMountedRef.current) return;

    try {
      const statusResponse = await fetchContextTreeProcessingStatus(projectId);
      if (!isMountedRef.current) return;

      const { pages } = statusResponse;
      
      // Update progress - this ensures live updates even if SSE fails
      setPass1Progress({ complete: pages.pass1Complete, total: pages.total });
      setPass2Progress({ complete: pages.pass2Complete, total: pages.total });

      // Update status if it changed
      if (pages.status !== statusRef.current) {
        statusRef.current = pages.status;
        setStatus(pages.status);
        
        // If processing completed or went idle, stop polling
        if (pages.status === 'complete' || pages.status === 'idle') {
          clearPollingInterval();
        }
      }
    } catch (err) {
      // Silently fail - SSE or next poll will recover
      console.warn('Polling status failed:', err);
    }
  }, [projectId, clearPollingInterval]);

  // Start polling for status updates
  const startPolling = useCallback(() => {
    // Clear any existing interval
    clearPollingInterval();
    
    // Start new polling interval
    pollingIntervalRef.current = setInterval(() => {
      if (statusRef.current === 'processing') {
        pollStatus();
      } else {
        // Stop polling if no longer processing
        clearPollingInterval();
      }
    }, POLLING_INTERVAL_MS);
  }, [clearPollingInterval, pollStatus]);

  // Update status and ref together
  const updateStatus = useCallback((newStatus: PageProcessingStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
  }, []);

  // Fetch initial status
  const fetchInitialStatus = useCallback(async () => {
    if (!projectId) return;

    try {
      const statusResponse = await fetchContextTreeProcessingStatus(projectId);
      if (!isMountedRef.current) return;

      const { pages } = statusResponse;
      updateStatus(pages.status);
      setPass1Progress({ complete: pages.pass1Complete, total: pages.total });
      setPass2Progress({ complete: pages.pass2Complete, total: pages.total });

      // Clear error on successful fetch
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error('Failed to fetch initial processing status:', err);
    }
  }, [projectId, updateStatus]);

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
                  console.log('SSE connected for page processing');
                  break;

                case 'page_pass1_complete': {
                  const evt = data as PagePass1CompleteEvent;
                  setPass1Progress({ complete: evt.pass1Progress, total: evt.pass1Total });
                  setCurrentPage({ sheetNumber: evt.sheetNumber, discipline: evt.discipline });
                  updateStatus('processing');
                  break;
                }

                case 'page_pass2_complete': {
                  const evt = data as PagePass2CompleteEvent;
                  setPass2Progress({ complete: evt.pass2Progress, total: evt.pass2Total });
                  setCurrentPage({ sheetNumber: evt.sheetNumber, discipline: null });
                  break;
                }

                case 'processing_complete': {
                  const evt = data as ProcessingCompleteEvent;
                  if (evt.phase === 'pages') {
                    updateStatus('complete');
                    setCurrentPage(null);
                  }
                  break;
                }

                case 'processing_error': {
                  const evt = data as ProcessingErrorEvent;
                  if (evt.phase === 'pages') {
                    setError(evt.error);
                    updateStatus('idle');
                    setCurrentPage(null);
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

      // Schedule reconnection with exponential backoff - use ref to avoid stale closure
      if (statusRef.current === 'processing') {
        clearReconnectTimeout();
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && statusRef.current === 'processing') {
            reconnectDelayRef.current = Math.min(
              reconnectDelayRef.current * 2,
              MAX_RECONNECT_DELAY_MS
            );
            connectToSSE();
          }
        }, reconnectDelayRef.current);
      }
    }
  }, [projectId, clearReconnectTimeout, updateStatus]);

  // Start processing
  const startProcessing = useCallback(async () => {
    if (!projectId) return;

    setError(null);
    updateStatus('processing');
    setPass1Progress({ complete: 0, total: 0 });
    setPass2Progress({ complete: 0, total: 0 });
    setCurrentPage(null);

    try {
      const result = await triggerPageProcessing(projectId);

      if (result.status === 'already_running') {
        // Already running, just connect to SSE
        console.log('Page processing already running, connecting to progress stream');
      }

      // Connect to SSE for progress updates
      // Note: The effect will also try to connect, but connectToSSE aborts any existing connection first
      connectToSSE();
      
      // Start polling as a fallback for SSE reliability
      startPolling();
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to start processing';
      setError(msg);
      updateStatus('idle');
    }
  }, [projectId, connectToSSE, updateStatus, startPolling]);

  // Cancel processing (aborts SSE connection and polling)
  const cancelProcessing = useCallback(() => {
    clearReconnectTimeout();
    clearPollingInterval();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Note: This only cancels the SSE subscription and polling, not the backend processing
    // Backend processing continues - we just stop receiving updates
  }, [clearReconnectTimeout, clearPollingInterval]);

  // Fetch initial status on mount
  useEffect(() => {
    isMountedRef.current = true;
    fetchInitialStatus();

    return () => {
      isMountedRef.current = false;
      clearReconnectTimeout();
      clearPollingInterval();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchInitialStatus, clearReconnectTimeout, clearPollingInterval]);

  // Auto-connect to SSE and start polling if already processing
  useEffect(() => {
    if (status === 'processing' && projectId) {
      // Connect to SSE if not already connected
      if (!abortControllerRef.current) {
        connectToSSE();
      }
      // Start polling if not already polling
      if (!pollingIntervalRef.current) {
        startPolling();
      }
    } else {
      // Stop polling when no longer processing
      clearPollingInterval();
    }
  }, [status, projectId, connectToSSE, startPolling, clearPollingInterval]);

  return {
    status,
    pass1Progress,
    pass2Progress,
    currentPage,
    startProcessing,
    cancelProcessing,
    error,
  };
}

