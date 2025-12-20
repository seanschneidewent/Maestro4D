import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { AgentMessage, AgentSession, AgentSessionSummary } from '../types';
import { AgentHistorySidebar } from './AgentHistorySidebar';
import { AgentInput } from './AgentInput';
import { AgentThread } from './AgentThread';

interface Props {
  projectId: string | null;
  selectedSheetId: string | null;
  onSelectSheet: (sheetId: string) => void;
  onNarrativeChange: (narrative: string | null) => void;
  onActivePointersChange: (pointerIds: string[]) => void;
}

export function AgentPanel({
  projectId,
  selectedSheetId,
  onSelectSheet,
  onNarrativeChange,
  onActivePointersChange,
}: Props) {
  const [currentSession, setCurrentSession] = useState<AgentSession | null>(null);
  const [sessionList, setSessionList] = useState<AgentSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Track active pointer IDs locally to support accumulation
  const activePointerIdsRef = useRef<string[]>([]);

  // Extract all pointer IDs from agent messages in a session
  const rebuildActivePointers = useCallback(
    (session: AgentSession) => {
      const ids = session.messages
        .filter((m) => m.role === 'agent')
        .flatMap((m) => m.sheets?.flatMap((s) => s.pointers.map((p) => p.id)) ?? []);
      const uniqueIds = [...new Set(ids)];
      activePointerIdsRef.current = uniqueIds;
      onActivePointersChange(uniqueIds);
    },
    [onActivePointersChange]
  );

  // Helper to clear pointers
  const clearActivePointers = useCallback(() => {
    activePointerIdsRef.current = [];
    onActivePointersChange([]);
  }, [onActivePointersChange]);

  // Load or create session when project changes
  useEffect(() => {
    if (!projectId) {
      setCurrentSession(null);
      setSessionList([]);
      clearActivePointers();
      onNarrativeChange(null);
      return;
    }

    const initializeSession = async () => {
      // Check localStorage for last session
      const lastSessionId = localStorage.getItem(`lastSessionId_${projectId}`);
      
      if (lastSessionId) {
        try {
          const session = await api.getAgentSession(lastSessionId);
          setCurrentSession(session);
          rebuildActivePointers(session);
          
          // Set narrative from last agent message
          const lastAgentMsg = [...session.messages]
            .reverse()
            .find((m) => m.role === 'agent');
          onNarrativeChange(lastAgentMsg?.narrative ?? null);
        } catch {
          // Session deleted or invalid, create new
          const session = await api.createAgentSession(projectId);
          setCurrentSession(session);
          localStorage.setItem(`lastSessionId_${projectId}`, session.id);
          clearActivePointers();
          onNarrativeChange(null);
        }
      } else {
        // Create fresh session
        const session = await api.createAgentSession(projectId);
        setCurrentSession(session);
        localStorage.setItem(`lastSessionId_${projectId}`, session.id);
        clearActivePointers();
        onNarrativeChange(null);
      }

      // Load session list for history
      try {
        const sessions = await api.getAgentSessions(projectId);
        setSessionList(sessions);
      } catch {
        setSessionList([]);
      }
    };

    initializeSession();
  }, [projectId, rebuildActivePointers, clearActivePointers, onNarrativeChange]);

  // Handle sending a new message
  const handleSendMessage = useCallback(
    async (query: string) => {
      if (!currentSession) return;

      // Optimistically add user message
      const tempUserMsg: AgentMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: query,
        createdAt: new Date().toISOString(),
      };

      setCurrentSession((prev) =>
        prev
          ? {
              ...prev,
              messages: [...prev.messages, tempUserMsg],
            }
          : null
      );

      setIsLoading(true);
      try {
        const agentResponse = await api.sendAgentMessage(currentSession.id, query);

        // Update session with real messages (remove temp, add both real)
        setCurrentSession((prev) => {
          if (!prev) return null;
          const filtered = prev.messages.filter((m) => !m.id.startsWith('temp-'));
          // Add the user message that was created server-side (approximate)
          const userMsg: AgentMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: query,
            createdAt: agentResponse.createdAt,
          };
          return {
            ...prev,
            messages: [...filtered, userMsg, agentResponse],
            title: prev.title || query.slice(0, 50),
          };
        });

        // Add new pointers to active set (accumulate, don't replace)
        const newPointerIds =
          agentResponse.sheets?.flatMap((s) => s.pointers.map((p) => p.id)) ?? [];
        const accumulatedIds = [...new Set([...activePointerIdsRef.current, ...newPointerIds])];
        activePointerIdsRef.current = accumulatedIds;
        onActivePointersChange(accumulatedIds);

        // Update narrative for viewer overlay
        onNarrativeChange(agentResponse.narrative ?? null);

        // Update session list
        if (projectId) {
          api.getAgentSessions(projectId).then(setSessionList).catch(() => {});
        }
      } catch (error) {
        console.error('Failed to send message:', error);
        // Remove temp message on error
        setCurrentSession((prev) =>
          prev
            ? {
                ...prev,
                messages: prev.messages.filter((m) => !m.id.startsWith('temp-')),
              }
            : null
        );
      } finally {
        setIsLoading(false);
      }
    },
    [currentSession, projectId, onActivePointersChange, onNarrativeChange]
  );

  // Handle creating a new session
  const handleNewAgent = useCallback(async () => {
    if (!projectId) return;

    try {
      const session = await api.createAgentSession(projectId);
      setCurrentSession(session);
      clearActivePointers();
      onNarrativeChange(null);
      localStorage.setItem(`lastSessionId_${projectId}`, session.id);

      // Update session list
      const sessions = await api.getAgentSessions(projectId);
      setSessionList(sessions);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [projectId, clearActivePointers, onNarrativeChange]);

  // Handle selecting a session from history
  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      try {
        const session = await api.getAgentSession(sessionId);
        setCurrentSession(session);
        rebuildActivePointers(session);

        const lastAgentMsg = [...session.messages]
          .reverse()
          .find((m) => m.role === 'agent');
        onNarrativeChange(lastAgentMsg?.narrative ?? null);

        localStorage.setItem(`lastSessionId_${session.projectId}`, session.id);
        setShowHistory(false);
      } catch (error) {
        console.error('Failed to load session:', error);
      }
    },
    [rebuildActivePointers, onNarrativeChange]
  );

  // Handle deleting a session
  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!projectId) return;

      try {
        await api.deleteAgentSession(sessionId);

        // If we deleted the current session, create a new one
        if (currentSession?.id === sessionId) {
          const session = await api.createAgentSession(projectId);
          setCurrentSession(session);
          clearActivePointers();
          onNarrativeChange(null);
          localStorage.setItem(`lastSessionId_${projectId}`, session.id);
        }

        // Refresh session list
        const sessions = await api.getAgentSessions(projectId);
        setSessionList(sessions);
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    },
    [projectId, currentSession?.id, clearActivePointers, onNarrativeChange]
  );

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <button
          type="button"
          onClick={handleNewAgent}
          disabled={!projectId}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
              d="M12 4v16m8-8H4"
            />
          </svg>
          New Chat
        </button>
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          disabled={!projectId}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          History
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <AgentThread
          messages={currentSession?.messages ?? []}
          selectedSheetId={selectedSheetId}
          onSelectSheet={onSelectSheet}
          isLoading={isLoading}
        />
      </div>

      {/* Input */}
      <AgentInput
        onSubmit={handleSendMessage}
        disabled={!projectId || isLoading}
        placeholder={!projectId ? 'Select a project to start...' : 'Ask a question...'}
      />

      {/* History Sidebar */}
      {showHistory && (
        <AgentHistorySidebar
          sessions={sessionList}
          currentSessionId={currentSession?.id ?? null}
          onSelectSession={handleSelectSession}
          onClose={() => setShowHistory(false)}
          onDeleteSession={handleDeleteSession}
        />
      )}
    </div>
  );
}

