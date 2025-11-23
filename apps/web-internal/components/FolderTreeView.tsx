import React, { useState, useRef } from 'react';
import { FileSystemNode } from '../types';
import FileTreeNode from './FileTreeNode';
import { FolderIcon, PlusIcon, DocumentIcon, CubeIcon } from './Icons';

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
  // Upload callbacks
  onUploadProjectMaster?: (files: File[]) => void;
  onUploadModel?: (files: File[]) => void;
  onUploadDeviation?: (file: File) => void;
  onUploadClash?: (file: File) => void;
  onUploadProgress?: (file: File) => void;
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
  onCreateFolder,
  onUploadProjectMaster,
  onUploadModel,
  onUploadDeviation,
  onUploadClash,
  onUploadProgress
}) => {
  const [isRootDragOver, setIsRootDragOver] = useState(false);

  // File input refs
  const projectMasterInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const deviationInputRef = useRef<HTMLInputElement>(null);
  const clashInputRef = useRef<HTMLInputElement>(null);
  const progressInputRef = useRef<HTMLInputElement>(null);

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

  // File upload handlers
  const handleProjectMasterUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUploadProjectMaster) {
      onUploadProjectMaster(Array.from(e.target.files));
    }
    if (e.target.value) e.target.value = '';
  };

  const handleModelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUploadModel) {
      onUploadModel(Array.from(e.target.files));
    }
    if (e.target.value) e.target.value = '';
  };

  const handleDeviationUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUploadDeviation) {
      onUploadDeviation(e.target.files[0]);
    }
    if (e.target.value) e.target.value = '';
  };

  const handleClashUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUploadClash) {
      onUploadClash(e.target.files[0]);
    }
    if (e.target.value) e.target.value = '';
  };

  const handleProgressUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onUploadProgress) {
      onUploadProgress(e.target.files[0]);
    }
    if (e.target.value) e.target.value = '';
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

  // Helper to check if a specific folder path has any files
  const folderHasFiles = (nodesList: FileSystemNode[], folderPath: string[]): boolean => {
    if (folderPath.length === 0) {
      // Check if there are files at this level
      return nodesList.some(node => node.type === 'file');
    }
    
    const [currentFolder, ...remainingPath] = folderPath;
    const folder = nodesList.find(node => node.name === currentFolder && node.type === 'folder');
    
    if (!folder || !folder.children) return false;
    return folderHasFiles(folder.children, remainingPath);
  };

  // Check each category
  const hasProjectMasterFiles = folderHasFiles(nodes, ['Project Master']);
  const hasModelFiles = folderHasFiles(nodes, ['Models']);
  const hasDeviationFiles = folderHasFiles(nodes, ['3DR Reports', 'Deviation']);
  const hasClashFiles = folderHasFiles(nodes, ['3DR Reports', 'Clash']);
  const hasProgressFiles = folderHasFiles(nodes, ['3DR Reports', 'Progress']);

  const showAnyButtons = !hasProjectMasterFiles || !hasModelFiles || !hasDeviationFiles || !hasClashFiles || !hasProgressFiles;

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

      {/* Hidden Inputs */}
      <input
        ref={projectMasterInputRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        onChange={handleProjectMasterUpload}
        className="hidden"
      />
      <input
        ref={modelInputRef}
        type="file"
        accept=".glb,.las,.LAS"
        onChange={handleModelUpload}
        className="hidden"
      />
      <input
        ref={deviationInputRef}
        type="file"
        accept=".pdf"
        onChange={handleDeviationUpload}
        className="hidden"
      />
      <input
        ref={clashInputRef}
        type="file"
        accept=".pdf"
        onChange={handleClashUpload}
        className="hidden"
      />
      <input
        ref={progressInputRef}
        type="file"
        accept=".pdf"
        onChange={handleProgressUpload}
        className="hidden"
      />

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
            <p className="text-xs text-gray-600">Use the upload buttons below to get started</p>
          </div>
        ) : (
          <div className="space-y-0.5 pb-4">
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
          </div>
        )}

        {/* Upload Buttons Section - Show at bottom when needed */}
        {showAnyButtons && (
          <div className="border-t border-gray-800 pt-3 mt-2">
            <div className="flex flex-col gap-3 p-4">
              {!hasProjectMasterFiles && (
                <button
                  onClick={() => projectMasterInputRef.current?.click()}
                  className="w-full py-4 px-4 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-cyan-900/30 hover:to-blue-900/30 border border-dashed border-gray-700 hover:border-cyan-500/50 rounded-xl group transition-all duration-300 flex items-center gap-4 shadow-lg"
                >
                  <div className="p-3 bg-gray-800 rounded-lg group-hover:bg-cyan-900/30 group-hover:scale-110 transition-all duration-300">
                    <DocumentIcon className="h-6 w-6 text-cyan-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-bold text-gray-200 group-hover:text-cyan-400 transition-colors">Project Master</h3>
                    <p className="text-xs text-gray-500 group-hover:text-gray-400">Upload folders or files - plans, contracts, reports</p>
                  </div>
                </button>
              )}

              {!hasModelFiles && (
                <button
                  onClick={() => modelInputRef.current?.click()}
                  className="w-full py-4 px-4 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-purple-900/30 hover:to-pink-900/30 border border-dashed border-gray-700 hover:border-purple-500/50 rounded-xl group transition-all duration-300 flex items-center gap-4 shadow-lg"
                >
                  <div className="p-3 bg-gray-800 rounded-lg group-hover:bg-purple-900/30 group-hover:scale-110 transition-all duration-300">
                    <CubeIcon className="h-6 w-6 text-purple-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="text-sm font-bold text-gray-200 group-hover:text-purple-400 transition-colors">Add Model</h3>
                    <p className="text-xs text-gray-500 group-hover:text-gray-400">Upload .LAS or .glb 3D models</p>
                  </div>
                </button>
              )}

              {(!hasDeviationFiles || !hasClashFiles || !hasProgressFiles) && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider pl-1">3DR Reports</h4>
                  
                  {!hasDeviationFiles && (
                    <button
                      onClick={() => deviationInputRef.current?.click()}
                      className="w-full py-3 px-4 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-orange-900/30 hover:to-red-900/30 border border-dashed border-gray-700 hover:border-orange-500/50 rounded-xl group transition-all duration-300 flex items-center gap-3 shadow-lg"
                    >
                      <div className="p-2 bg-gray-800 rounded-lg group-hover:bg-orange-900/30 group-hover:scale-110 transition-all duration-300">
                        <DocumentIcon className="h-5 w-5 text-orange-400" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-sm font-bold text-gray-200 group-hover:text-orange-400 transition-colors">Deviation</h3>
                      </div>
                    </button>
                  )}

                  {!hasClashFiles && (
                    <button
                      onClick={() => clashInputRef.current?.click()}
                      className="w-full py-3 px-4 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-red-900/30 hover:to-rose-900/30 border border-dashed border-gray-700 hover:border-red-500/50 rounded-xl group transition-all duration-300 flex items-center gap-3 shadow-lg"
                    >
                      <div className="p-2 bg-gray-800 rounded-lg group-hover:bg-red-900/30 group-hover:scale-110 transition-all duration-300">
                        <DocumentIcon className="h-5 w-5 text-red-400" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-sm font-bold text-gray-200 group-hover:text-red-400 transition-colors">Clash</h3>
                      </div>
                    </button>
                  )}

                  {!hasProgressFiles && (
                    <button
                      onClick={() => progressInputRef.current?.click()}
                      className="w-full py-3 px-4 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-green-900/30 hover:to-emerald-900/30 border border-dashed border-gray-700 hover:border-green-500/50 rounded-xl group transition-all duration-300 flex items-center gap-3 shadow-lg"
                    >
                      <div className="p-2 bg-gray-800 rounded-lg group-hover:bg-green-900/30 group-hover:scale-110 transition-all duration-300">
                        <DocumentIcon className="h-5 w-5 text-green-400" />
                      </div>
                      <div className="text-left">
                        <h3 className="text-sm font-bold text-gray-200 group-hover:text-green-400 transition-colors">Progress</h3>
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FolderTreeView;

