import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SheetContext } from '../../types/context';
import { 
    DocumentIcon, 
    ChevronLeftIcon, 
    ChevronRightIcon, 
    HollowCircleIcon, 
    FilledCircleIcon, 
    SpinnerIcon, 
    ExclamationCircleIcon,
    EyeIcon,
    MinusIcon
} from '../Icons';

interface ContextPanelProps {
    sheetContexts: Record<string, SheetContext>;
    selectedSheetId: string | null;
    onSelectSheet: (sheetId: string | null) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    width: number;
    onWidthChange: (width: number) => void;
}

// Status indicator component
const StatusIndicator: React.FC<{ sheet: SheetContext }> = ({ sheet }) => {
    const { generationStatus, pointers } = sheet;
    const hasPointers = pointers.length > 0;

    if (generationStatus === 'generating') {
        return <SpinnerIcon className="h-3 w-3 text-cyan-400" />;
    }

    if (generationStatus === 'error') {
        return <ExclamationCircleIcon className="h-3.5 w-3.5 text-amber-500" />;
    }

    if (generationStatus === 'complete') {
        return <FilledCircleIcon className="h-3 w-3 text-cyan-400" />;
    }

    // idle state
    if (hasPointers) {
        return <HollowCircleIcon className="h-3 w-3 text-gray-400" />;
    }

    // idle with no pointers - no indicator
    return null;
};

// Sheet item component for the tree view
const SheetItem: React.FC<{
    sheet: SheetContext;
    isSelected: boolean;
    onClick: () => void;
}> = ({ sheet, isSelected, onClick }) => {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-all duration-150 group ${
                isSelected
                    ? 'bg-cyan-500/10 border border-cyan-500/30'
                    : 'hover:bg-gray-800/50 border border-transparent'
            }`}
        >
            <DocumentIcon className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-cyan-400' : 'text-gray-500'}`} />
            <div className="flex-1 min-w-0">
                <span className={`text-sm truncate block ${isSelected ? 'text-cyan-300' : 'text-gray-300'}`}>
                    {sheet.fileName}
                </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                {sheet.pointers.length > 0 && (
                    <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                        {sheet.pointers.length}
                    </span>
                )}
                <StatusIndicator sheet={sheet} />
            </div>
        </button>
    );
};

// Tree view component
const TreeView: React.FC<{
    sheets: SheetContext[];
    selectedSheetId: string | null;
    onSelectSheet: (sheetId: string | null) => void;
}> = ({ sheets, selectedSheetId, onSelectSheet }) => {
    if (sheets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm text-center">No sheets with context pointers yet.</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                    Add context pointers to PDF sheets to generate markdown.
                </p>
            </div>
        );
    }

    return (
        <div className="p-3 space-y-1">
            {sheets.map((sheet) => (
                <SheetItem
                    key={sheet.fileId}
                    sheet={sheet}
                    isSelected={selectedSheetId === sheet.fileId}
                    onClick={() => onSelectSheet(
                        selectedSheetId === sheet.fileId ? null : sheet.fileId
                    )}
                />
            ))}
        </div>
    );
};

// Preview view component
const PreviewView: React.FC<{
    selectedSheet: SheetContext | null;
}> = ({ selectedSheet }) => {
    if (!selectedSheet) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <EyeIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">Select a sheet to preview</p>
            </div>
        );
    }

    if (selectedSheet.generationStatus === 'generating') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <SpinnerIcon className="w-8 h-8 mb-3 text-cyan-400" />
                <p className="text-sm text-gray-300">Generating markdown...</p>
                <p className="text-xs text-gray-500 mt-1">{selectedSheet.fileName}</p>
            </div>
        );
    }

    if (selectedSheet.generationStatus === 'error') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <ExclamationCircleIcon className="w-8 h-8 mb-3 text-amber-500" />
                <p className="text-sm text-amber-400">Generation failed</p>
                <p className="text-xs text-gray-500 mt-2 text-center max-w-[200px]">
                    {selectedSheet.generationError || 'An error occurred while generating markdown.'}
                </p>
                <p className="text-xs text-gray-600 mt-2">
                    Try again or check the context pointers.
                </p>
            </div>
        );
    }

    if (!selectedSheet.markdownContent) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm text-center">No markdown generated yet.</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                    Add context pointers and click Generate.
                </p>
            </div>
        );
    }

    return (
        <div className="h-full overflow-auto p-4 custom-scrollbar">
            <div className="prose prose-invert prose-sm max-w-none
                prose-headings:text-gray-200 prose-headings:font-semibold
                prose-h1:text-lg prose-h1:border-b prose-h1:border-gray-700 prose-h1:pb-2 prose-h1:mb-4
                prose-h2:text-base prose-h2:text-cyan-400
                prose-h3:text-sm prose-h3:text-gray-300
                prose-p:text-gray-400 prose-p:leading-relaxed
                prose-a:text-cyan-400 prose-a:no-underline hover:prose-a:underline
                prose-strong:text-gray-300
                prose-code:text-cyan-300 prose-code:bg-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
                prose-pre:bg-gray-800 prose-pre:border prose-pre:border-gray-700
                prose-ul:text-gray-400 prose-ol:text-gray-400
                prose-li:marker:text-gray-600
                prose-blockquote:border-l-cyan-500 prose-blockquote:text-gray-400
                prose-table:text-sm
                prose-th:text-gray-300 prose-th:bg-gray-800 prose-th:px-3 prose-th:py-2
                prose-td:text-gray-400 prose-td:px-3 prose-td:py-2 prose-td:border-gray-700
            ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedSheet.markdownContent}
                </ReactMarkdown>
            </div>
        </div>
    );
};

