import { FileSystemNode, NodeType } from '../types';

/**
 * Sorts nodes: Folders first, then files, alphabetically.
 */
export const sortNodes = (nodes: FileSystemNode[]): FileSystemNode[] => {
  return [...nodes].sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'folder' ? -1 : 1;
  });
};

/**
 * Builds a file system tree from a flat list of files with webkitRelativePath or just name.
 */
export const buildTreeFromFiles = (files: File[]): FileSystemNode[] => {
  const root: FileSystemNode[] = [];
  const map: Record<string, FileSystemNode> = {};

  // Helper to find or create a folder node
  const getOrCreateFolder = (pathParts: string[], parentId?: string): FileSystemNode => {
    const path = pathParts.join('/');
    if (map[path]) return map[path];

    const name = pathParts[pathParts.length - 1];
    const id = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const node: FileSystemNode = {
      id,
      name,
      type: 'folder',
      path,
      children: [],
      parentId,
      expanded: false
    };

    map[path] = node;

    if (parentId) {
      // Find parent node to attach this child
      // We need to search in the root or within other folders
      // But we can just use the map since we process top-down usually
      // However, since we might jump into a deep path, we should ensure parents exist
      // Actually, we'll build top-down
    } else {
      root.push(node);
    }
    
    return node;
  };

  // Better approach: Process each file and create necessary folder structure
  files.forEach(file => {
    const filePath = file.webkitRelativePath || file.name;
    const parts = filePath.split('/');
    
    // If it's just a filename (no folders), add to root
    if (parts.length === 1) {
      const node: FileSystemNode = {
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: 'file',
        path: file.name,
        file: file
      };
      root.push(node);
      return;
    }

    // Handle nested files
    let currentLevel = root;
    let currentPath = '';
    let parentId: string | undefined = undefined;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (isLast) {
        // It's the file
        const node: FileSystemNode = {
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          type: 'file',
          path: currentPath,
          file: file,
          parentId
        };
        currentLevel.push(node);
      } else {
        // It's a folder
        let folderNode = currentLevel.find(n => n.name === part && n.type === 'folder');
        
        if (!folderNode) {
          folderNode = {
            id: `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: part,
            type: 'folder',
            path: currentPath,
            children: [],
            parentId,
            expanded: false // Collapse by default when uploading
          };
          currentLevel.push(folderNode);
        }
        
        // Prepare for next iteration
        if (!folderNode.children) folderNode.children = [];
        currentLevel = folderNode.children;
        parentId = folderNode.id;
      }
    }
  });

  // Recursive sort
  const sortRecursive = (nodes: FileSystemNode[]) => {
    const sorted = sortNodes(nodes);
    sorted.forEach(node => {
      if (node.children) {
        node.children = sortRecursive(node.children);
      }
    });
    return sorted;
  };

  return sortRecursive(root);
};

/**
 * Flattens the tree into a list of nodes.
 */
export const flattenTree = (nodes: FileSystemNode[]): FileSystemNode[] => {
  let flat: FileSystemNode[] = [];
  nodes.forEach(node => {
    flat.push(node);
    if (node.children) {
      flat = flat.concat(flattenTree(node.children));
    }
  });
  return flat;
};

/**
 * Finds a node by ID in the tree.
 */
export const findNodeById = (nodes: FileSystemNode[], id: string): FileSystemNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
};

/**
 * Updates a node in the tree.
 */
export const updateNodeInTree = (nodes: FileSystemNode[], id: string, updates: Partial<FileSystemNode>): FileSystemNode[] => {
  return nodes.map(node => {
    if (node.id === id) {
      return { ...node, ...updates };
    }
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updates) };
    }
    return node;
  });
};

/**
 * Removes a node from the tree.
 */
export const removeNodeFromTree = (nodes: FileSystemNode[], id: string): FileSystemNode[] => {
  return nodes.filter(node => {
    if (node.id === id) return false;
    if (node.children) {
      node.children = removeNodeFromTree(node.children, id);
    }
    return true;
  });
};

/**
 * Adds a node to a parent folder (or root if parentId is undefined).
 */
export const addNodeToTree = (nodes: FileSystemNode[], newNode: FileSystemNode, parentId?: string): FileSystemNode[] => {
  if (!parentId) {
    const newNodes = [...nodes, newNode];
    return sortNodes(newNodes);
  }

  return nodes.map(node => {
    if (node.id === parentId) {
      const children = node.children ? [...node.children, newNode] : [newNode];
      return { ...node, children: sortNodes(children), expanded: true };
    }
    if (node.children) {
      return { ...node, children: addNodeToTree(node.children, newNode, parentId) };
    }
    return node;
  });
};

/**
 * Updates paths of a node and its children after a move or rename.
 */
export const updatePaths = (node: FileSystemNode, parentPath: string): FileSystemNode => {
  const newPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  const updatedNode = { ...node, path: newPath };
  
  if (updatedNode.children) {
    updatedNode.children = updatedNode.children.map(child => updatePaths(child, newPath));
  }
  
  return updatedNode;
};

/**
 * Moves a node to a new parent.
 */
export const moveNode = (nodes: FileSystemNode[], nodeId: string, targetParentId?: string): FileSystemNode[] => {
  // 1. Find the node to move
  const nodeToMove = findNodeById(nodes, nodeId);
  if (!nodeToMove) return nodes;

  // 2. Check if we are trying to drop a folder into itself or its children
  if (nodeToMove.type === 'folder' && targetParentId) {
     const targetNode = findNodeById(nodes, targetParentId);
     if (targetNode && targetNode.path.startsWith(nodeToMove.path)) {
       console.warn("Cannot move a folder into itself or its children");
       return nodes;
     }
  }
  
  // 3. Remove from old location
  const nodesWithoutMoved = removeNodeFromTree(nodes, nodeId);
  
  // 4. Update parentId and paths
  let targetPath = '';
  if (targetParentId) {
    const targetParent = findNodeById(nodes, targetParentId);
    if (targetParent) targetPath = targetParent.path;
  }
  
  const updatedNode = updatePaths({ ...nodeToMove, parentId: targetParentId }, targetPath);
  
  // 5. Add to new location
  return addNodeToTree(nodesWithoutMoved, updatedNode, targetParentId);
};

/**
 * Renames a node.
 */
export const renameNode = (nodes: FileSystemNode[], nodeId: string, newName: string): FileSystemNode[] => {
  const node = findNodeById(nodes, nodeId);
  if (!node) return nodes;
  
  // Check for duplicates in the same directory
  // This requires finding the parent and checking its children
  // For simplicity, we'll skip strict duplicate check here and assume UI handles it or we append suffix
  
  let parentPath = '';
  const lastSlashIndex = node.path.lastIndexOf('/');
  if (lastSlashIndex !== -1) {
    parentPath = node.path.substring(0, lastSlashIndex);
  }
  
  const updatedNode = { ...node, name: newName };
  const nodeWithNewPath = updatePaths(updatedNode, parentPath);
  
  // We need to replace the node in the tree with the updated one (and its children paths updated)
  // Since updatePaths updates children recursively, we just need to swap the node
  
  const replaceNode = (list: FileSystemNode[]): FileSystemNode[] => {
    return list.map(n => {
      if (n.id === nodeId) {
        return nodeWithNewPath;
      }
      if (n.children) {
        return { ...n, children: replaceNode(n.children) };
      }
      return n;
    });
  };
  
  return replaceNode(nodes);
};

