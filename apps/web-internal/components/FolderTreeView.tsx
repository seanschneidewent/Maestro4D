import React, { useState } from 'react';
import { FileSystemNode } from '../types';
import FileTreeNode from './FileTreeNode';
import { FolderIcon, PlusIcon, DocumentIcon } from './Icons';

interface FolderTreeViewProps {
  nodes: FileSystemNode[];
  selectedNodeId: string | null;
  onSelectNode: (node: FileSystemNode) => void;
  onToggleExpand: (node: FileSystemNode) => void;
  onRenameNode: (node: FileSystemNode, newName: string) => void;
  onDeleteNode: (node: FileSystemNode) => void;
  onMoveNode: (nodeId: string, targetParentId: string | undefined) => void;
  onOpenFile: (node: FileSystemNode) => void;
  onCreateFolder: (parentId?: string) => void;
}

const FolderTreeView: React.FC<FolderTreeViewProps> = ({
  nodes,
  selectedNodeId,
  onSelectNode,
  onToggleExpand,
  onRenameNode,
  onDeleteNode,
  onMoveNode,
  onOpenFile,
  onCreateFolder
}) => {
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRootDragOver(true);
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRootDragOver(false);
  };

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsRootDragOver(false);
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.id) {
        onMoveNode(data.id, undefined); // Move to root
      }
    } catch (err) {
      console.error("Invalid drag data", err);
    }
  };

  // Find selected node to know where to create new folder
  // Helper to find node by ID
  const findNode = (nodesList: FileSystemNode[], id: string): FileSystemNode | undefined => {
    for (const node of nodesList) {
      if (node.id === id) return node;
      if (node.children) {
        const found = findNode(node.children, id);
        if (found) return found;
      }
    }
    return undefined;
  };

  const selectedNode = selectedNodeId ? findNode(nodes, selectedNodeId) : undefined;
  const activeFolderId = selectedNode?.type === 'folder' ? selectedNode.id : selectedNode?.parentId;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 px-1">
        <button
          onClick={() => onCreateFolder(activeFolderId)}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg border border-white/5 transition-all text-xs font-bold uppercase tracking-wide"
          title={activeFolderId ? "New Folder in Selection" : "New Root Folder"}
        >
          <FolderIcon className="h-4 w-4" />
          <span>New Folder</span>
        </button>
      </div>

      {/* Tree Area */}
      <div 
        className={`flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-[200px] rounded-xl transition-colors ${isRootDragOver ? 'bg-gray-800/30 ring-2 ring-cyan-500/30' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {nodes.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-gray-800 rounded-xl text-gray-500">
            <DocumentIcon className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-sm font-medium mb-1">No files yet</p>
            <p className="text-xs text-gray-600">Upload files or folders to get started</p>
          </div>
        ) : (
          <div className="space-y-0.5 pb-10">
            {nodes.map(node => (
              <FileTreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedNodeId}
                onSelect={onSelectNode}
                onToggleExpand={onToggleExpand}
                onRename={onRenameNode}
                onDelete={onDeleteNode}
                onMove={onMoveNode}
                onOpenFile={onOpenFile}
              />
            ))}
            
            {/* Invisible drop target at the bottom to drop into root */}
            <div className="h-20 w-full" />
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderTreeView;

