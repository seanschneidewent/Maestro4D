import React, { useState, useEffect, useRef } from 'react';
import { Annotation } from '../types';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, PencilIcon, CloseIcon, DocumentIcon } from './Icons';

interface AnnotationsPanelProps {
  selectedFileName: string | null;
  annotations: Annotation[];
  onAddAnnotation: (title: string, description: string) => void;
  onEditAnnotation: (id: string, title: string, description: string) => void;
  onDeleteAnnotation: (id: string) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  height: number;
  onHeightChange: (newHeight: number) => void;
  isAdding?: boolean;
  onIsAddingChange?: (isAdding: boolean) => void;
  selectedAnnotationIds?: Set<string>;
  onSelectedAnnotationIdsChange?: (ids: Set<string>) => void;
  onAddRectangleToAnnotation?: (annotationId: string) => void;
}

const AnnotationsPanel: React.FC<AnnotationsPanelProps> = ({
  selectedFileName,
  annotations,
  onAddAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  isCollapsed,
  onToggleCollapse,
  height,
  onHeightChange,
  isAdding: controlledIsAdding,
  onIsAddingChange,
  selectedAnnotationIds: controlledSelectedAnnotationIds,
  onSelectedAnnotationIdsChange,
  onAddRectangleToAnnotation
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [internalIsAdding, setInternalIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [internalSelectedAnnotationIds, setInternalSelectedAnnotationIds] = useState<Set<string>>(new Set());
  
  // Use controlled state if provided, otherwise use internal state
  const isAdding = controlledIsAdding !== undefined ? controlledIsAdding : internalIsAdding;
  const setIsAdding = (value: boolean) => {
    if (onIsAddingChange) {
      onIsAddingChange(value);
    } else {
      setInternalIsAdding(value);
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

  // Reset form when starting to add or edit
  useEffect(() => {
    if (isAdding) {
      setTitle('');
      setDescription('');
      setSelectedAnnotationIds(new Set());
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingId) {
      setSelectedAnnotationIds(new Set());
      const annotation = annotations.find(a => a.id === editingId);
      if (annotation) {
        setTitle(annotation.title);
        setDescription(annotation.description);
      }
    }
  }, [editingId, annotations]);

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
    if (!title.trim()) return;
    
    if (editingId) {
      onEditAnnotation(editingId, title, description);
      setEditingId(null);
    } else {
      onAddAnnotation(title, description);
      setIsAdding(false);
    }
    setTitle('');
    setDescription('');
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setTitle('');
    setDescription('');
  };

  const handleAnnotationClick = (e: React.MouseEvent, id: string) => {
    if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set(selectedAnnotationIds);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedAnnotationIds(newSelected);
    } else {
      if (selectedAnnotationIds.has(id)) {
        // If clicking an already-selected annotation, deselect it (keep others if any, or empty if it was the only one)
        // Note: Requirement says "deselect it", which implies removing from selection.
        const newSelected = new Set(selectedAnnotationIds);
        newSelected.delete(id);
        setSelectedAnnotationIds(newSelected);
      } else {
        // If clicking an unselected annotation, clear others and select only that one
        setSelectedAnnotationIds(new Set([id]));
      }
    }
  };

  // If no file is selected, show empty state or return null depending on design preference
  // Here we show a placeholder message in the header if collapsed, or empty state in body
  
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
          <span className="text-sm font-semibold text-gray-200">Annotations</span>
          {selectedFileName && (
            <>
              <span className="text-gray-600">|</span>
              <DocumentIcon className="w-3 h-3 text-cyan-500" />
              <span className="text-xs text-cyan-400 font-medium truncate max-w-[200px]">{selectedFileName}</span>
            </>
          )}
          <span className="bg-gray-800 text-gray-400 text-[10px] px-1.5 py-0.5 rounded-full ml-2">
            {annotations.length}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {!isCollapsed && selectedFileName && !isAdding && !editingId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsAdding(true);
              }}
              className="flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-xs rounded transition-colors"
            >
              <PlusIcon className="w-3 h-3" />
              <span>Add Annotation</span>
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {!selectedFileName ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">Select a file to view or add annotations</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-4">
              
              {/* Add/Edit Form */}
              {(isAdding || editingId) && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-4 animate-fadeIn">
                  <h3 className="text-sm font-medium text-gray-300 mb-3">
                    {editingId ? 'Edit Annotation' : 'New Annotation'}
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
                        {editingId ? 'Save Changes' : 'Create Annotation'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Annotations List */}
              {annotations.length === 0 && !isAdding ? (
                <div className="text-center py-10">
                  <p className="text-sm text-gray-500">No annotations yet for this file.</p>
                  <button
                    onClick={() => setIsAdding(true)}
                    className="mt-2 text-cyan-500 hover:text-cyan-400 text-xs font-medium"
                  >
                    Create your first annotation
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {annotations.map((annotation) => (
                    <div 
                      key={annotation.id}
                      onClick={(e) => handleAnnotationClick(e, annotation.id)}
                      className={`group relative bg-gray-800 border rounded-lg p-3 transition-all cursor-pointer ${
                        editingId === annotation.id ? 'hidden' : ''
                      } ${
                        selectedAnnotationIds.has(annotation.id)
                          ? 'border-cyan-500'
                          : 'border-gray-700/50 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold text-gray-200 mb-1">{annotation.title}</h4>
                          <p className="text-xs text-gray-400 whitespace-pre-wrap">{annotation.description}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {onAddRectangleToAnnotation && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddRectangleToAnnotation(annotation.id);
                              }}
                              className="p-1.5 hover:bg-gray-700 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                              title="Add Rectangle"
                            >
                              <PlusIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(annotation.id);
                            }}
                            className="p-1.5 hover:bg-gray-700 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                            title="Edit"
                          >
                            <PencilIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteAnnotation(annotation.id);
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

