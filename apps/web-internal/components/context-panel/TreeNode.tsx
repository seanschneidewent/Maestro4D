import React from 'react';
import { 
    ChevronRightIcon, 
    ChevronDownIcon, 
    DocumentIcon, 
    FolderIcon, 
    CheckIcon, 
    SparklesIcon, 
    PencilIcon 
} from '../Icons';
import { ContextNode } from './utils/db';

const LockClosedIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
    </svg>
);

interface TreeNodeProps {
  node: ContextNode;
  expanded: boolean;
  onToggle: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  status: 'pending' | 'generated' | 'stale' | null;
  isLocked: boolean;
  level: number;
}

export const TreeNode: React.FC<TreeNodeProps> = ({ 
    node, expanded, onToggle, onGenerate, onEdit, status, isLocked, level 
}) => {
  return (
    <div 
        className={`group flex items-center py-1 px-2 hover:bg-slate-800 text-sm cursor-pointer select-none`}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={onToggle}
    >
        <div className="mr-1 text-slate-400 hover:text-white w-4 flex justify-center">
            {node.type === 'folder' && (
                expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />
            )}
        </div>

        <div className="mr-2 text-slate-400">
            {node.type === 'folder' ? <FolderIcon className="h-4 w-4 text-blue-400" /> : <DocumentIcon className="h-4 w-4" />}
        </div>

        <span className="flex-1 truncate text-slate-300 group-hover:text-white">
            {node.name}
        </span>

        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {isLocked ? (
                <LockClosedIcon className="h-4 w-4 text-slate-600" />
            ) : (
                <>
                    {status === 'generated' && <CheckIcon className="h-4 w-4 text-emerald-500" />}
                    
                    <button 
                        onClick={(e) => { e.stopPropagation(); onGenerate(); }}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-purple-400"
                        title="Generate Context"
                    >
                        <SparklesIcon className="h-4 w-4" />
                    </button>

                    <button 
                        onClick={(e) => { e.stopPropagation(); onEdit(); }}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-blue-400"
                        title="Edit Markdown"
                    >
                        <PencilIcon className="h-4 w-4" />
                    </button>
                </>
            )}
        </div>
    </div>
  );
};

