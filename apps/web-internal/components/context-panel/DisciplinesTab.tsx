import React, { useState, useEffect } from 'react';
import { useDisciplineProcessing, DisciplineInfo } from './hooks/useDisciplineProcessing';
import { useDisciplineContexts, DisciplineContext } from './hooks/useDisciplineContexts';
import { 
  SpinnerIcon, 
  CheckIcon, 
  DocumentIcon,
  ChevronDownIcon,
  ExclamationCircleIcon,
  RefreshIcon
} from '../Icons';

// =============================================================================
// Types
// =============================================================================

interface DisciplinesTabProps {
  projectId: string;
}

// =============================================================================
// Constants
// =============================================================================

// Discipline badge colors
const DISCIPLINE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  S: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
  M: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  E: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  P: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  FP: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  C: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  L: { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30' },
  G: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
};

// Discipline full names
const DISCIPLINE_NAMES: Record<string, string> = {
  A: 'Architectural',
  S: 'Structural',
  M: 'Mechanical',
  E: 'Electrical',
  P: 'Plumbing',
  FP: 'Fire Protection',
  C: 'Civil',
  L: 'Landscape',
  G: 'General',
};

// Identifier/content type badge colors
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  spec: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  assembly: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  detail: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  equipment: { bg: 'bg-green-500/20', text: 'text-green-400' },
  grid: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  schedule: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  note: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

// Status icons configuration
const STATUS_CONFIG: Record<string, { icon: string; color: string; animate?: boolean }> = {
  complete: { icon: '✓', color: 'text-green-400' },
  processing: { icon: '◉', color: 'text-blue-400', animate: true },
  ready: { icon: '○', color: 'text-gray-400' },
  waiting: { icon: '◌', color: 'text-gray-600' },
};

// =============================================================================
// Helper Components
// =============================================================================

// Discipline badge component
const DisciplineBadge: React.FC<{ code: string }> = ({ code }) => {
  const colors = DISCIPLINE_COLORS[code] || DISCIPLINE_COLORS.G;
  const name = DISCIPLINE_NAMES[code] || code;
  
  return (
    <span 
      className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${colors.bg} ${colors.text} ${colors.border}`}
      title={name}
    >
      {code}
    </span>
  );
};

// Status icon component
const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.waiting;
  
  return (
    <span 
      className={`text-sm ${config.color} ${config.animate ? 'animate-pulse' : ''}`}
      title={status}
    >
      {config.icon}
    </span>
  );
};

// Type badge component for key contents
const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors = TYPE_COLORS[type.toLowerCase()] || TYPE_COLORS.note;
  
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${colors.bg} ${colors.text}`}>
      {type}
    </span>
  );
};

// Progress text component for waiting disciplines
const PageProgressText: React.FC<{ progress?: { complete: number; total: number } }> = ({ progress }) => {
  if (!progress || progress.total === 0) return null;
  
  return (
    <span className="text-[10px] text-gray-500">
      ({progress.complete}/{progress.total} pages)
    </span>
  );
};

