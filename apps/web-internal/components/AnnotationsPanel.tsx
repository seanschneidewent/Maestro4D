import React, { useState, useEffect } from 'react';
import { ContextPointer } from '../types/context';
import { ChevronDownIcon, ChevronUpIcon, PencilIcon, CloseIcon, DocumentIcon, RectangleIcon, PlusIcon, CheckIcon } from './Icons';

interface AnnotationsPanelProps {
  selectedFileName: string | null;
  pointers: ContextPointer[];
  onPointerUpdate: (id: string, updates: { title: string; description: string }) => void;
  onPointerDelete: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  height: number;
  onHeightChange: (newHeight: number) => void;
  // Controlled editing state for auto-opening form when pointer is created
  editingPointerId?: string | null;
  onEditingPointerIdChange?: (id: string | null) => void;
  selectedAnnotationIds?: Set<string>;
  onSelectedAnnotationIdsChange?: (ids: Set<string>) => void;
  // Add to context feature
  isAddedToContext?: boolean;
  onAddToContext?: () => void;
}

const AnnotationsPanel: React.FC<AnnotationsPanelProps> = ({
  selectedFileName,
  pointers,
  onPointerUpdate,
  onPointerDelete,
  isCollapsed,
  onToggleCollapse,
  height,
  onHeightChange,
  editingPointerId: controlledEditingPointerId,
  onEditingPointerIdChange,
  selectedAnnotationIds: controlledSelectedAnnotationIds,
  onSelectedAnnotationIdsChange,
  isAddedToContext,
  onAddToContext,
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [internalEditingId, setInternalEditingId] = useState<string | null>(null);
  const [internalSelectedAnnotationIds, setInternalSelectedAnnotationIds] = useState<Set<string>>(new Set());
  
  // Use controlled editing state if provided, otherwise use internal state
  const editingId = controlledEditingPointerId !== undefined ? controlledEditingPointerId : internalEditingId;
  const setEditingId = (value: string | null) => {
    if (onEditingPointerIdChange) {
      onEditingPointerIdChange(value);
    } else {
      setInternalEditingId(value);
    }
  };
  
  // Use controlled selectedAnnotationIds if provided, otherwise use internal state
  const selectedAnnotationIds = controlledSelectedAnnotationIds !== undefined ? controlledSelectedAnnotationIds : internalSelectedAnnotationIds;
  const setSelectedAnnotationIds = (value: Set<string>) => {
    if (onSelectedAnnotationIdsChange) {
      onSelectedAnnotationIdsChange(value);
    } else {
      setInternalSelectedAnnotationIds(value);
    }
  };
  
  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Load form data when editing starts
  useEffect(() => {
    if (editingId) {
      setSelectedAnnotationIds(new Set());
      const pointer = pointers.find(p => p.id === editingId);
      if (pointer) {
        setTitle(pointer.title);
        setDescription(pointer.description);
      } else {
        // New pointer with empty title/description
        setTitle('');
        setDescription('');
      }
    }
  }, [editingId, pointers]);

  // Reset selection when file changes
  useEffect(() => {
    setSelectedAnnotationIds(new Set());
  }, [selectedFileName]);

  // Handle resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e: MouseEvent) => {
    const newHeight = window.innerHeight - e.clientY;
    // Constrain height between 200px and 600px
    const constrainedHeight = Math.max(200, Math.min(newHeight, 600));
    onHeightChange(constrainedHeight);
  };

  const handleMouseUp = () => {
    setIsResizing(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  const handleSubmit = () => {
    if (!title.trim() || !editingId) return;
    
    onPointerUpdate(editingId, { title, description });
    setEditingId(null);
    setTitle('');
    setDescription('');
  };

  const handleCancel = () => {
    // If canceling a new pointer (empty title), delete it
    if (editingId) {
      const pointer = pointers.find(p => p.id === editingId);
      if (pointer && !pointer.title.trim()) {
        onPointerDelete(editingId);
      }
    }
    setEditingId(null);
    setTitle('');
    setDescription('');
  };

  const handlePointerClick = (e: React.MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set<string>(selectedAnnotationIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedAnnotationIds(newSelected);
    } else {
      if (selectedAnnotationIds.has(id)) {
        // If clicking an already-selected pointer, deselect it
        const newSelected = new Set<string>(selectedAnnotationIds);
        newSelected.delete(id);
        setSelectedAnnotationIds(newSelected);
      } else {
        // If clicking an unselected pointer, clear others and select only that one
        setSelectedAnnotationIds(new Set<string>([id]));
      }
    }
  };
  
  return (
    <div 
      className={`bg-gray-900 border-t border-gray-800 flex flex-col transition-all duration-200 ease-in-out ${
        isCollapsed ? 'h-10' : ''
      }`}
      style={{ height: isCollapsed ? '40px' : `${height}px` }}
    >
      {/* Drag Handle - Only active when not collapsed */}
      {!isCollapsed && (
        <div 
          className="h-1 bg-gray-800 hover:bg-cyan-500/50 cursor-ns-resize w-full transition-colors"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 cursor-pointer select-none"
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          {isCollapsed ? <ChevronUpIcon className="w-4 h-4 text-gray-400" /> : <ChevronDownIcon className="w-4 h-4 text-gray-400" />}
          <span className="text-sm font-semibold text-gray-200">Context Pointers</span>
          {selectedFileName && (
            <>
              <span className="text-gray-600">|</span>
              <DocumentIcon className="w-3 h-3 text-cyan-500" />
              <span className="text-xs text-cyan-400 font-medium truncate max-w-[200px]">{selectedFileName}</span>
            </>
          )}
          <span className="bg-gray-800 text-gray-400 text-[10px] px-1.5 py-0.5 rounded-full ml-2">
            {pointers.length}
          </span>
        </div>
        {/* Add to Context Button */}
        {selectedFileName && pointers.length > 0 && onAddToContext && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isAddedToContext) {
                onAddToContext();
              }
            }}
            disabled={isAddedToContext}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              isAddedToContext
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 cursor-default'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
            title={isAddedToContext ? 'Already added to context' : 'Add pointers to context'}
          >
            {isAddedToContext ? (
              <>
                <CheckIcon className="w-3 h-3" />
                Added to Context
              </>
            ) : (
              <>
                <PlusIcon className="w-3 h-3" />
                Add to Context
              </>
            )}
          </button>
        )}
      </div>

      {/* Content Area */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {!selectedFileName ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">Select a file to view context pointers</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              
              {/* Edit Form - shown when editing a pointer */}
              {editingId && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-4 animate-fadeIn">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">
                    {pointers.find(p => p.id === editingId)?.title ? 'Edit Context Pointer' : 'New Context Pointer'}
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Title</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Enter title..."
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Enter description..."
                        rows={3}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-cyan-500/50 resize-none"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        onClick={handleCancel}
                        className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={!title.trim()}
                        className={`px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors ${
                          !title.trim() ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Pointers List */}
              {pointers.length === 0 && !editingId ? (
                <div className="text-center py-10">
                  <RectangleIcon className="w-12 h-12 mx-auto mb-3 text-gray-600 opacity-50" />
                  <p className="text-sm text-gray-500">No context pointers yet.</p>
                  <p className="mt-1 text-xs text-gray-600">Use the rectangle tool to draw a region on the PDF.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pointers.map((pointer) => (
                    <div 
                      key={pointer.id}
                      onClick={(e) => handlePointerClick(e, pointer.id)}
                      className={`group relative bg-gray-800 border rounded-lg p-3 transition-all cursor-pointer ${
                        editingId === pointer.id ? 'hidden' : ''
                      } ${
                        selectedAnnotationIds.has(pointer.id)
                          ? 'border-cyan-500'
                          : 'border-gray-700/50 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {pointer.snapshotDataUrl && (
                              <img 
                                src={pointer.snapshotDataUrl} 
                                alt="Snapshot" 
                                className="w-10 h-10 object-cover rounded border border-gray-700"
                              />
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-semibold text-gray-200">
                                {pointer.title || <span className="text-gray-500 italic">Untitled</span>}
                              </h4>
                              <span className="text-[10px] text-gray-500">Page {pointer.pageNumber}</span>
                            </div>
                          </div>
                          {pointer.description && (
                            <p className="text-xs text-gray-400 whitespace-pre-wrap mt-1">{pointer.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(pointer.id);
                            }}
                            className="p-1.5 hover:bg-gray-700 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                            title="Edit"
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onPointerDelete(pointer.id);
                            }}
                            className="p-1.5 hover:bg-gray-700 text-gray-400 hover:text-red-400 rounded transition-colors"
                            title="Delete"
                          >
                            <CloseIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnnotationsPanel;
