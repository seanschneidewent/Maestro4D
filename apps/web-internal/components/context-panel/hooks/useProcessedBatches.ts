import { useState, useCallback } from 'react';
import { 
  ProcessedBatch, 
  ProcessedBatchSummary,
  ProcessedBatchesResponse,
  DeleteBatchResponse 
} from '../../../types/n8n';

const API_BASE_URL = 'http://localhost:3001';

interface UseProcessedBatchesResult {
  batches: ProcessedBatchSummary[];
  isLoading: boolean;
  error: string | null;
  selectedBatch: ProcessedBatch | null;
  isLoadingDetails: boolean;
  fetchBatches: () => Promise<void>;
  fetchBatchDetails: (batchId: string) => Promise<ProcessedBatch | null>;
  discardBatch: (batchId: string) => Promise<boolean>;
  clearSelectedBatch: () => void;
}

/**
 * Hook for fetching and managing processed batches from n8n
 */
export function useProcessedBatches(): UseProcessedBatchesResult {
  const [batches, setBatches] = useState<ProcessedBatchSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ProcessedBatch | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  /**
   * Fetch list of all processed batches
   */
  const fetchBatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/processed-batches`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data: ProcessedBatchesResponse = await response.json();
      setBatches(data.batches);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch batches';
      setError(errorMessage);
      setBatches([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetch full details for a specific batch
   */
  const fetchBatchDetails = useCallback(async (batchId: string): Promise<ProcessedBatch | null> => {
    setIsLoadingDetails(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/processed/${batchId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data: ProcessedBatch = await response.json();
      setSelectedBatch(data);
      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch batch details';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoadingDetails(false);
    }
  }, []);

  /**
   * Discard/delete a processed batch
   */
  const discardBatch = useCallback(async (batchId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/processed/${batchId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const data: DeleteBatchResponse = await response.json();
      
      if (data.success) {
        // Remove from local state
        setBatches(prev => prev.filter(b => b.batchId !== batchId));
        
        // Clear selected batch if it was the one deleted
        if (selectedBatch?.batchId === batchId) {
          setSelectedBatch(null);
        }
        
        return true;
      }
      
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to discard batch';
      setError(errorMessage);
      return false;
    }
  }, [selectedBatch]);

  /**
   * Clear the selected batch
   */
  const clearSelectedBatch = useCallback(() => {
    setSelectedBatch(null);
  }, []);

  return {
    batches,
    isLoading,
    error,
    selectedBatch,
    isLoadingDetails,
    fetchBatches,
    fetchBatchDetails,
    discardBatch,
    clearSelectedBatch,
  };
}

