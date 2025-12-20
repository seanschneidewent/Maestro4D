import { useEffect, useRef } from 'react';
import type { AgentMessage } from '../types';
import { AgentBubble } from './AgentBubble';
import { AgentEmptyState } from './AgentEmptyState';
import { AgentTypingIndicator } from './AgentTypingIndicator';
import { UserBubble } from './UserBubble';

interface Props {
  messages: AgentMessage[];
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  isLoading: boolean;
}

export function AgentThread({ messages, selectedSheetId, onSelectSheet, isLoading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change or loading state changes
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return <AgentEmptyState />;
  }

  return (
    <div className="flex flex-col py-2">
      {messages.map((message) =>
        message.role === 'user' ? (
          <UserBubble
            key={message.id}
            content={message.content}
            timestamp={message.createdAt}
          />
        ) : (
          <AgentBubble
            key={message.id}
            content={message.content}
            sheets={message.sheets}
            selectedSheetId={selectedSheetId}
            onSelectSheet={onSelectSheet}
            timestamp={message.createdAt}
          />
        )
      )}
      
      {isLoading && <AgentTypingIndicator />}
      
      <div ref={bottomRef} />
    </div>
  );
}

