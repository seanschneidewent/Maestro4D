import { useState } from 'react';

interface Props {
  disabled?: boolean;
  placeholder?: string;
  onSubmit: (query: string) => void;
}

export function QueryInput({ disabled, placeholder, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || submitting) return;
    const query = value.trim();
    if (!query) return;

    setSubmitting(true);
    try {
      onSubmit(query);
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
          placeholder={placeholder ?? 'Ask a question…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || submitting}
        />
        <button
          type="submit"
          disabled={disabled || submitting}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Send
        </button>
      </div>
    </form>
  );
}

