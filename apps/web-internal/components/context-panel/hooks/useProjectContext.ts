/**
 * Hook for fetching and caching global project context data.
 * Provides hierarchical context data across all project PDF files.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { 
    fetchProjectContextSummary, 
    ProjectContextSummaryResponse, 
    FileSummary, 
    PageSummary, 
    PointerSummary,
    PointerSummaryBounds
} from '../../../utils/api';

export type { FileSummary, PageSummary, PointerSummary, PointerSummaryBounds };

// Selection types for the tree
export type SelectionType = 'file' | 'page' | 'pointer' | null;

export interface TreeSelection {
    type: SelectionType;
    fileId: string | null;
    pageId: string | null;
    pointerId: string | null;
}

export interface UseProjectContextReturn {
    // Data
    contextData: ProjectContextSummaryResponse | null;
    isLoading: boolean;
    error: string | null;
    
    // Selection state
    selection: TreeSelection;
    selectedFile: FileSummary | null;
    selectedPage: PageSummary | null;
    selectedPointer: PointerSummary | null;
    
    // Actions
    fetchContext: () => Promise<void>;
    selectFile: (fileId: string) => void;
    selectPage: (fileId: string, pageId: string) => void;
    selectPointer: (fileId: string, pageId: string, pointerId: string) => void;
    clearSelection: () => void;
    
    // Expanded state for tree nodes
    expandedFiles: Set<string>;
    expandedPages: Set<string>;
    toggleFileExpand: (fileId: string) => void;
    togglePageExpand: (pageId: string) => void;
    expandAll: () => void;
    collapseAll: () => void;
}

const EMPTY_SELECTION: TreeSelection = {
    type: null,
    fileId: null,
    pageId: null,
    pointerId: null,
};

export function useProjectContext(projectId: string | null): UseProjectContextReturn {
    // Data state
    const [contextData, setContextData] = useState<ProjectContextSummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    // Selection state
    const [selection, setSelection] = useState<TreeSelection>(EMPTY_SELECTION);
    
    // Expanded state
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
    const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
    
    // Cache ref to avoid refetching on every render
    const lastFetchedProjectId = useRef<string | null>(null);

    // Fetch context data
    const fetchContext = useCallback(async () => {
        if (!projectId) {
            setContextData(null);
            return;
        }
        
        setIsLoading(true);
        setError(null);
        
        try {
            const data = await fetchProjectContextSummary(projectId);
            setContextData(data);
            lastFetchedProjectId.current = projectId;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch project context';
            setError(message);
            setContextData(null);
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    // Auto-fetch when projectId changes
    useEffect(() => {
        if (projectId && projectId !== lastFetchedProjectId.current) {
            fetchContext();
        }
    }, [projectId, fetchContext]);

    // Get selected items from context data
    const selectedFile = selection.fileId && contextData
        ? contextData.files.find(f => f.id === selection.fileId) || null
        : null;
    
    const selectedPage = selectedFile && selection.pageId
        ? selectedFile.pages.find(p => p.id === selection.pageId) || null
        : null;
    
    const selectedPointer = selectedPage && selection.pointerId
        ? selectedPage.pointers.find(p => p.id === selection.pointerId) || null
        : null;

    // Selection actions
    const selectFile = useCallback((fileId: string) => {
        setSelection({
            type: 'file',
            fileId,
            pageId: null,
            pointerId: null,
        });
        // Auto-expand when selecting
        setExpandedFiles(prev => new Set([...prev, fileId]));
    }, []);

    const selectPage = useCallback((fileId: string, pageId: string) => {
        setSelection({
            type: 'page',
            fileId,
            pageId,
            pointerId: null,
        });
        // Auto-expand when selecting
        setExpandedFiles(prev => new Set([...prev, fileId]));
        setExpandedPages(prev => new Set([...prev, pageId]));
    }, []);

    const selectPointer = useCallback((fileId: string, pageId: string, pointerId: string) => {
        setSelection({
            type: 'pointer',
            fileId,
            pageId,
            pointerId,
        });
        // Auto-expand when selecting
        setExpandedFiles(prev => new Set([...prev, fileId]));
        setExpandedPages(prev => new Set([...prev, pageId]));
    }, []);

    const clearSelection = useCallback(() => {
        setSelection(EMPTY_SELECTION);
    }, []);

    // Expand/collapse actions
    const toggleFileExpand = useCallback((fileId: string) => {
        setExpandedFiles(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) {
                next.delete(fileId);
            } else {
                next.add(fileId);
            }
            return next;
        });
    }, []);

    const togglePageExpand = useCallback((pageId: string) => {
        setExpandedPages(prev => {
            const next = new Set(prev);
            if (next.has(pageId)) {
                next.delete(pageId);
            } else {
                next.add(pageId);
            }
            return next;
        });
    }, []);

    const expandAll = useCallback(() => {
        if (!contextData) return;
        
        const allFileIds = new Set(contextData.files.map(f => f.id));
        const allPageIds = new Set(
            contextData.files.flatMap(f => f.pages.map(p => p.id))
        );
        
        setExpandedFiles(allFileIds);
        setExpandedPages(allPageIds);
    }, [contextData]);

    const collapseAll = useCallback(() => {
        setExpandedFiles(new Set());
        setExpandedPages(new Set());
    }, []);

    return {
        contextData,
        isLoading,
        error,
        selection,
        selectedFile,
        selectedPage,
        selectedPointer,
        fetchContext,
        selectFile,
        selectPage,
        selectPointer,
        clearSelection,
        expandedFiles,
        expandedPages,
        toggleFileExpand,
        togglePageExpand,
        expandAll,
        collapseAll,
    };
}


