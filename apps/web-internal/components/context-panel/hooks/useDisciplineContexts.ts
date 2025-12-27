import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchDisciplineContexts,
  DisciplineContext,
} from '../../../utils/api';

// =============================================================================
// Types
// =============================================================================

interface UseDisciplineContextsOptions {
  /** If true, creates default disciplines if none exist. Default: true */
  ensureExist?: boolean;
}

interface UseDisciplineContextsReturn {
  disciplines: DisciplineContext[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useDisciplineContexts(
  projectId: string | null,
  options: UseDisciplineContextsOptions = {}
): UseDisciplineContextsReturn {
  const { ensureExist = true } = options;
  
  const [disciplines, setDisciplines] = useState<DisciplineContext[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Fetch discipline contexts
  const fetchData = useCallback(async () => {
    if (!projectId) {
      setDisciplines([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchDisciplineContexts(projectId, ensureExist);
      if (!isMountedRef.current) return;

      setDisciplines(data);
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to fetch discipline contexts';
      setError(msg);
      setDisciplines([]);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectId, ensureExist]);

  // Manual refetch
  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  return {
    disciplines,
    loading,
    error,
    refetch,
  };
}

// Re-export type for consumers
export type { DisciplineContext };

