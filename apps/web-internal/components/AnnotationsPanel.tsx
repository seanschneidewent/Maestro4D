import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DocumentIcon, CloseIcon, ChevronDownIcon, ChevronUpIcon, PlusIcon } from './Icons';
import { ContextPointer } from '../types/context';

interface AnnotationsPanelProps {
  selectedFileName: string;
  pointers: ContextPointer[];
  onPointerUpdate: (id: string, updates: { title: string; description: string }) => void;
  onPointerDelete: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  height: number;
  onHeightChange: (height: number) => void;
  editingPointerId: string | null;
  onEditingPointerIdChange: (id: string | null) => void;
  selectedAnnotationIds: Set<string>;
  onSelectedAnnotationIdsChange: (ids: Set<string>) => void;
  isAddedToContext: boolean;
  onAddToContext: () => void;
  // New props for bidirectional interaction
  onPointerHover?: (pointerId: string | null) => void;
  onPointerClick?: (pointerId: string) => void;
  highlightedPointerId?: string | null;
}

// Crosshair/target icon for pointers
const CrosshairIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <line x1="22" y1="12" x2="18" y2="12" />
    <line x1="6" y1="12" x2="2" y2="12" />
    <line x1="12" y1="6" x2="12" y2="2" />
    <line x1="12" y1="22" x2="12" y2="18" />
  </svg>
);

// Generating skeleton card for AI analysis in progress
const GeneratingCard: React.FC<{ pageNumber: number }> = ({ pageNumber }) => (
  <div className="flex-shrink-0 w-[280px] bg-gray-800 border border-cyan-500/30 rounded-lg p-4 flex flex-col animate-pulse">
    {/* Header */}
    <div className="flex items-center gap-2 mb-3">
      <div className="w-5 h-5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-spin" style={{ animationDuration: '2s' }}>
        <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="25 75" className="text-white/30" />
        </svg>
      </div>
      <span className="text-sm font-medium text-cyan-400">Analyzing...</span>
    </div>
    
    {/* Skeleton content */}
    <div className="space-y-2 flex-1">
      <div className="h-4 w-3/4 bg-gray-700 rounded" />
      <div className="h-3 w-full bg-gray-700 rounded" />
      <div className="h-3 w-5/6 bg-gray-700 rounded" />
    </div>
    
    {/* Footer */}
    <div className="mt-3 pt-2 border-t border-gray-700/50">
      <span className="text-[10px] text-gray-500">Page {pageNumber}</span>
    </div>
  </div>
);

