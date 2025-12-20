import type { AgentSheetResult } from '../types';
import { SheetLink } from './SheetLink';

interface Props {
  content: string;
  sheets?: AgentSheetResult[];
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  timestamp: string;
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function AgentBubble({ content, sheets, selectedSheetId, onSelectSheet, timestamp }: Props) {
  return (
    <div className="flex flex-col items-start px-4 py-2">
      <div className="max-w-[85%] bg-slate-100 text-slate-900 px-3 py-2 rounded-2xl rounded-bl-md">
        <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        
        {sheets && sheets.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {sheets.map((sheet) => (
              <SheetLink
                key={sheet.sheetId}
                sheetId={sheet.sheetId}
                sheetName={sheet.sheetName}
                pointerCount={sheet.pointers.length}
                isSelected={sheet.sheetId === selectedSheetId}
                onClick={onSelectSheet}
              />
            ))}
          </div>
        )}
      </div>
      <span className="text-[10px] text-slate-400 mt-1 ml-1">
        {formatTime(timestamp)}
      </span>
    </div>
  );
}

