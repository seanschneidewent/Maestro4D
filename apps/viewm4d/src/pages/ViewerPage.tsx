import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileTree } from '../components/FileTree';
import { PlanViewer } from '../components/PlanViewer';
import { QueryPanel } from '../components/QueryPanel';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import type { EnhancedQueryResponse, QueryHistoryItem, QueryResults, RightPanelState } from '../types';

/**
 * Convert EnhancedQueryResponse from API to QueryResults for UI state.
 */
function toQueryResults(response: EnhancedQueryResponse): QueryResults {
  return {
    contextPointers: response.contextPointers.map((cp) => ({
      id: cp.id,
      sheetId: cp.sheetId,
      sheetName: cp.sheetName,
      reason: cp.reason,
      bbox: cp.bbox,
    })),
    narrative: response.narrative,
    timestamp: new Date(response.createdAt),
  };
}

/**
 * Convert EnhancedQueryResponse to QueryHistoryItem for history list.
 */
function toHistoryItem(response: EnhancedQueryResponse): QueryHistoryItem {
  return {
    id: response.id,
    userId: '', // Not needed for display
    projectId: '', // Not needed for display
    transcript: response.query,
    response: response.narrative,
    createdAt: response.createdAt,
    results: toQueryResults(response),
  };
}

export function ViewerPage() {
  const { user, logout } = useAuth();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [highlightedPointerId, setHighlightedPointerId] = useState<string | null>(null);

  // Right panel state machine
  const [rightPanelState, setRightPanelState] = useState<RightPanelState>({ type: 'empty' });
  const previousStateRef = useRef<RightPanelState>({ type: 'empty' });

  // Narrative response for center panel
  const [currentNarrative, setCurrentNarrative] = useState<string | null>(null);

  // Query history
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);

  // Sidebar visibility state for responsive layout
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  // Derive active pointer IDs from current query results
  // Only these pointers will be displayed on the PDF
  const activePointerIds = useMemo(() => {
    if (rightPanelState.type === 'results') {
      return rightPanelState.results.contextPointers.map((p) => p.id);
    }
    return [];
  }, [rightPanelState]);

  // Load query history when project changes
  useEffect(() => {
    if (!user || !selectedProjectId) {
      setQueryHistory([]);
      return;
    }

    api.getQueryHistory(user.id, selectedProjectId, 20)
      .then((data) => {
        // Convert EnhancedQueryResponse[] to QueryHistoryItem[]
        const historyItems = data.map(toHistoryItem);
        setQueryHistory(historyItems);
      })
      .catch(() => {
        // Silently fail - history will just be empty
        setQueryHistory([]);
      });
  }, [user, selectedProjectId]);

  // Handle query submission - now uses real Grok agent
  const handleSubmitQuery = useCallback(async (query: string) => {
    if (!user || !selectedProjectId) return;

    // Save current state before transitioning to loading
    if (rightPanelState.type !== 'loading') {
      previousStateRef.current = rightPanelState;
    }

    setRightPanelState({ type: 'loading', query });
    setCurrentNarrative(null);

    try {
      // Create the query and process with Grok
      const response = await api.createQuery(user.id, selectedProjectId, query);

      // Convert to UI format
      const results = toQueryResults(response);
      const historyItem = toHistoryItem(response);

      // Add to history
      setQueryHistory((prev) => [historyItem, ...prev]);

      // Show results
      setRightPanelState({ type: 'results', query, results });
      setCurrentNarrative(results.narrative);

      // Auto-select first sheet if we have results
      if (response.contextPointers.length > 0) {
        const firstSheet = response.contextPointers[0];
        setSelectedFileId(firstSheet.sheetId);
        setHighlightedPointerId(firstSheet.id);
      }
    } catch (err) {
      console.error('Query failed:', err);
      // On error, go back to previous state
      setRightPanelState(previousStateRef.current);
    }
  }, [user, selectedProjectId, rightPanelState]);

  // Handle selecting a sheet from results
  const handleSelectSheet = useCallback((sheetId: string, pointerIds: string[]) => {
    // Update center viewer to show this sheet
    setSelectedFileId(sheetId);
    // Highlight the first pointer
    if (pointerIds.length > 0) {
      setHighlightedPointerId(pointerIds[0]);
    }
    setRightOpen(false); // Close on mobile
  }, []);

  // Handle selecting a history item
  const handleSelectHistoryItem = useCallback((queryId: string) => {
    const historicalItem = queryHistory.find((q) => q.id === queryId);
    if (historicalItem?.results) {
      setRightPanelState({
        type: 'results',
        query: historicalItem.transcript,
        results: historicalItem.results,
      });
      setCurrentNarrative(historicalItem.results.narrative);

      // Auto-select first sheet if we have results
      if (historicalItem.results.contextPointers.length > 0) {
        const firstSheet = historicalItem.results.contextPointers[0];
        setSelectedFileId(firstSheet.sheetId);
        setHighlightedPointerId(firstSheet.id);
      }
    }
  }, [queryHistory]);

  // Handle clearing results
  const handleClearResults = useCallback(() => {
    setRightPanelState({ type: 'empty' });
    setCurrentNarrative(null);
    setHighlightedPointerId(null);
  }, []);

  // Handle toggling history view
  const handleToggleHistory = useCallback(() => {
    previousStateRef.current = rightPanelState;
    setRightPanelState({ type: 'history' });
  }, [rightPanelState]);

  // Handle going back from history
  const handleBackFromHistory = useCallback(() => {
    // Go back to previous state (results or empty)
    const prev = previousStateRef.current;
    if (prev.type === 'results' || prev.type === 'empty') {
      setRightPanelState(prev);
    } else {
      setRightPanelState({ type: 'empty' });
    }
  }, []);

  // Handle dismissing narrative
  const handleDismissNarrative = useCallback(() => {
    setCurrentNarrative(null);
  }, []);

  if (!user) return null;

  return (
    <div className="h-screen flex overflow-x-hidden relative">
      {/* Mobile overlay backdrop */}
      {(leftOpen || rightOpen) && (
        <div
          className="fixed inset-0 bg-black/30 z-20 lg:hidden"
          onClick={() => {
            setLeftOpen(false);
            setRightOpen(false);
          }}
        />
      )}

      {/* Mobile toggle buttons */}
      <div className="fixed top-3 left-3 z-30 lg:hidden flex gap-2">
        <button
          type="button"
          onClick={() => setLeftOpen(!leftOpen)}
          className="p-2 bg-white rounded-md shadow-md border border-slate-200 hover:bg-slate-50"
          aria-label="Toggle projects panel"
        >
          <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      <div className="fixed top-3 right-3 z-30 lg:hidden">
        <button
          type="button"
          onClick={() => setRightOpen(!rightOpen)}
          className="p-2 bg-white rounded-md shadow-md border border-slate-200 hover:bg-slate-50"
          aria-label="Toggle query panel"
        >
          <svg className="w-5 h-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      </div>

      {/* Left sidebar - Projects/FileTree */}
      <div
        className={`
          fixed lg:relative inset-y-0 left-0 z-30
          w-[250px] flex-shrink-0
          border-r border-slate-200 bg-white
          transform transition-transform duration-200 ease-in-out
          ${leftOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        <FileTree
          projects={user.assignedProjects}
          selectedFileId={selectedFileId}
          onSelectFile={(fileId, projectId) => {
            setSelectedFileId(fileId);
            setSelectedProjectId(projectId);
            setHighlightedPointerId(null);
            setLeftOpen(false); // Close on mobile after selection
          }}
        />
      </div>

      {/* Main content - PlanViewer */}
      <div className="flex-1 min-w-0 bg-slate-50">
        <PlanViewer
          fileId={selectedFileId}
          highlightedPointerId={highlightedPointerId}
          activePointerIds={activePointerIds}
          narrative={currentNarrative}
          onDismissNarrative={handleDismissNarrative}
        />
      </div>

      {/* Right sidebar - QueryPanel */}
      <div
        className={`
          fixed lg:relative inset-y-0 right-0 z-30
          w-[350px] flex-shrink-0
          border-l border-slate-200 bg-white flex flex-col min-h-0
          transform transition-transform duration-200 ease-in-out
          ${rightOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:translate-x-0
        `}
      >
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Signed in</div>
            <div className="text-sm font-medium text-slate-900 truncate">{user.name}</div>
          </div>
          <button
            className="text-sm text-slate-600 hover:text-slate-900"
            onClick={() => {
              logout();
            }}
            type="button"
          >
            Logout
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <QueryPanel
            panelState={rightPanelState}
            queryHistory={queryHistory}
            disabled={!selectedProjectId}
            onSubmitQuery={handleSubmitQuery}
            onSelectHistoryItem={handleSelectHistoryItem}
            onSelectSheet={handleSelectSheet}
            onClearResults={handleClearResults}
            onToggleHistory={handleToggleHistory}
            onBackFromHistory={handleBackFromHistory}
          />
        </div>
      </div>
    </div>
  );
}
