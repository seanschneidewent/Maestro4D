import type { QueryHistoryItem } from '../types';

interface Props {
  history: QueryHistoryItem[];
  onSelectItem: (queryId: string) => void;
}

function formatTimestamp(iso: string) {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function QueryPanelHistory({ history, onSelectItem }: Props) {
  if (history.length === 0) {
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
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="text-sm text-slate-600 text-center">No query history</div>
        <div className="text-xs text-slate-400 mt-1 text-center">
          Your past queries will appear here
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-2">
      {history.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelectItem(item.id)}
          className="w-full text-left rounded-md border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 transition-colors"
        >
          <div className="text-sm font-medium text-slate-900 truncate">{item.transcript}</div>
          <div className="text-xs text-slate-500 mt-0.5">{formatTimestamp(item.createdAt)}</div>
        </button>
      ))}
    </div>
  );
}

