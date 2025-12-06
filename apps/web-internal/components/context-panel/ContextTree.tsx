import React from 'react';
import { TreeNode } from './TreeNode';
import { ContextNode } from './utils/db';
import { CheckIcon } from '../Icons';

interface ContextTreeProps {
    nodes: Map<string, ContextNode>;
    expandedNodes: Set<string>;
    onToggleExpand: (nodeId: string) => void;
    onGenerate: (nodeId: string) => void;
    onEdit: (nodeId: string) => void;
    getContextStatus: (nodeId: string) => 'pending' | 'generated' | 'stale' | null;
    isFolderLocked: (nodeId: string) => boolean;
}

export const ContextTree: React.FC<ContextTreeProps> = ({
    nodes, expandedNodes, onToggleExpand, onGenerate, onEdit, getContextStatus, isFolderLocked
}) => {
    
    const renderNode = (nodeId: string, level: number) => {
        const node = nodes.get(nodeId);
        if (!node) return null;
        
        const isExpanded = expandedNodes.has(nodeId);
        const children = Array.from(nodes.values()).filter(n => n.parentId === nodeId);
        
        // Sort children: folders first, then files
        children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        return (
            <div key={nodeId}>
                <TreeNode
                    node={node}
                    expanded={isExpanded}
                    onToggle={() => onToggleExpand(nodeId)}
                    onGenerate={() => onGenerate(nodeId)}
                    onEdit={() => onEdit(nodeId)}
                    status={getContextStatus(nodeId)}
                    isLocked={isFolderLocked(nodeId)}
                    level={level}
                />
                {isExpanded && children.map(child => renderNode(child.id, level + 1))}
            </div>
        );
    };

    const roots = Array.from(nodes.values()).filter(n => !n.parentId);
    // Sort roots
    roots.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'folder' ? -1 : 1;
    });

    return (
        <div className="flex-1 overflow-y-auto custom-scrollbar">
            {roots.length === 0 ? (
                <div className="text-slate-500 text-center mt-10 p-4">
                    <p>No files found.</p>
                    <p className="text-xs mt-2">Tree will populate from project data.</p>
                </div>
            ) : (
                roots.map(root => renderNode(root.id, 0))
            )}
        </div>
    );
};

