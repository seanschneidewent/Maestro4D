import type { QueryHistoryItem, RightPanelState } from '../types';
import { QueryInput } from './QueryInput';
import { QueryPanelEmpty } from './QueryPanelEmpty';
import { QueryPanelHistory } from './QueryPanelHistory';
import { QueryPanelResults } from './QueryPanelResults';

interface Props {
  panelState: RightPanelState;
  queryHistory: QueryHistoryItem[];
  disabled?: boolean;
  onSubmitQuery: (query: string) => void;
  onSelectHistoryItem: (queryId: string) => void;
  onSelectSheet: (sheetId: string, pointerIds: string[]) => void;
  onClearResults: () => void;
  onToggleHistory: () => void;
  onBackFromHistory: () => void;
}

export function QueryPanel({
  panelState,
  queryHistory,
  disabled,
  onSubmitQuery,
  onSelectHistoryItem,
  onSelectSheet,
  onClearResults,
  onToggleHistory,
  onBackFromHistory,
}: Props) {
  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        {panelState.type === 'history' ? (
          <>
            <button
              type="button"
              onClick={onBackFromHistory}
              className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back
            </button>
            <span className="text-sm font-medium text-slate-900">History</span>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onToggleHistory}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              History
            </button>
            {panelState.type === 'results' && (
              <button
                type="button"
                onClick={onClearResults}
                className="text-sm text-slate-600 hover:text-slate-900"
              >
                Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {panelState.type === 'empty' && <QueryPanelEmpty />}

        {panelState.type === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            <span className="text-sm">Finding relevant context...</span>
            <span className="text-xs text-slate-400 px-4 text-center truncate max-w-full">
              "{panelState.query}"
            </span>
          </div>
        )}

        {panelState.type === 'results' && (
          <QueryPanelResults results={panelState.results} onSelectSheet={onSelectSheet} />
        )}

        {panelState.type === 'history' && (
          <QueryPanelHistory history={queryHistory} onSelectItem={onSelectHistoryItem} />
        )}
      </div>

      {/* Input - always visible */}
      <QueryInput
        disabled={disabled || panelState.type === 'loading'}
        placeholder={disabled ? 'Select a project to ask a question…' : 'Ask a question…'}
        onSubmit={onSubmitQuery}
      />
    </div>
  );
}
