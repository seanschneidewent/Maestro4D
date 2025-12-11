import { useState, useCallback } from 'react';
import { SheetContext } from '../../../types/context';
import { 
  ExportBatchPayload, 
  ExportBatchResponse,
  ExportSheet,
  ExportPointer 
} from '../../../types/n8n';

const API_BASE_URL = 'http://localhost:3001';

interface UseN8NExportResult {
  isExporting: boolean;
  error: string | null;
  lastBatchId: string | null;
  exportBatch: (sheetContexts: Record<string, SheetContext>) => Promise<ExportBatchResponse | null>;
}

/**
 * Hook for exporting context pointers to n8n watch folder
 */
export function useN8NExport(): UseN8NExportResult {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  const exportBatch = useCallback(async (
    sheetContexts: Record<string, SheetContext>
  ): Promise<ExportBatchResponse | null> => {
    setIsExporting(true);
    setError(null);

    try {
      // Filter to only sheets that have been added to context
      const addedSheets = Object.values(sheetContexts).filter(
        sheet => sheet.addedToContext && sheet.pointers.length > 0
      );

      if (addedSheets.length === 0) {
        setError('No sheets with pointers have been added to context');
        setIsExporting(false);
        return null;
      }

      // Generate batch ID
      const batchId = `batch_${Date.now()}`;

      // Transform sheets to export format
      const sheets: ExportSheet[] = addedSheets.map(sheet => ({
        sheetId: sheet.fileId,
        fileName: sheet.fileName,
        pointers: sheet.pointers.map(pointer => {
          // Strip the data URL prefix from base64 image
          let imageBase64 = '';
          if (pointer.snapshotDataUrl) {
            const base64Match = pointer.snapshotDataUrl.match(/^data:image\/\w+;base64,(.+)$/);
            imageBase64 = base64Match ? base64Match[1] : pointer.snapshotDataUrl;
          }

          const exportPointer: ExportPointer = {
            id: pointer.id,
            imageBase64,
            metadata: {
              title: pointer.title,
              description: pointer.description,
              pageNumber: pointer.pageNumber,
              boundingBox: pointer.bounds ? {
                xNorm: pointer.bounds.xNorm,
                yNorm: pointer.bounds.yNorm,
                wNorm: pointer.bounds.wNorm,
                hNorm: pointer.bounds.hNorm,
              } : null,
            },
          };

          return exportPointer;
        }),
      }));

      const payload: ExportBatchPayload = {
        batchId,
        sheets,
      };

      const response = await fetch(`${API_BASE_URL}/api/export-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error ${response.status}`);
      }

      const result: ExportBatchResponse = await response.json();
      setLastBatchId(result.batchId);
      setIsExporting(false);
      
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to export batch';
      setError(errorMessage);
      setIsExporting(false);
      return null;
    }
  }, []);

  return {
    isExporting,
    error,
    lastBatchId,
    exportBatch,
  };
}

