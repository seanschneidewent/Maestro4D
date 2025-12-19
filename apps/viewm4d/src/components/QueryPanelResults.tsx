import { useMemo } from 'react';
import type { QueryResults } from '../types';

interface Props {
  results: QueryResults;
  onSelectSheet: (sheetId: string, pointerIds: string[]) => void;
}

export function QueryPanelResults({ results, onSelectSheet }: Props) {
  // Group pointers by sheet
  const sheetGroups = useMemo(() => {
    const groups = new Map<string, typeof results.contextPointers>();
    for (const pointer of results.contextPointers) {
      const existing = groups.get(pointer.sheetId) || [];
      groups.set(pointer.sheetId, [...existing, pointer]);
    }
    return Array.from(groups.entries()).map(([sheetId, pointers]) => ({
      sheetId,
      sheetName: pointers[0].sheetName,
      pointers,
    }));
  }, [results.contextPointers]);

  const totalPointers = results.contextPointers.length;

  if (sheetGroups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 px-6">
        <svg
          className="w-10 h-10 mb-2 text-slate-300"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="text-sm text-slate-600 text-center">No relevant sheets found</div>
        <div className="text-xs text-slate-400 mt-1 text-center">Try a different query</div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
        Relevant Sheets
      </div>

      <div className="space-y-1">
        {sheetGroups.map((group, index) => (
          <button
            key={group.sheetId}
            type="button"
            onClick={() => onSelectSheet(group.sheetId, group.pointers.map((p) => p.id))}
            className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-slate-100 text-left transition-colors"
          >
            <span className="text-slate-400 text-xs w-4 text-right">{index + 1}</span>
            <svg
              className="w-4 h-4 text-slate-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="flex-1 text-sm text-slate-700 truncate">{group.sheetName}</span>
            <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
              {group.pointers.length}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-500">
        Showing {sheetGroups.length} sheet{sheetGroups.length !== 1 ? 's' : ''},{' '}
        {totalPointers} context pointer{totalPointers !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