export const ContextPanel: React.FC<ContextPanelProps> = ({
    sheetContexts,
    selectedSheetId,
    onSelectSheet,
    isCollapsed,
    onToggleCollapse,
    width,
    onWidthChange,
}) => {
    const [isResizing, setIsResizing] = useState(false);

    // Sort sheets alphabetically by fileName
    const sortedSheets = useMemo(() => {
        return Object.values(sheetContexts)
            .sort((a, b) => a.fileName.localeCompare(b.fileName));
    }, [sheetContexts]);

    // Get selected sheet
    const selectedSheet = selectedSheetId ? sheetContexts[selectedSheetId] : null;

    // Count stats
    const stats = useMemo(() => {
        const sheets = Object.values(sheetContexts);
        return {
            total: sheets.length,
            withPointers: sheets.filter(s => s.pointers.length > 0).length,
            complete: sheets.filter(s => s.generationStatus === 'complete').length,
        };
    }, [sheetContexts]);

    // Handle resize
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);

        const handleMouseMove = (e: MouseEvent) => {
            // Calculate new width from the left edge of the panel
            const newWidth = window.innerWidth - e.clientX;
            // Constrain between 300px and 600px
            const constrainedWidth = Math.max(300, Math.min(newWidth, 600));
            onWidthChange(constrainedWidth);
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    // Collapsed state
    if (isCollapsed) {
        return (
            <div className="h-full w-12 bg-gray-900 border-l border-gray-800 flex flex-col items-center py-4">
                <button
                    onClick={onToggleCollapse}
                    className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                    title="Expand panel"
                >
                    <ChevronLeftIcon className="h-4 w-4 text-gray-400" />
                </button>
                <div className="flex-1 flex items-center justify-center">
                    <span className="[writing-mode:vertical-rl] rotate-180 text-xs font-medium text-gray-500 tracking-wider">
                        Context Files
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div 
            className="h-full flex flex-col bg-gray-900 border-l border-gray-800 relative"
            style={{ width: `${width}px` }}
        >
            {/* Resize Handle */}
            <div
                className={`absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-cyan-500/50 transition-colors ${
                    isResizing ? 'bg-cyan-500/50' : 'bg-transparent'
                }`}
                onMouseDown={handleMouseDown}
            />

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                <h2 className="text-sm font-semibold text-gray-200">Context Files</h2>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onToggleCollapse}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                        title="Collapse panel"
                    >
                        <MinusIcon className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                    <button
                        onClick={onToggleCollapse}
                        className="p-1.5 hover:bg-gray-800 rounded transition-colors"
                        title="Close panel"
                    >
                        <ChevronRightIcon className="h-4 w-4 text-gray-400" />
                    </button>
                </div>
            </div>

            {/* Split Content: Tree + Preview */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: File Tree */}
                <div className="w-[180px] min-w-[150px] max-w-[200px] border-r border-gray-700 overflow-y-auto custom-scrollbar">
                    <TreeView
                        sheets={sortedSheets}
                        selectedSheetId={selectedSheetId}
                        onSelectSheet={onSelectSheet}
                    />
                </div>
                {/* Right: Markdown Preview */}
                <div className="flex-1 overflow-hidden">
                    <PreviewView selectedSheet={selectedSheet} />
                </div>
            </div>

            {/* Footer Stats */}
            <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-[10px] text-gray-500">
                <span>{stats.total} sheets</span>
                <span>{stats.complete}/{stats.withPointers} generated</span>
            </div>
        </div>
    );
};

export default ContextPanel;
