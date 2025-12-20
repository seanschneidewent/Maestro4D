import { useState } from 'react';
import type { AgentSessionSummary } from '../types';

interface Props {
  sessions: AgentSessionSummary[];
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onClose: () => void;
  onDeleteSession: (sessionId: string) => void;
}

function formatRelativeTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function AgentHistorySidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onClose,
  onDeleteSession,
}: Props) {
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDelete = (sessionId: string) => {
    onDeleteSession(sessionId);
    setDeleteConfirmId(null);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Sidebar */}
      <div className="absolute inset-y-0 right-0 w-full max-w-xs bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Chat History</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 transition-colors"
          >
            <svg
              className="w-5 h-5 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.length === 0 ? (
            <div className="text-center text-sm text-slate-500 py-8">
              No previous sessions
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={`
                  relative rounded-lg border p-3 transition-colors
                  ${
                    session.id === currentSessionId
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }
                `}
              >
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className="w-full text-left"
                >
                  <div className="text-sm font-medium text-slate-900 truncate pr-6">
                    {session.title || 'Untitled conversation'}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <span>{session.messageCount} messages</span>
                    <span>•</span>
                    <span>{formatRelativeTime(session.updatedAt)}</span>
                  </div>
                </button>

                {/* Delete button */}
                {deleteConfirmId === session.id ? (
                  <div className="absolute top-2 right-2 flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(session.id)}
                      className="p-1 rounded bg-red-500 text-white hover:bg-red-600"
                      title="Confirm delete"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="p-1 rounded bg-slate-200 text-slate-600 hover:bg-slate-300"
                      title="Cancel"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteConfirmId(session.id);
                    }}
                    className="absolute top-2 right-2 p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    title="Delete session"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

