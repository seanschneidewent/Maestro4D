export function QueryPanelEmpty() {
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
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <div className="text-sm font-medium text-slate-700 text-center">
        Ask a question to find relevant details
      </div>
      <div className="text-xs text-slate-400 mt-1 text-center">
        Search across all project plans and specifications
      </div>
    </div>
  );
}

