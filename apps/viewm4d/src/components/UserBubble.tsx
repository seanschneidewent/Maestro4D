interface Props {
  content: string;
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

export function UserBubble({ content, timestamp }: Props) {
  return (
    <div className="flex flex-col items-end px-4 py-2">
      <div className="max-w-[85%] bg-blue-600 text-white px-3 py-2 rounded-2xl rounded-br-md">
        <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
      </div>
      <span className="text-[10px] text-slate-400 mt-1 mr-1">
        {formatTime(timestamp)}
      </span>
    </div>
  );
}

