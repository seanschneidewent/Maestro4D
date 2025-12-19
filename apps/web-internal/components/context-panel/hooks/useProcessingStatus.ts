import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchProcessingStatus, ProcessingStatusResponse } from '../../../utils/api';

const POLL_INTERVAL_MS = 2000;

interface UseProcessingStatusOptions {
  planId: string | null;
  autoStart?: boolean;
}

interface UseProcessingStatusReturn {
  status: ProcessingStatusResponse | null;
  isPolling: boolean;
  isProcessing: boolean;
  isComplete: boolean;
  hasErrors: boolean;
  error: string | null;
  startPolling: () => void;
  stopPolling: () => void;
  refresh: () => Promise<void>;
}

export function useProcessingStatus({ 
  planId, 
  autoStart = false 
}: UseProcessingStatusOptions): UseProcessingStatusReturn {
  const [status, setStatus] = useState<ProcessingStatusResponse | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Derived state
  const isProcessing = status !== null && (status.processing > 0 || status.pending > 0);
  const isComplete = status !== null && status.completed === status.total && status.total > 0;
  const hasErrors = status !== null && status.errors > 0;

  const fetchStatus = useCallback(async () => {
    if (!planId) return;
    
    try {
      const result = await fetchProcessingStatus(planId);
      if (isMountedRef.current) {
        setStatus(result);
        setError(null);
        
        // Auto-stop polling when processing is complete (no pending or processing items)
        if (result.processing === 0 && result.pending === 0 && result.total > 0) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            setIsPolling(false);
          }
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch processing status');
      }
    }
  }, [planId]);

  const startPolling = useCallback(() => {
    if (!planId || intervalRef.current) return;
    
    setIsPolling(true);
    // Fetch immediately
    fetchStatus();
    
    // Then poll at interval
    intervalRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
  }, [planId, fetchStatus]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Auto-start polling if enabled
  useEffect(() => {
    if (autoStart && planId) {
      startPolling();
    }
    
    return () => {
      stopPolling();
    };
  }, [autoStart, planId, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Reset status when planId changes
  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [planId]);

  return {
    status,
    isPolling,
    isProcessing,
    isComplete,
    hasErrors,
    error,
    startPolling,
    stopPolling,
    refresh,
  };
}