// Error card for failed AI analysis
const ErrorCard: React.FC<{ 
  pageNumber: number; 
  errorMessage?: string;
  onRetry?: () => void;
  onDelete: () => void;
}> = ({ pageNumber, errorMessage, onRetry, onDelete }) => (
  <div className="flex-shrink-0 w-[280px] bg-gray-800 border border-red-500/30 rounded-lg p-4 flex flex-col relative group">
    {/* Delete button */}
    <button
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      className="absolute top-2 right-2 p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
      title="Delete"
    >
      <CloseIcon className="w-4 h-4" />
    </button>
    
    {/* Header */}
    <div className="flex items-center gap-2 mb-3 pr-6">
      <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="text-sm font-medium text-red-400">Analysis Failed</span>
    </div>
    
    {/* Error message */}
    <div className="flex-1">
      <p className="text-xs text-gray-400">{errorMessage || 'Failed to analyze this region'}</p>
    </div>
    
    {/* Footer */}
    <div className="mt-3 pt-2 border-t border-gray-700/50 flex items-center justify-between">
      <span className="text-[10px] text-gray-500">Page {pageNumber}</span>
      {onRetry && (
        <button 
          onClick={onRetry}
          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  </div>
);

// Editable text component
interface EditableTextProps {
  value: string;
  placeholder: string;
  onSave: (newValue: string) => void;
  multiline?: boolean;
  className?: string;
  autoFocus?: boolean;
}

const EditableText: React.FC<EditableTextProps> = ({
  value,
  placeholder,
  onSave,
  multiline = false,
  className = '',
  autoFocus = false,
}) => {
  const [isEditing, setIsEditing] = useState(autoFocus);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (!autoFocus) {
        inputRef.current.select();
      }
    }
  }, [isEditing, autoFocus]);

  const handleBlur = () => {
    setIsEditing(false);
    if (editValue !== value) {
      onSave(editValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleBlur();
    }
    if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    const commonProps = {
      ref: inputRef as any,
      value: editValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setEditValue(e.target.value),
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      className: `w-full bg-gray-900 border border-cyan-500/50 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-cyan-500 ${className}`,
      placeholder,
    };

    return multiline ? (
      <textarea {...commonProps} rows={3} />
    ) : (
      <input type="text" {...commonProps} />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={`cursor-text hover:bg-gray-700/50 rounded px-2 py-1 -mx-2 transition-colors ${className}`}
    >
      {value || <span className="text-gray-500 italic">{placeholder}</span>}
    </div>
  );
};

// Pointer Card component
interface PointerCardProps {
  pointer: ContextPointer;
  isEditing: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
  onUpdateTitle: (newTitle: string) => void;
  onUpdateDescription: (newDescription: string) => void;
  onDelete: () => void;
  setCardRef?: (el: HTMLDivElement | null) => void;
}

const PointerCard: React.FC<PointerCardProps> = ({
  pointer,
  isEditing,
  isSelected,
  isHighlighted,
  onSelect,
  onHover,
  onUpdateTitle,
  onUpdateDescription,
  onDelete,
  setCardRef,
}) => {
  const handleTitleSave = (newTitle: string) => {
    onUpdateTitle(newTitle);
  };

  const handleDescriptionSave = (newDescription: string) => {
    onUpdateDescription(newDescription);
  };

  return (
    <div
      ref={setCardRef}
      onClick={onSelect}
      className={`flex-shrink-0 w-[280px] bg-gray-800 border rounded-lg p-4 flex flex-col relative group cursor-pointer transition-all ${
        isHighlighted 
          ? 'border-cyan-400 ring-2 ring-cyan-400/30' 
          : isSelected 
            ? 'border-blue-500' 
            : 'border-gray-700 hover:border-gray-600'
      }`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Delete button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute top-2 right-2 p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
        title="Delete pointer"
      >
        <CloseIcon className="w-4 h-4" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-2 pr-6">
        <CrosshairIcon className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <div className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
          <EditableText
            value={pointer.title}
            placeholder="Add title..."
            onSave={handleTitleSave}
            autoFocus={isEditing && !pointer.title}
            className="text-sm font-semibold text-gray-200"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <EditableText
          value={pointer.description}
          placeholder="Add description..."
          onSave={handleDescriptionSave}
          multiline
          className="text-xs text-gray-400 leading-relaxed"
        />
      </div>

      {/* Footer - page number */}
      <div className="mt-2 pt-2 border-t border-gray-700/50">
        <span className="text-[10px] text-gray-500">Page {pointer.pageNumber}</span>
      </div>
    </div>
  );
};

// Main AnnotationsPanel component
const AnnotationsPanel: React.FC<AnnotationsPanelProps> = ({
  selectedFileName,
  pointers,
  onPointerUpdate,
  onPointerDelete,
  isCollapsed,
  onToggleCollapse,
  height,
  onHeightChange,
  editingPointerId,
  onEditingPointerIdChange,
  selectedAnnotationIds,
  onSelectedAnnotationIdsChange,
  isAddedToContext,
  onAddToContext,
  onPointerHover,
  onPointerClick,
  highlightedPointerId,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const resizeRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);

  // Scroll to highlighted card when it changes (from clicking on box in PDF)
  useEffect(() => {
    if (highlightedPointerId && cardRefs.current[highlightedPointerId] && scrollContainerRef.current) {
      const card = cardRefs.current[highlightedPointerId];
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [highlightedPointerId]);

  // Handle resize drag
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    
    const startY = e.clientY;
    const startHeight = height;
    
    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      const newHeight = Math.max(150, Math.min(600, startHeight + delta));
      onHeightChange(newHeight);
    };
    
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height, onHeightChange]);

  // Handle card selection
  const handleCardSelect = (pointerId: string) => {
    onEditingPointerIdChange(pointerId);
    onPointerClick?.(pointerId);
    
    // Toggle selection
    const newSelection = new Set(selectedAnnotationIds);
    if (newSelection.has(pointerId)) {
      newSelection.delete(pointerId);
    } else {
      newSelection.add(pointerId);
    }
    onSelectedAnnotationIdsChange(newSelection);
  };

  // Handle pointer update
  const handlePointerUpdate = (id: string, field: 'title' | 'description', value: string) => {
    const pointer = pointers.find(p => p.id === id);
    if (pointer) {
      onPointerUpdate(id, {
        title: field === 'title' ? value : pointer.title,
        description: field === 'description' ? value : pointer.description,
      });
    }
  };

  // Collapsed state
  if (isCollapsed) {
    return (
      <div className="h-12 bg-gray-900/80 border-t border-gray-800 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{selectedFileName}</span>
          <span className="text-xs text-gray-500">
            {pointers.length} annotation{pointers.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
          title="Expand panel"
        >
          <ChevronUpIcon className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div 
      className="bg-gray-900/80 border-t border-gray-800 flex flex-col flex-shrink-0"
      style={{ height }}
    >
      {/* Resize handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleResizeMouseDown}
        className={`h-1 cursor-ns-resize hover:bg-cyan-500/50 transition-colors ${isResizing ? 'bg-cyan-500/50' : ''}`}
      />
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <DocumentIcon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-300">{selectedFileName}</span>
          <span className="text-xs text-gray-500">
            {pointers.length} annotation{pointers.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isAddedToContext && (
            <button
              onClick={onAddToContext}
              className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded transition-colors"
            >
              <PlusIcon className="w-3 h-3" />
              Add to Context
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
            title="Collapse panel"
          >
            <ChevronDownIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Cards container */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden p-4"
      >
        <div className="flex gap-4 h-full min-w-max">
          {pointers.map((pointer) => {
            // Render based on pointer status
            if (pointer.status === 'generating') {
              return (
                <GeneratingCard 
                  key={pointer.id} 
                  pageNumber={pointer.pageNumber} 
                />
              );
            }
            
            if (pointer.status === 'error') {
              return (
                <ErrorCard
                  key={pointer.id}
                  pageNumber={pointer.pageNumber}
                  errorMessage={pointer.errorMessage}
                  onDelete={() => onPointerDelete(pointer.id)}
                />
              );
            }
            
            // Complete or no status (legacy) - render normal card
            return (
              <PointerCard
                key={pointer.id}
                pointer={pointer}
                isEditing={editingPointerId === pointer.id}
                isSelected={selectedAnnotationIds.has(pointer.id)}
                isHighlighted={highlightedPointerId === pointer.id}
                onSelect={() => handleCardSelect(pointer.id)}
                onHover={(hovering) => onPointerHover?.(hovering ? pointer.id : null)}
                onUpdateTitle={(title) => handlePointerUpdate(pointer.id, 'title', title)}
                onUpdateDescription={(desc) => handlePointerUpdate(pointer.id, 'description', desc)}
                onDelete={() => onPointerDelete(pointer.id)}
                setCardRef={(el) => { cardRefs.current[pointer.id] = el; }}
              />
            );
          })}

          {/* Empty state */}
          {pointers.length === 0 && (
            <div className="flex-shrink-0 w-[280px] h-full border-2 border-dashed border-gray-700 rounded-lg p-4 flex items-center justify-center">
              <div className="text-center text-gray-500">
                <CrosshairIcon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No annotations yet</p>
                <p className="text-xs text-gray-600 mt-1">
                  Draw rectangles on the plan to create annotations
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationsPanel;
