import React, { useState, useEffect } from 'react';
import { ContextTree } from './ContextTree';
import { AgentTest } from './AgentTest';
import { MarkdownEditor } from './MarkdownEditor';
import { useContextTree } from './hooks/useContextTree';
import { useMarkdownGeneration } from './hooks/useMarkdownGeneration';
import { useRetrieval } from './hooks/useRetrieval';
import { initDb } from './utils/db';

interface ContextPanelProps {
  fileTree: any[]; // Raw file tree from parent
  onNodeSelect?: (nodeId: string) => void;
  scanData?: any;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ fileTree, onNodeSelect, scanData }) => {
  const [activeTab, setActiveTab] = useState<'tree' | 'agent'>('tree');
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const { 
      nodes, expandedNodes, toggleExpand, getContextStatus, isFolderLocked, initializeTree, refreshFromDb 
  } = useContextTree();
  
  const { 
      generate, getMarkdown, saveMarkdown, aiEdit, isGenerating 
  } = useMarkdownGeneration();
  
  const { 
      search, isSearching, results 
  } = useRetrieval();

  // Initialize DB and Tree
  useEffect(() => {
      const init = async () => {
          await initDb();
          if (fileTree && fileTree.length > 0) {
              await initializeTree(fileTree);
          } else {
              await refreshFromDb();
          }
      };
      init();
  }, [fileTree, initializeTree, refreshFromDb]);

  const handleEdit = (nodeId: string) => {
      setEditingNodeId(nodeId);
  };

  const handleSaveEditor = async (md: string) => {
      if (editingNodeId) {
          await saveMarkdown(editingNodeId, md);
          setEditingNodeId(null);
          refreshFromDb(); // Update status
      }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800 relative w-full">
      {/* Header */}
      <div className="flex border-b border-slate-800">
        <button 
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'tree' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('tree')}
        >
            Context Tree
        </button>
        <button 
            className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'agent' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setActiveTab('agent')}
        >
            Agent Test
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === 'tree' && (
            <ContextTree 
                nodes={nodes}
                expandedNodes={expandedNodes}
                onToggleExpand={toggleExpand}
                onGenerate={async (id) => {
                    // Pass scanData to generate
                    await generate(id, scanData); 
                    refreshFromDb();
                }}
                onEdit={handleEdit}
                getContextStatus={getContextStatus}
                isFolderLocked={isFolderLocked}
            />
        )}
        
        {activeTab === 'agent' && (
            <AgentTest 
                onSearch={search}
                isSearching={isSearching}
                results={results}
                nodes={nodes}
                getMarkdown={getMarkdown}
            />
        )}
        
        {/* Inline Editor Overlay */}
        {editingNodeId && (
            <MarkdownEditor 
                initialMarkdown={getMarkdown(editingNodeId) || ''}
                onSave={handleSaveEditor}
                onCancel={() => setEditingNodeId(null)}
                onAiEdit={(instr) => aiEdit(editingNodeId, instr)}
            />
        )}
      </div>
      
      {/* Footer / Status */}
      <div className="bg-slate-950 p-2 text-xs text-slate-500 flex justify-between border-t border-slate-800">
          <span>{nodes.size} Nodes</span>
          <span>{isGenerating ? 'Generating...' : 'Ready'}</span>
      </div>
    </div>
  );
};

