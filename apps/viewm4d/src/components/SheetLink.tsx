interface Props {
  sheetId: string;
  sheetName: string;
  pointerCount: number;
  isSelected?: boolean;
  onClick: (sheetId: string) => void;
}

export function SheetLink({ sheetId, sheetName, pointerCount, isSelected = false, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={() => onClick(sheetId)}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-colors text-left ${
        isSelected
          ? 'bg-blue-50 border-blue-300 hover:bg-blue-100 hover:border-blue-400'
          : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
      }`}
    >
      <svg
        className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-slate-400'}`}
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
      <span className={`flex-1 text-sm truncate ${isSelected ? 'text-blue-900 font-medium' : 'text-slate-700'}`}>
        {sheetName}
      </span>
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
        isSelected 
          ? 'text-blue-700 bg-blue-100' 
          : 'text-slate-500 bg-slate-100'
      }`}>
        {pointerCount}
      </span>
    </button>
  );
}

