import { useCallback, useState } from 'react';
import { AgentPanel } from '../components/AgentPanel';
import { EdgeToggleButton } from '../components/EdgeToggleButton';
import { FileTree } from '../components/FileTree';
import { PlanViewer } from '../components/PlanViewer';
import { useAuth } from '../contexts/AuthContext';
import type { TextHighlight } from '../types';

export function ViewerPage() {
  const { user, logout } = useAuth();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [highlightedPointerId, setHighlightedPointerId] = useState<string | null>(null);

  // Active pointers from agent conversation (accumulates across messages)
  const [activePointerIds, setActivePointerIds] = useState<string[]>([]);

  // Active text highlights from agent conversation
  const [activeHighlights, setActiveHighlights] = useState<TextHighlight[]>([]);

  // Narrative response for center panel overlay
  const [currentNarrative, setCurrentNarrative] = useState<string | null>(null);

  // Single state for mutually exclusive panel visibility: 'left' = FileTree, 'right' = AgentPanel
  const [activePanel, setActivePanel] = useState<'left' | 'right'>('left');

  // Track selected sheet ID for highlighting SheetLinks
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);

  // Handle selecting a sheet from agent results - display page without expanding left panel
  const handleSelectSheet = useCallback((sheetId: string) => {
    setSelectedFileId(sheetId);
    setSelectedSheetId(sheetId);
    setHighlightedPointerId(null);
  }, []);

  // Handle dismissing narrative
  const handleDismissNarrative = useCallback(() => {
    setCurrentNarrative(null);
  }, []);

  // Handle active pointers change from AgentPanel
  const handleActivePointersChange = useCallback((pointerIds: string[], highlights?: TextHighlight[]) => {
    setActivePointerIds(pointerIds);
    if (highlights) {
      setActiveHighlights(prev => [...prev, ...highlights]);
    }
  }, []);

  // Handle narrative change from AgentPanel
  const handleNarrativeChange = useCallback((narrative: string | null) => {
    setCurrentNarrative(narrative);
  }, []);

  if (!user) return null;

  const isLeftActive = activePanel === 'left';
  const isRightActive = activePanel === 'right';

  return (
    <div className="h-screen flex overflow-hidden relative">
      {/* Left sidebar - FileTree + Header (visible when left panel active) */}
      <div
        className={`
          flex-shrink-0 flex flex-col min-h-0
          border-r border-slate-200 bg-white
          transition-all duration-300 ease-in-out
          ${isLeftActive ? 'w-[280px]' : 'w-0 overflow-hidden'}
        `}
      >
        {/* ViewerPage Header - user info/logout */}
        <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-xs text-slate-500">Signed in</div>
            <div className="text-sm font-medium text-slate-900 truncate">{user.name}</div>
          </div>
          <button
            className="text-sm text-slate-600 hover:text-slate-900"
            onClick={() => logout()}
            type="button"
          >
            Logout
          </button>
        </div>

        {/* FileTree */}
        <div className="flex-1 min-h-0">
          <FileTree
            projects={user.assignedProjects}
            selectedFileId={selectedFileId}
            onSelectFile={(fileId, projectId) => {
              setSelectedFileId(fileId);
              setSelectedProjectId(projectId);
              setHighlightedPointerId(null);
            }}
          />
        </div>
      </div>

      {/* Main content - PlanViewer */}
      <div className="flex-1 min-w-0 min-h-0 bg-slate-100 relative">
        <PlanViewer
          fileId={selectedFileId}
          highlightedPointerId={highlightedPointerId}
          activePointerIds={activePointerIds}
          activeHighlights={activeHighlights}
          narrative={isRightActive ? currentNarrative : null}
          onDismissNarrative={handleDismissNarrative}
          showHeader={isLeftActive}
        />

        {/* Edge toggle buttons */}
        {isRightActive && (
          <EdgeToggleButton
            side="left"
            onClick={() => setActivePanel('left')}
            label="Specs"
          />
        )}
        {isLeftActive && (
          <EdgeToggleButton
            side="right"
            onClick={() => setActivePanel('right')}
            label="Agent"
          />
        )}
      </div>

      {/* Right sidebar - AgentPanel (visible when right panel active) */}
      <div
        className={`
          flex-shrink-0 flex flex-col min-h-0
          border-l border-slate-200 bg-white
          transition-all duration-300 ease-in-out
          ${isRightActive ? 'w-[380px]' : 'w-0 overflow-hidden'}
        `}
      >
        <AgentPanel
          projectId={selectedProjectId}
          selectedSheetId={selectedSheetId}
          onSelectSheet={handleSelectSheet}
          onNarrativeChange={handleNarrativeChange}
          onActivePointersChange={handleActivePointersChange}
        />
      </div>
    </div>
  );
}
