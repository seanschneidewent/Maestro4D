export function AgentEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-slate-500 px-6">
      <svg
        className="w-12 h-12 mb-3 text-slate-300"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
        />
      </svg>
      <div className="text-sm font-medium text-slate-700 text-center">
        Ask about your plans
      </div>
      <div className="text-xs text-slate-400 mt-1 text-center">
        Start a conversation to find relevant details across all project sheets
      </div>
    </div>
  );
}

