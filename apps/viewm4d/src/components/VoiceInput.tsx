import { useState } from 'react';

interface Props {
  disabled?: boolean;
  onSubmit: (transcript: string) => Promise<void> | void;
}

export function VoiceInput({ disabled, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const transcript = value.trim();
    if (!transcript) return;

    setSubmitting(true);
    try {
      await onSubmit(transcript);
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-100"
        placeholder={disabled ? 'Select a project to ask a question…' : 'Ask a question…'}
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
    </form>
  );
}


