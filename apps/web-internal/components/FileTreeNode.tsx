import React, { useState, useRef, useEffect } from 'react';
import { FileSystemNode } from '../types';
import { 
  DocumentIcon, 
  PencilIcon, 
  CloseIcon, 
  ChevronRightIcon, 
  ChevronDownIcon,
  FolderIcon
} from './Icons';

interface FileTreeNodeProps {
  node: FileSystemNode;
  level: number;
  selectedId: string | null;
  onSelect: (node: FileSystemNode) => void;
  onToggleExpand: (node: FileSystemNode) => void;
  onRename: (node: FileSystemNode, newName: string) => void;
  onDelete: (node: FileSystemNode) => void;
  onMove: (nodeId: string, targetId: string | undefined) => void;
  onOpenFile: (node: FileSystemNode) => void;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({
  node,
  level,
  selectedId,
  onSelect,
  onToggleExpand,
  onRename,
  onDelete,
  onMove,
  onOpenFile
}) => {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSelected = selectedId === node.id;
  const isFolder = node.type === 'folder';
  
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue !== node.name) {
      onRename(node, renameValue.trim());
    } else {
      setRenameValue(node.name);
    }
    setIsRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setRenameValue(node.name);
      setIsRenaming(false);
    }
    e.stopPropagation();
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: node.id }));
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isFolder && node.id !== JSON.parse(e.dataTransfer.getData('application/json') || '{}').id) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    if (!isFolder) return;

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.id && data.id !== node.id) {
        onMove(data.id, node.id);
      }
    } catch (err) {
      console.error("Invalid drag data", err);
    }
  };
  
  const getFileIcon = () => {
    if (isFolder) return <FolderIcon className={`h-4 w-4 ${isSelected ? 'text-cyan-400' : 'text-blue-400'}`} />;
    
    const ext = node.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return <DocumentIcon className="h-4 w-4 text-red-400" />;
    if (ext === 'csv') return <DocumentIcon className="h-4 w-4 text-green-400" />;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext || '')) return <DocumentIcon className="h-4 w-4 text-purple-400" />;
    if (ext === 'glb') return <DocumentIcon className="h-4 w-4 text-orange-400" />;
    
    return <DocumentIcon className="h-4 w-4 text-gray-400" />;
  };

  return (
    <div 
      className={`select-none ${isDragOver ? 'bg-cyan-900/30 ring-2 ring-cyan-500/50 rounded-md z-10' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div 
        className={`
          flex items-center gap-2 py-1.5 px-2 rounded-lg transition-all duration-200 cursor-pointer group
          ${isSelected ? 'bg-cyan-500/10 text-white shadow-[0_0_10px_rgba(6,182,212,0.1)] border border-cyan-500/30' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200 border border-transparent'}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (isFolder) {
            onToggleExpand(node);
          } else {
            onOpenFile(node);
          }
        }}
        draggable
        onDragStart={handleDragStart}
      >
        {/* Expand/Collapse Icon */}
        <div 
          className={`p-0.5 rounded hover:bg-white/10 transition-colors ${isFolder ? 'visible' : 'invisible'}`}
          onClick={(e) => {
            e.stopPropagation();
            if (isFolder) onToggleExpand(node);
          }}
        >
          {node.expanded ? (
            <ChevronDownIcon className="h-3 w-3" />
          ) : (
            <ChevronRightIcon className="h-3 w-3" />
          )}
        </div>

        {/* File/Folder Icon */}
        {getFileIcon()}

        {/* Name or Input */}
        <div className="flex-1 min-w-0">
          {isRenaming ? (
            <input
              ref={inputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="w-full bg-gray-900 text-white border border-cyan-500 rounded px-1 py-0.5 text-sm focus:outline-none"
            />
          ) : (
            <span className="truncate block text-sm font-medium">{node.name}</span>
          )}
        </div>

        {/* Actions (visible on hover or selected) */}
        <div className={`flex items-center gap-1 ${isSelected || 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsRenaming(true);
            }}
            className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
            title="Rename"
          >
            <PencilIcon className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node);
            }}
            className="p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
            title="Delete"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Render Children */}
      {isFolder && node.expanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onRename={onRename}
              onDelete={onDelete}
              onMove={onMove}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default FileTreeNode;