// Expanded discipline detail view
const DisciplineDetail: React.FC<{ 
  discipline: DisciplineInfo;
  contextData: DisciplineContext | undefined;
}> = ({ discipline, contextData }) => {
  const isComplete = discipline.status === 'complete';
  
  if (!isComplete) {
    return (
      <div className="px-3 py-3 bg-gray-800/30 border-t border-gray-700/50">
        <p className="text-sm text-gray-500 italic">
          {discipline.status === 'processing' 
            ? 'Processing discipline context...' 
            : discipline.status === 'ready'
            ? 'Ready to process. Click Process to generate context.'
            : 'Waiting for pages to complete processing.'}
        </p>
      </div>
    );
  }
  
  const context = contextData?.contextDescription;
  const keyContents = contextData?.keyContents;
  const connections = contextData?.connections;
  
  return (
    <div className="px-3 py-3 bg-gray-800/30 border-t border-gray-700/50 space-y-3">
      {/* Context Description */}
      {context && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Context
          </h4>
          <p className="text-sm text-gray-300 leading-relaxed">
            {context}
          </p>
        </div>
      )}
      
      {/* Key Contents */}
      {keyContents && keyContents.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Key Contents ({keyContents.length})
          </h4>
          <div className="space-y-1.5">
            {keyContents.map((content, idx) => (
              <div 
                key={idx}
                className="flex items-center gap-2 text-sm"
              >
                <TypeBadge type={content.type} />
                <span className="text-gray-300">{content.item}</span>
                <span className="text-gray-600">→</span>
                <span className="text-cyan-400 font-mono text-xs">{content.sheet}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Connections */}
      {connections && connections.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Connections ({connections.length})
          </h4>
          <div className="space-y-1.5">
            {connections.map((conn, idx) => {
              const disciplineName = DISCIPLINE_NAMES[conn.discipline] || conn.discipline;
              const colors = DISCIPLINE_COLORS[conn.discipline] || DISCIPLINE_COLORS.G;
              
              return (
                <div 
                  key={idx}
                  className="flex items-start gap-2 text-sm"
                >
                  <span className="text-gray-600">→</span>
                  <span className={`font-medium ${colors.text}`}>{disciplineName}:</span>
                  <span className="text-gray-400 flex-1">{conn.relationship}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* No content state */}
      {!context && (!keyContents || keyContents.length === 0) && (!connections || connections.length === 0) && (
        <p className="text-sm text-gray-500 italic">No context data available.</p>
      )}
    </div>
  );
};

// Single discipline item component
const DisciplineItem: React.FC<{ 
  discipline: DisciplineInfo;
  contextData: DisciplineContext | undefined;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ discipline, contextData, isExpanded, onToggle }) => {
  const disciplineName = DISCIPLINE_NAMES[discipline.code] || discipline.name;
  
  return (
    <div className="border-b border-gray-700/50 last:border-b-0 transition-all duration-300">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800/30 transition-colors"
      >
        {/* Status icon */}
        <StatusIcon status={discipline.status} />
        
        {/* Discipline name and badge */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">
            {disciplineName}
          </span>
          <DisciplineBadge code={discipline.code} />
          
          {/* Page progress for waiting disciplines */}
          {discipline.status === 'waiting' && (
            <PageProgressText progress={discipline.pageProgress} />
          )}
        </div>
        
        {/* Expand/collapse chevron */}
        <ChevronDownIcon 
          className={`h-4 w-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${
            isExpanded ? '' : '-rotate-90'
          }`}
        />
      </button>
      
      {/* Expanded detail */}
      {isExpanded && (
        <DisciplineDetail 
          discipline={discipline} 
          contextData={contextData}
        />
      )}
    </div>
  );
};

// Loading skeleton
const LoadingSkeleton: React.FC = () => (
  <div className="p-3 space-y-2">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-3 p-2">
        <div className="w-4 h-4 bg-gray-700 rounded-full animate-pulse" />
        <div className="flex-1 h-4 bg-gray-700 rounded animate-pulse" />
        <div className="w-8 h-4 bg-gray-700 rounded animate-pulse" />
      </div>
    ))}
  </div>
);

// Empty state - no pages processed
const EmptyStateNoPages: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
    <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
    <p className="text-sm text-center">No disciplines available yet.</p>
    <p className="text-xs text-gray-600 mt-1 text-center">
      Process pages first to generate discipline contexts.
    </p>
  </div>
);

// Empty state - all waiting
const EmptyStateAllWaiting: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
    <div className="text-4xl mb-3 opacity-30">◌</div>
    <p className="text-sm text-center">All disciplines waiting for pages.</p>
    <p className="text-xs text-gray-600 mt-1 text-center">
      Disciplines will become ready as pages complete processing.
    </p>
  </div>
);

// Error state
const ErrorState: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="flex flex-col items-center justify-center h-full p-6">
    <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
      <ExclamationCircleIcon className="w-6 h-6 text-red-400" />
    </div>
    <p className="text-sm text-red-400 text-center mb-1">Error loading disciplines</p>
    <p className="text-xs text-gray-500 text-center mb-4">{error}</p>
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
    >
      <RefreshIcon className="w-4 h-4" />
      Retry
    </button>
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const DisciplinesTab: React.FC<DisciplinesTabProps> = ({ projectId }) => {
  // Hooks
  const {
    status,
    disciplines: disciplineInfos,
    currentDiscipline,
    progress,
    startProcessing,
    error: processingError,
  } = useDisciplineProcessing(projectId);
  
  const {
    disciplines: disciplineContexts,
    loading,
    error: fetchError,
    refetch,
  } = useDisciplineContexts(projectId);
  
  // Local state for expanded items
  const [expandedDisciplines, setExpandedDisciplines] = useState<Set<string>>(new Set());
  
  // Refetch discipline contexts when processing completes or makes progress
  useEffect(() => {
    if (status === 'complete' || progress.complete > 0) {
      refetch();
    }
  }, [status, progress.complete, refetch]);
  
  // Toggle discipline expansion
  const toggleDiscipline = (code: string) => {
    setExpandedDisciplines(prev => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };
  
  // Handle process button click
  const handleProcessClick = () => {
    startProcessing();
  };
  
  // Create a map of discipline code to context data for quick lookup
  const contextDataMap = new Map<string, DisciplineContext>();
  disciplineContexts.forEach(ctx => {
    contextDataMap.set(ctx.code, ctx);
  });
  
  // Determine button state
  const isProcessing = status === 'processing';
  const isComplete = status === 'complete';
  const hasReadyDisciplines = disciplineInfos.some(d => d.status === 'ready');
  const allWaiting = disciplineInfos.length > 0 && disciplineInfos.every(d => d.status === 'waiting');
  const canProcess = hasReadyDisciplines && !isProcessing && !isComplete;
  
  // Sort disciplines by status priority: processing > ready > waiting > complete
  const statusPriority: Record<string, number> = {
    processing: 0,
    ready: 1,
    waiting: 2,
    complete: 3,
  };
  
  const sortedDisciplines = [...disciplineInfos].sort((a, b) => {
    const priorityA = statusPriority[a.status] ?? 4;
    const priorityB = statusPriority[b.status] ?? 4;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.name.localeCompare(b.name);
  });
  
  return (
    <div className="flex flex-col h-full">
      {/* Header with processing controls */}
      <div className="flex-none px-4 py-3 border-b border-gray-700 space-y-3">
        {/* Title row with process button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-gray-200">Disciplines</h3>
            {progress.total > 0 && (
              <span className="text-xs text-gray-500">
                {progress.complete}/{progress.total} complete
              </span>
            )}
          </div>
          
          {/* Process button */}
          <button
            onClick={handleProcessClick}
            disabled={!canProcess && !isProcessing}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              isComplete
                ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                : isProcessing
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : canProcess
                ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isComplete ? (
              <>
                <CheckIcon className="w-3.5 h-3.5" />
                Complete
              </>
            ) : isProcessing ? (
              <>
                <SpinnerIcon className="w-3.5 h-3.5" />
                Processing...
              </>
            ) : (
              'Process'
            )}
          </button>
        </div>
        
        {/* Current discipline indicator */}
        {isProcessing && currentDiscipline && (
          <div className="text-[10px] text-gray-500">
            Processing: {currentDiscipline.name} ({currentDiscipline.code})
          </div>
        )}
        
        {/* Processing error */}
        {processingError && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {processingError}
          </div>
        )}
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Loading state */}
        {loading && disciplineInfos.length === 0 && <LoadingSkeleton />}
        
        {/* Error state */}
        {fetchError && !loading && (
          <ErrorState error={fetchError} onRetry={refetch} />
        )}
        
        {/* Empty state - no disciplines */}
        {!loading && !fetchError && disciplineInfos.length === 0 && (
          <EmptyStateNoPages />
        )}
        
        {/* Empty state - all waiting with no content */}
        {!loading && !fetchError && allWaiting && disciplineInfos.length > 0 && !isProcessing && (
          <div className="divide-y divide-gray-700/50">
            {sortedDisciplines.map((discipline) => (
              <DisciplineItem
                key={discipline.code}
                discipline={discipline}
                contextData={contextDataMap.get(discipline.code)}
                isExpanded={expandedDisciplines.has(discipline.code)}
                onToggle={() => toggleDiscipline(discipline.code)}
              />
            ))}
          </div>
        )}
        
        {/* Discipline list */}
        {!loading && !fetchError && disciplineInfos.length > 0 && (!allWaiting || isProcessing) && (
          <div className="divide-y divide-gray-700/50">
            {sortedDisciplines.map((discipline) => (
              <DisciplineItem
                key={discipline.code}
                discipline={discipline}
                contextData={contextDataMap.get(discipline.code)}
                isExpanded={expandedDisciplines.has(discipline.code)}
                onToggle={() => toggleDiscipline(discipline.code)}
              />
            ))}
          </div>
        )}
        
        {/* Processing empty state */}
        {disciplineInfos.length === 0 && isProcessing && (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <SpinnerIcon className="w-8 h-8 text-cyan-400 mb-3" />
            <p className="text-sm text-gray-400">Processing disciplines...</p>
            <p className="text-xs text-gray-500 mt-1">Disciplines will appear here as they complete.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DisciplinesTab;

