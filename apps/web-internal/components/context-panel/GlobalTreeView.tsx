/**
 * GlobalTreeView - Hierarchical tree view showing context across all project files.
 * Structure: Files > Pages > Pointers
 */
import React from 'react';
import {
    DocumentIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CheckIcon,
    SpinnerIcon,
    ExclamationCircleIcon,
    HollowCircleIcon,
    FolderIcon,
} from '../Icons';
import { 
    FileSummary, 
    PageSummary, 
    PointerSummary,
    PointerSummaryBounds,
    SelectionType,
    TreeSelection 
} from './hooks/useProjectContext';

// Status icon component
const StatusIcon: React.FC<{ status: string; size?: 'sm' | 'md' }> = ({ status, size = 'sm' }) => {
    const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
    
    switch (status) {
        case 'complete':
            return <CheckIcon className={`${sizeClass} text-green-400`} />;
        case 'processing':
            return <SpinnerIcon className={`${sizeClass} text-cyan-400`} />;
        case 'error':
            return <ExclamationCircleIcon className={`${sizeClass} text-amber-500`} />;
        case 'pending':
        default:
            return <HollowCircleIcon className={`${sizeClass} text-gray-500`} />;
    }
};

// Pointer item in the tree
const PointerItem: React.FC<{
    pointer: PointerSummary;
    isSelected: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
}> = ({ pointer, isSelected, onClick, onDoubleClick }) => {
    return (
        <button
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded transition-colors ml-8 ${
                isSelected
                    ? 'bg-cyan-500/15 text-cyan-300'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-300'
            }`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
            <span className="text-xs truncate flex-1">{pointer.title}</span>
        </button>
    );
};

// Page item in the tree
const PageItem: React.FC<{
    page: PageSummary;
    fileId: string;
    isExpanded: boolean;
    isSelected: boolean;
    selectedPointerId: string | null;
    onToggleExpand: () => void;
    onSelectPage: () => void;
    onSelectPointer: (pointerId: string) => void;
    onPointerDoubleClick: (pointerId: string, pageNumber: number, bounds?: PointerSummaryBounds) => void;
}> = ({ 
    page, 
    fileId, 
    isExpanded, 
    isSelected, 
    selectedPointerId, 
    onToggleExpand, 
    onSelectPage,
    onSelectPointer,
    onPointerDoubleClick
}) => {
    const hasPointers = page.pointers.length > 0;
    
    return (
        <div className="ml-4">
            <div className="flex items-center">
                {/* Expand/collapse button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand();
                    }}
                    className={`p-0.5 rounded hover:bg-gray-700 transition-colors ${
                        hasPointers ? '' : 'invisible'
                    }`}
                >
                    {isExpanded ? (
                        <ChevronDownIcon className="w-3 h-3 text-gray-500" />
                    ) : (
                        <ChevronRightIcon className="w-3 h-3 text-gray-500" />
                    )}
                </button>
                
                {/* Page button */}
                <button
                    onClick={onSelectPage}
                    className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-left rounded transition-colors ${
                        isSelected
                            ? 'bg-cyan-500/15 text-cyan-300'
                            : 'text-gray-300 hover:bg-gray-800/50'
                    }`}
                >
                    <StatusIcon status={page.status} />
                    <span className="text-xs truncate flex-1">Page {page.pageNumber}</span>
                    {page.pointerCount > 0 && (
                        <span className="text-[9px] text-gray-500 bg-gray-800 px-1 py-0.5 rounded">
                            {page.pointerCount}
                        </span>
                    )}
                    {page.committedAt && (
                        <span className="text-[9px] text-green-400">✓</span>
                    )}
                </button>
            </div>
            
            {/* Pointers list */}
            {isExpanded && hasPointers && (
                <div className="mt-0.5 space-y-0.5">
                    {page.pointers.map((pointer) => (
                        <PointerItem
                            key={pointer.id}
                            pointer={pointer}
                            isSelected={selectedPointerId === pointer.id}
                            onClick={() => onSelectPointer(pointer.id)}
                            onDoubleClick={() => onPointerDoubleClick(pointer.id, page.pageNumber, pointer.bounds)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// File item in the tree
const FileItem: React.FC<{
    file: FileSummary;
    isExpanded: boolean;
    isSelected: boolean;
    expandedPages: Set<string>;
    selection: TreeSelection;
    onToggleExpand: () => void;
    onTogglePageExpand: (pageId: string) => void;
    onSelectFile: () => void;
    onSelectPage: (pageId: string) => void;
    onSelectPointer: (pageId: string, pointerId: string) => void;
    onPointerDoubleClick: (pageId: string, pointerId: string, pageNumber: number, bounds?: PointerSummaryBounds) => void;
}> = ({ 
    file, 
    isExpanded, 
    isSelected, 
    expandedPages,
    selection,
    onToggleExpand, 
    onTogglePageExpand,
    onSelectFile,
    onSelectPage,
    onSelectPointer,
    onPointerDoubleClick
}) => {
    const hasPages = file.pages.length > 0;
    
    // Determine overall status
    const getFileStatus = () => {
        if (file.pagesWithErrors > 0) return 'error';
        if (file.pagesComplete === file.pageCount && file.pageCount > 0) return 'complete';
        if (file.pagesComplete > 0) return 'processing';
        return 'pending';
    };
    
    return (
        <div className="mb-1">
            <div className="flex items-center">
                {/* Expand/collapse button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand();
                    }}
                    className={`p-0.5 rounded hover:bg-gray-700 transition-colors ${
                        hasPages ? '' : 'invisible'
                    }`}
                >
                    {isExpanded ? (
                        <ChevronDownIcon className="w-3.5 h-3.5 text-gray-500" />
                    ) : (
                        <ChevronRightIcon className="w-3.5 h-3.5 text-gray-500" />
                    )}
                </button>
                
                {/* File button */}
                <button
                    onClick={onSelectFile}
                    className={`flex-1 flex items-center gap-2 px-2 py-2 text-left rounded-lg transition-colors ${
                        isSelected
                            ? 'bg-cyan-500/10 border border-cyan-500/30'
                            : 'hover:bg-gray-800/50 border border-transparent'
                    }`}
                >
                    <DocumentIcon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-cyan-400' : 'text-gray-500'}`} />
                    <div className="flex-1 min-w-0">
                        <span className={`text-sm truncate block ${isSelected ? 'text-cyan-300' : 'text-gray-300'}`}>
                            {file.name}
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                        {file.pageCount > 0 && (
                            <span className="text-[9px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                                {file.pagesComplete}/{file.pageCount}
                            </span>
                        )}
                        {file.pointerCount > 0 && (
                            <span className="text-[9px] text-cyan-500 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                                {file.pointerCount} ptr
                            </span>
                        )}
                        <StatusIcon status={getFileStatus()} size="md" />
                    </div>
                </button>
            </div>
            
            {/* Pages list */}
            {isExpanded && hasPages && (
                <div className="mt-1 space-y-0.5">
                    {file.pages.map((page) => (
                        <PageItem
                            key={page.id}
                            page={page}
                            fileId={file.id}
                            isExpanded={expandedPages.has(page.id)}
                            isSelected={selection.pageId === page.id}
                            selectedPointerId={selection.pointerId}
                            onToggleExpand={() => onTogglePageExpand(page.id)}
                            onSelectPage={() => onSelectPage(page.id)}
                            onSelectPointer={(pointerId) => onSelectPointer(page.id, pointerId)}
                            onPointerDoubleClick={(pointerId, pageNumber, bounds) => onPointerDoubleClick(page.id, pointerId, pageNumber, bounds)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

// Main GlobalTreeView component
export interface GlobalTreeViewProps {
    files: FileSummary[];
    selection: TreeSelection;
    expandedFiles: Set<string>;
    expandedPages: Set<string>;
    onToggleFileExpand: (fileId: string) => void;
    onTogglePageExpand: (pageId: string) => void;
    onSelectFile: (fileId: string) => void;
    onSelectPage: (fileId: string, pageId: string) => void;
    onSelectPointer: (fileId: string, pageId: string, pointerId: string) => void;
    /** Called when a pointer item is double-clicked to navigate to source */
    onPointerDoubleClick?: (fileId: string, pageNumber: number, pointerId: string, bounds?: PointerSummaryBounds) => void;
    isLoading?: boolean;
    error?: string | null;
    onRefresh?: () => void;
}

export const GlobalTreeView: React.FC<GlobalTreeViewProps> = ({
    files,
    selection,
    expandedFiles,
    expandedPages,
    onToggleFileExpand,
    onTogglePageExpand,
    onSelectFile,
    onSelectPage,
    onSelectPointer,
    onPointerDoubleClick,
    isLoading = false,
    error = null,
    onRefresh,
}) => {
    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <SpinnerIcon className="w-8 h-8 mb-3 text-cyan-400" />
                <p className="text-sm">Loading context...</p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <ExclamationCircleIcon className="w-8 h-8 mb-3 text-amber-500" />
                <p className="text-sm text-amber-400 text-center">Error loading context</p>
                <p className="text-xs text-gray-500 mt-1 text-center">{error}</p>
                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        className="mt-3 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                    >
                        Retry
                    </button>
                )}
            </div>
        );
    }

    // Empty state
    if (files.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <FolderIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm text-center">No context data yet.</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                    Upload PDFs and process them to see context here.
                </p>
            </div>
        );
    }

    return (
        <div className="p-2 space-y-0.5 overflow-y-auto custom-scrollbar h-full">
            {files.map((file) => (
                <FileItem
                    key={file.id}
                    file={file}
                    isExpanded={expandedFiles.has(file.id)}
                    isSelected={selection.type === 'file' && selection.fileId === file.id}
                    expandedPages={expandedPages}
                    selection={selection}
                    onToggleExpand={() => onToggleFileExpand(file.id)}
                    onTogglePageExpand={onTogglePageExpand}
                    onSelectFile={() => onSelectFile(file.id)}
                    onSelectPage={(pageId) => onSelectPage(file.id, pageId)}
                    onSelectPointer={(pageId, pointerId) => onSelectPointer(file.id, pageId, pointerId)}
                    onPointerDoubleClick={(pageId, pointerId, pageNumber, bounds) => 
                        onPointerDoubleClick?.(file.id, pageNumber, pointerId, bounds)
                    }
                />
            ))}
        </div>
    );
};

export default GlobalTreeView;


