import { useState, useCallback, useEffect, useRef } from 'react';
import {
  fetchPageContexts,
  ContextTreePageContext,
} from '../../../utils/api';

// =============================================================================
// Types
// =============================================================================

interface UsePageContextsReturn {
  pages: ContextTreePageContext[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  filterByDiscipline: (code: string | null) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePageContexts(projectId: string | null): UsePageContextsReturn {
  const [pages, setPages] = useState<ContextTreePageContext[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<string | null>(null);

  const isMountedRef = useRef(true);

  // Fetch page contexts
  const fetchData = useCallback(async () => {
    if (!projectId) {
      setPages([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchPageContexts(projectId, disciplineFilter);
      if (!isMountedRef.current) return;

      setPages(data);
    } catch (err) {
      if (!isMountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'Failed to fetch page contexts';
      setError(msg);
      setPages([]);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectId, disciplineFilter]);

  // Manual refetch
  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // Filter by discipline code
  const filterByDiscipline = useCallback((code: string | null) => {
    setDisciplineFilter(code);
  }, []);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    isMountedRef.current = true;
    fetchData();

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  return {
    pages,
    loading,
    error,
    refetch,
    filterByDiscipline,
  };
}

// Re-export type for consumers
export type { ContextTreePageContext };

