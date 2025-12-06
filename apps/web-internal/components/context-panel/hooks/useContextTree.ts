import { useState, useCallback } from 'react';
import { getDb, ContextNode } from '../utils/db';

export interface UseContextTreeReturn {
  nodes: Map<string, ContextNode>;
  expandedNodes: Set<string>;
  toggleExpand: (nodeId: string) => void;
  getChildren: (parentId: string | null) => ContextNode[];
  getContextStatus: (nodeId: string) => 'pending' | 'generated' | 'stale' | null;
  isFolderLocked: (nodeId: string) => boolean;
  refreshFromDb: () => Promise<void>;
  initializeTree: (fileTree: any[]) => Promise<void>;
}

export const useContextTree = (): UseContextTreeReturn => {
  const [nodes, setNodes] = useState<Map<string, ContextNode>>(new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [contextStatuses, setContextStatuses] = useState<Map<string, 'pending' | 'generated' | 'stale'>>(new Map());

  const refreshFromDb = useCallback(async () => {
    try {
        const db = getDb();
        // Load nodes
        // db.exec returns [{columns, values}]
        const nodesResult = db.exec("SELECT id, parent_id, name, type, path, created_at FROM nodes");
        const newNodes = new Map<string, ContextNode>();
        if (nodesResult.length > 0 && nodesResult[0].values) {
            nodesResult[0].values.forEach((row: any[]) => {
                const node: ContextNode = {
                    id: row[0] as string,
                    parentId: row[1] as string | null,
                    name: row[2] as string,
                    type: row[3] as 'file' | 'folder',
                    path: row[4] as string,
                    createdAt: row[5] as string
                };
                newNodes.set(node.id, node);
            });
        }
        setNodes(newNodes);

        // Load statuses
        const statusResult = db.exec("SELECT node_id, status FROM context");
        const newStatuses = new Map<string, 'pending' | 'generated' | 'stale'>();
        if (statusResult.length > 0 && statusResult[0].values) {
            statusResult[0].values.forEach((row: any[]) => {
                newStatuses.set(row[0] as string, row[1] as 'pending' | 'generated' | 'stale');
            });
        }
        setContextStatuses(newStatuses);
    } catch (e) {
        console.error("Failed to refresh from DB", e);
    }
  }, []);

  const toggleExpand = (nodeId: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) newExpanded.delete(nodeId);
    else newExpanded.add(nodeId);
    setExpandedNodes(newExpanded);
  };

  const getChildren = (parentId: string | null) => {
    return Array.from(nodes.values()).filter(n => n.parentId === parentId);
  };

  const getContextStatus = (nodeId: string) => {
    return contextStatuses.get(nodeId) || null;
  };

  const isFolderLocked = (nodeId: string) => {
    const node = nodes.get(nodeId);
    if (!node || node.type !== 'folder') return false;
    const children = getChildren(nodeId);
    // Locked if any child file lacks generated context
    // This assumes we only care about direct children files
    return children.some(child => {
        if (child.type === 'file') {
            const status = getContextStatus(child.id);
            return status !== 'generated';
        }
        return false;
    });
  };

  const initializeTree = useCallback(async (fileTree: any[]) => {
      try {
        const db = getDb();
        
        // Helper to recursively insert nodes
        const insertNode = (node: any, parentId: string | null) => {
            // Assume node has id, name, type, children, path
            // Or generate ID if missing? existing fileTree might rely on path.
            // I'll use a deterministic ID or provided ID.
            const id = node.id || crypto.randomUUID(); 
            const type = node.children ? 'folder' : 'file'; // Basic inference
            const path = node.path || node.name; // Simplified

            db.run(`INSERT OR IGNORE INTO nodes (id, parent_id, name, type, path) VALUES (?, ?, ?, ?, ?)`, 
                [id, parentId, node.name, type, path]);
            
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child: any) => insertNode(child, id));
            }
        };

        db.exec("BEGIN TRANSACTION");
        fileTree.forEach(rootNode => insertNode(rootNode, null));
        db.exec("COMMIT");
        
        await refreshFromDb();
      } catch (e) {
        console.error("Failed to init tree", e);
      }
  }, [refreshFromDb]);

  return {
    nodes,
    expandedNodes,
    toggleExpand,
    getChildren,
    getContextStatus,
    isFolderLocked,
    refreshFromDb,
    initializeTree
  };
};

