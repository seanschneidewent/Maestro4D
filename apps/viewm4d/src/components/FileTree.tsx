import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, ProjectFileTreeNode } from '../types';
import { api } from '../services/api';

interface Props {
  projects: Project[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string, projectId: string) => void;
}

// Category mappings based on common construction document prefixes
const CATEGORY_PREFIXES: Record<string, string> = {
  'A': 'Architectural',
  'AS': 'Architectural Site',
  'C': 'Civil',
  'E': 'Electrical',
  'F2F': 'F2F Canopy',
  'K': 'Kitchen',
  'L': 'Landscape',
  'M': 'Mechanical',
  'OMD': 'OMD Canopy',
  'P': 'Plumbing',
  'Patio': 'Patio Canopy',
  'S': 'Structural',
  'T': 'Title/General',
  'VC': 'Vapor Control',
};

// Extract category from file name
function getCategoryFromFileName(name: string): string {
  // Remove file extension for analysis
  const baseName = name.replace(/\.[^/.]+$/, '');
  
  // Try longer prefixes first (e.g., "F2F", "OMD", "Patio") before single letters
  const sortedPrefixes = Object.keys(CATEGORY_PREFIXES).sort((a, b) => b.length - a.length);
  
  for (const prefix of sortedPrefixes) {
    // Check if name starts with prefix (case insensitive for some, exact for others)
    if (baseName.toUpperCase().startsWith(prefix.toUpperCase())) {
      // For single-letter prefixes, ensure the next char is a digit or hyphen
      if (prefix.length === 1) {
        const nextChar = baseName[1];
        if (nextChar && /[0-9\-_]/.test(nextChar)) {
          return CATEGORY_PREFIXES[prefix];
        }
      } else {
        return CATEGORY_PREFIXES[prefix];
      }
    }
  }
  
  return 'Other';
}

// Group files by category
function groupFilesByCategory(files: ProjectFileTreeNode[]): Map<string, ProjectFileTreeNode[]> {
  const groups = new Map<string, ProjectFileTreeNode[]>();
  
  for (const file of files) {
    if (file.isFolder) continue; // Skip folders
    
    const category = getCategoryFromFileName(file.name);
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(file);
  }
  
  // Sort files within each category
  for (const [, categoryFiles] of groups) {
    categoryFiles.sort((a, b) => a.name.localeCompare(b.name));
  }
  
  return groups;
}

// Recursively collect all files from a tree (including nested folders)
function collectAllFiles(nodes: ProjectFileTreeNode[]): ProjectFileTreeNode[] {
  const files: ProjectFileTreeNode[] = [];
  
  for (const node of nodes) {
    if (!node.isFolder) {
      files.push(node);
    }
    if (node.children && node.children.length > 0) {
      files.push(...collectAllFiles(node.children));
    }
  }
  
  return files;
}

export function FileTree({ projects, selectedFileId, onSelectFile }: Props) {
  const [tree, setTree] = useState<ProjectFileTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const hasInitializedRef = useRef(false);

  // Auto-load the first project's tree
  const activeProject = projects[0] ?? null;

  useEffect(() => {
    if (!activeProject) return;

    const loadTree = async () => {
      setLoading(true);
      setError(null);
      hasInitializedRef.current = false; // Reset initialization flag when project changes
      try {
        const data = await api.getProjectFilesTree(activeProject.id);
        setTree(data);
      } catch (err) {
        setError(api.formatError(err));
      } finally {
        setLoading(false);
      }
    };

    void loadTree();
  }, [activeProject?.id]);

  // Group files by category (derived from file name prefixes)
  const categoryGroups = useMemo(() => {
    if (!tree) return new Map<string, ProjectFileTreeNode[]>();
    
    // Collect all files (flatten any folder structure)
    const allFiles = collectAllFiles(tree);
    
    // Group by derived category
    return groupFilesByCategory(allFiles);
  }, [tree]);

  // Get sorted category names
  const sortedCategories = useMemo(() => {
    return Array.from(categoryGroups.keys()).sort((a, b) => {
      // Put "Other" at the end
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [categoryGroups]);

  // Auto-expand first category only on initial load
  useEffect(() => {
    if (sortedCategories.length > 0 && !hasInitializedRef.current) {
      setExpandedCategory(sortedCategories[0]);
      hasInitializedRef.current = true;
    }
  }, [sortedCategories]);

  const handleCategoryClick = (category: string) => {
    // Toggle: if clicking the same category, collapse it; otherwise expand the new one
    setExpandedCategory((prev) => (prev === category ? null : category));
  };

  if (!activeProject) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-slate-200">
          <div className="text-sm font-semibold text-slate-900">Specifications</div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-sm text-slate-500 text-center">No projects assigned.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-200">
        <div className="text-sm font-semibold text-slate-900">{activeProject.name}</div>
        <div className="text-xs text-slate-500 mt-0.5">Select a category to view plans</div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-4 text-sm text-slate-600">Loading specifications…</div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : sortedCategories.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No files found.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {sortedCategories.map((category) => {
              const isExpanded = expandedCategory === category;
              const files = categoryGroups.get(category) || [];
              const fileCount = files.length;

              return (
                <div key={category}>
                  {/* Accordion Button */}
                  <button
                    type="button"
                    onClick={() => handleCategoryClick(category)}
                    className={`
                      w-full text-left px-3 py-3 flex items-center justify-between
                      transition-colors duration-150
                      ${isExpanded 
                        ? 'bg-blue-50 border-l-4 border-l-blue-500' 
                        : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Folder icon */}
                      <svg 
                        className={`w-5 h-5 flex-shrink-0 ${isExpanded ? 'text-blue-600' : 'text-slate-400'}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path 
                          strokeLinecap="round" 
                          strokeLinejoin="round" 
                          strokeWidth={1.5} 
                          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" 
                        />
                      </svg>
                      <span className={`text-sm font-medium truncate ${isExpanded ? 'text-blue-900' : 'text-slate-700'}`}>
                        {category}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-slate-400">{fileCount} files</span>
                      {/* Chevron */}
                      <svg 
                        className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded File List */}
                  {isExpanded && (
                    <div className="bg-slate-50 border-l-4 border-l-blue-500">
                      {files.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-slate-500">No files in this category.</div>
                      ) : (
                        <div className="py-1">
                          {files.map((file) => {
                            const isSelected = file.id === selectedFileId;
                            return (
                              <button
                                key={file.id}
                                type="button"
                                onClick={() => onSelectFile(file.id, activeProject.id)}
                                className={`
                                  w-full text-left px-4 py-2 flex items-center gap-2
                                  transition-colors duration-100
                                  ${isSelected 
                                    ? 'bg-blue-100 text-blue-900' 
                                    : 'hover:bg-slate-100 text-slate-700'
                                  }
                                `}
                              >
                                {/* Document icon */}
                                <svg 
                                  className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`}
                                  fill="none" 
                                  stroke="currentColor" 
                                  viewBox="0 0 24 24"
                                >
                                  <path 
                                    strokeLinecap="round" 
                                    strokeLinejoin="round" 
                                    strokeWidth={1.5} 
                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" 
                                  />
                                </svg>
                                <span className="text-sm truncate">{file.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
