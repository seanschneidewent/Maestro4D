import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SheetContext } from '../../types/context';
import { ProcessedBatch, ProcessedPointer, ProcessedBatchSummary } from '../../types/n8n';
import { useN8NExport, useProcessedBatches, useProcessingStatus, useProjectContext, PointerSummaryBounds, FileSummary, useAIProcessing, stripBase64Prefix } from './hooks';
import { StreamingProcessedView } from './StreamingProcessedView';
import { GlobalTreeView } from './GlobalTreeView';
import { GlobalPreviewView } from './GlobalPreviewView';
import { 
    DocumentIcon, 
    ChevronLeftIcon, 
    ChevronRightIcon,
    ChevronDownIcon,
    HollowCircleIcon, 
    FilledCircleIcon, 
    SpinnerIcon, 
    ExclamationCircleIcon,
    EyeIcon,
    MinusIcon,
    CloudArrowUpIcon,
    InboxIcon,
    RefreshIcon,
    TrashIcon,
    DatabaseIcon,
    ArrowLeftIcon,
    CheckIcon,
    PencilIcon,
    CloseIcon,
    FolderIcon,
    PlusIcon
} from '../Icons';
import { PagesTab } from './PagesTab';
import { DisciplinesTab } from './DisciplinesTab';
import { 
    commitBatch, 
    BatchCommitRequest, 
    fetchContextPreview, 
    ContextPreviewResponse, 
    commitContext, 
    ContextCommitResponse,
    fetchProjectCommitPreview,
    ProjectCommitPreviewResponse,
    commitProjectContext,
    getPointerCropImageUrl,
    uncommitProjectPointers,
    deleteAllProjectPointers
} from '../../utils/api';

type ViewMode = 'pointers' | 'pages' | 'disciplines';

interface ContextPanelProps {
    sheetContexts: Record<string, SheetContext>;
    selectedSheetId: string | null;
    onSelectSheet: (sheetId: string | null) => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    width: number;
    onWidthChange: (width: number) => void;
    projectId: string;
    /** ID of currently selected plan/PDF for processing status polling */
    selectedPlanId?: string | null;
    /** Called when a pointer is double-clicked to navigate to source file/page */
    onPointerNavigate?: (fileId: string, pageNumber: number, pointerId: string, bounds?: PointerSummaryBounds) => void;
    /** Called when user clicks "Add to Context" in Global tab to copy all files to File context */
    onAddGlobalToContext?: (files: FileSummary[]) => void;
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
        return <CheckIcon className="h-3.5 w-3.5 text-green-400" />;
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
    // Filter to only show sheets that have been explicitly added to context
    const addedSheets = sheets.filter(sheet => sheet.addedToContext);
    
    if (addedSheets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm text-center">No context files yet.</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                    Add context pointers to PDF sheets and click "Add to Context".
                </p>
            </div>
        );
    }

    return (
        <div className="p-3 space-y-1">
            {addedSheets.map((sheet) => (
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

// Image Lightbox component for viewing snapshots at full size with zoom and pan
const ImageLightbox: React.FC<{
    imageUrl: string;
    alt: string;
    onClose: () => void;
}> = ({ imageUrl, alt, onClose }) => {
    // Zoom state
    const [zoom, setZoom] = useState(1);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 4;
    const ZOOM_STEP = 0.25;

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Handle mouse wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(prev => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)));
    }, []);

    // Zoom controls
    const handleZoomIn = useCallback(() => {
        setZoom(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
    }, []);

    const handleZoomOut = useCallback(() => {
        setZoom(prev => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
    }, []);

    const handleReset = useCallback(() => {
        setZoom(1);
        setPosition({ x: 0, y: 0 });
    }, []);

    // Pan handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (zoom > 1) {
            e.preventDefault();
            setIsDragging(true);
            setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
        }
    }, [zoom, position]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isDragging && zoom > 1) {
            setPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    }, [isDragging, dragStart, zoom]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Reset position when zoom goes back to 1
    useEffect(() => {
        if (zoom <= 1) {
            setPosition({ x: 0, y: 0 });
        }
    }, [zoom]);

    return (
        <>
            <style>{`
                @keyframes lightbox-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes lightbox-scale-in {
                    from { opacity: 0; transform: scale(0.95); }
                    to { opacity: 1; transform: scale(1); }
                }
                .lightbox-backdrop {
                    animation: lightbox-fade-in 0.2s ease-out forwards;
                }
                .lightbox-image-container {
                    animation: lightbox-scale-in 0.2s ease-out forwards;
                }
            `}</style>
            <div 
                className="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
                onClick={onClose}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
            >
                {/* Zoom controls */}
                <div 
                    className="absolute top-4 left-4 flex items-center gap-2 z-10"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={handleZoomIn}
                        disabled={zoom >= MAX_ZOOM}
                        className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Zoom in"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12M6 12h12" />
                        </svg>
                    </button>
                    <button
                        onClick={handleZoomOut}
                        disabled={zoom <= MIN_ZOOM}
                        className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        aria-label="Zoom out"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12h12" />
                        </svg>
                    </button>
                    <button
                        onClick={handleReset}
                        className="px-3 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-full transition-colors text-xs font-medium"
                        aria-label="Reset zoom"
                    >
                        Reset
                    </button>
                    <span className="text-xs text-gray-400 ml-2">
                        {Math.round(zoom * 100)}%
                    </span>
                </div>

                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-full transition-colors z-10"
                    aria-label="Close lightbox"
                >
                    <CloseIcon className="w-6 h-6" />
                </button>
                
                {/* Image container */}
                <div 
                    ref={containerRef}
                    className="lightbox-image-container relative overflow-hidden"
                    style={{ 
                        maxWidth: '90vw', 
                        maxHeight: '90vh',
                        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={handleMouseDown}
                    onWheel={handleWheel}
                >
                    <img 
                        src={imageUrl} 
                        alt={alt} 
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl select-none"
                        style={{
                            transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
                            transformOrigin: 'center center',
                            transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                        }}
                        draggable={false}
                    />
                </div>
                
                {/* Hint text */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-gray-500">
                    {zoom > 1 ? 'Drag to pan • Scroll to zoom • Escape to close' : 'Scroll to zoom • Click outside or press Escape to close'}
                </div>
            </div>
        </>
    );
};

// Pointer snapshot card component for preview
const PointerSnapshotCard: React.FC<{
    pointer: SheetContext['pointers'][0];
    onImageDoubleClick?: (imageUrl: string, alt: string) => void;
}> = ({ pointer, onImageDoubleClick }) => {
    return (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            {pointer.snapshotDataUrl && (
                <div className="bg-gray-900">
                    <img 
                        src={pointer.snapshotDataUrl} 
                        alt={pointer.title || 'Context snapshot'} 
                        className="w-full h-auto object-contain max-h-48 cursor-pointer hover:opacity-90 transition-opacity"
                        onDoubleClick={() => onImageDoubleClick?.(pointer.snapshotDataUrl!, pointer.title || 'Context snapshot')}
                        title="Double-click to view full size"
                    />
                </div>
            )}
            <div className="p-3">
                <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-gray-200">
                        {pointer.title || <span className="text-gray-500 italic">Untitled</span>}
                    </h4>
                    <span className="text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                        Page {pointer.pageNumber}
                    </span>
                </div>
                {pointer.description && (
                    <p className="text-xs text-gray-400 whitespace-pre-wrap">{pointer.description}</p>
                )}
            </div>
        </div>
    );
};

// Preview view component
const PreviewView: React.FC<{
    selectedSheet: SheetContext | null;
}> = ({ selectedSheet }) => {
    // Lightbox state for viewing images at full size
    const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null);

    const handleImageDoubleClick = (imageUrl: string, alt: string) => {
        setLightboxImage({ url: imageUrl, alt });
    };

    const closeLightbox = () => {
        setLightboxImage(null);
    };

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

    // Show markdown if generated
    if (selectedSheet.markdownContent) {
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
    }

    // Show pointer snapshots if no markdown but has pointers
    if (selectedSheet.pointers.length > 0) {
        return (
            <>
                <div className="h-full overflow-auto p-4 custom-scrollbar">
                    <div className="mb-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-1">{selectedSheet.fileName}</h3>
                        <p className="text-xs text-gray-500">{selectedSheet.pointers.length} context pointer{selectedSheet.pointers.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="space-y-3">
                        {selectedSheet.pointers.map((pointer) => (
                            <PointerSnapshotCard 
                                key={pointer.id} 
                                pointer={pointer} 
                                onImageDoubleClick={handleImageDoubleClick}
                            />
                        ))}
                    </div>
                </div>
                
                {/* Lightbox overlay */}
                {lightboxImage && (
                    <ImageLightbox
                        imageUrl={lightboxImage.url}
                        alt={lightboxImage.alt}
                        onClose={closeLightbox}
                    />
                )}
            </>
        );
    }

    // No markdown and no pointers
    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
            <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm text-center">No content yet.</p>
            <p className="text-xs text-gray-600 mt-1 text-center">
                Add context pointers to this sheet.
            </p>
        </div>
    );
};

// ============================================
// Processed Batches Components
// ============================================

// Batch list item
const BatchListItem: React.FC<{
    batch: ProcessedBatchSummary;
    onClick: () => void;
}> = ({ batch, onClick }) => {
    const formattedDate = batch.processedAt 
        ? new Date(batch.processedAt).toLocaleString()
        : 'Processing...';
    
    return (
        <button
            onClick={onClick}
            className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-lg transition-all duration-150 hover:bg-gray-800/50 border border-transparent hover:border-gray-700"
        >
            <InboxIcon className={`h-4 w-4 flex-shrink-0 ${batch.hasResults ? 'text-green-400' : 'text-gray-500'}`} />
            <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-300 truncate block">{batch.batchId}</span>
                <span className="text-[10px] text-gray-500">{formattedDate}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                    {batch.sheetCount} sheets
                </span>
                <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                    {batch.pointerCount} pointers
                </span>
            </div>
        </button>
    );
};

// Processed pointer card with editable fields
const ProcessedPointerCard: React.FC<{
    pointer: ProcessedPointer;
    sheetFileName: string;
    onAnalysisEdit?: (pointerId: string, field: string, value: string) => void;
}> = ({ pointer, sheetFileName, onAnalysisEdit }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedDescription, setEditedDescription] = useState(pointer.aiAnalysis.technicalDescription);
    const [editedRecommendations, setEditedRecommendations] = useState(pointer.aiAnalysis.recommendations || '');

    const handleSave = () => {
        if (onAnalysisEdit) {
            onAnalysisEdit(pointer.id, 'technicalDescription', editedDescription);
            onAnalysisEdit(pointer.id, 'recommendations', editedRecommendations);
        }
        setIsEditing(false);
    };

    return (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
                <div>
                    <h4 className="text-sm font-medium text-gray-200">{pointer.originalMetadata.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                            Page {pointer.originalMetadata.pageNumber}
                        </span>
                        <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                            {pointer.aiAnalysis.tradeCategory}
                        </span>
                    </div>
                </div>
                <button
                    onClick={() => setIsEditing(!isEditing)}
                    className="p-1.5 hover:bg-gray-700 text-gray-400 hover:text-cyan-400 rounded transition-colors"
                    title={isEditing ? 'Cancel edit' : 'Edit analysis'}
                >
                    <PencilIcon className="w-3.5 h-3.5" />
                </button>
            </div>

            <div className="p-4 space-y-4">
                {/* Original Description */}
                <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Original Description</label>
                    <p className="text-xs text-gray-400 bg-gray-900/50 p-2 rounded">{pointer.originalMetadata.description || 'No description provided'}</p>
                </div>

                {/* AI Technical Description */}
                <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">AI Technical Description</label>
                    {isEditing ? (
                        <textarea
                            value={editedDescription}
                            onChange={(e) => setEditedDescription(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/50 resize-none"
                            rows={4}
                        />
                    ) : (
                        <p className="text-xs text-gray-300">{pointer.aiAnalysis.technicalDescription}</p>
                    )}
                </div>

                {/* Identified Elements */}
                {pointer.aiAnalysis.identifiedElements.length > 0 && (
                    <div>
                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Identified Elements</label>
                        <div className="flex flex-wrap gap-1">
                            {pointer.aiAnalysis.identifiedElements.map((el, idx) => {
                                // Handle both string elements and {symbol, meaning} objects
                                const displayText = typeof el === 'object' && el !== null && 'symbol' in el
                                    ? `${el.symbol}: ${el.meaning}`
                                    : String(el);
                                return (
                                <span key={idx} className="text-[10px] text-gray-300 bg-gray-700 px-2 py-0.5 rounded">
                                    {displayText}
                                </span>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Issues */}
                {pointer.aiAnalysis.issues && pointer.aiAnalysis.issues.length > 0 && (
                    <div>
                        <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Issues</label>
                        <div className="space-y-1">
                            {pointer.aiAnalysis.issues.map((issue, idx) => (
                                <div key={idx} className={`text-xs p-2 rounded ${
                                    issue.severity === 'critical' ? 'bg-red-500/10 text-red-400' :
                                    issue.severity === 'warning' ? 'bg-amber-500/10 text-amber-400' :
                                    'bg-blue-500/10 text-blue-400'
                                }`}>
                                    <span className="font-medium uppercase text-[10px]">{issue.severity}:</span> {issue.description}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Recommendations */}
                <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Recommendations</label>
                    {isEditing ? (
                        <textarea
                            value={editedRecommendations}
                            onChange={(e) => setEditedRecommendations(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-cyan-500/50 resize-none"
                            rows={2}
                        />
                    ) : (
                        <p className="text-xs text-gray-300">{pointer.aiAnalysis.recommendations || 'No recommendations'}</p>
                    )}
                </div>

                {/* Save button when editing */}
                {isEditing && (
                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            onClick={() => setIsEditing(false)}
                            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors"
                        >
                            Save Changes
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Batch detail view
const BatchDetailView: React.FC<{
    batch: ProcessedBatch;
    onBack: () => void;
    onCommit: () => void;
    onDiscard: () => void;
    isDiscarding: boolean;
    isCommitting?: boolean;
}> = ({ batch, onBack, onCommit, onDiscard, isDiscarding, isCommitting = false }) => {
    const totalPointers = batch.sheets.reduce((sum, s) => sum + s.pointers.length, 0);
    
    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onBack}
                        className="p-1 hover:bg-gray-800 rounded transition-colors"
                    >
                        <ArrowLeftIcon className="h-4 w-4 text-gray-400" />
                    </button>
                    <div>
                        <h3 className="text-sm font-medium text-gray-200">{batch.batchId}</h3>
                        <p className="text-[10px] text-gray-500">
                            {new Date(batch.processedAt).toLocaleString()} | {batch.sheets.length} sheets | {totalPointers} pointers
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onDiscard}
                        disabled={isDiscarding}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                    >
                        <TrashIcon className="w-3.5 h-3.5" />
                        Discard
                    </button>
                    <button
                        onClick={onCommit}
                        disabled={isCommitting}
                        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs text-white rounded transition-colors ${
                            isCommitting 
                                ? 'bg-cyan-700 cursor-not-allowed' 
                                : 'bg-cyan-600 hover:bg-cyan-500'
                        }`}
                    >
                        {isCommitting ? (
                            <>
                                <SpinnerIcon className="w-3.5 h-3.5" />
                                Committing...
                            </>
                        ) : (
                            <>
                                <DatabaseIcon className="w-3.5 h-3.5" />
                                Commit to DB
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 custom-scrollbar space-y-6">
                {batch.sheets.map((sheet) => (
                    <div key={sheet.sheetId}>
                        <div className="flex items-center gap-2 mb-3">
                            <DocumentIcon className="h-4 w-4 text-cyan-400" />
                            <h4 className="text-sm font-medium text-gray-300">{sheet.fileName}</h4>
                            <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                                {sheet.pointers.length} pointers
                            </span>
                        </div>
                        <div className="space-y-3 ml-6">
                            {sheet.pointers.map((pointer) => (
                                <ProcessedPointerCard
                                    key={pointer.id}
                                    pointer={pointer}
                                    sheetFileName={sheet.fileName}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Processed batches list view
const ProcessedBatchesView: React.FC<{ projectId: string }> = ({ projectId }) => {
    const {
        batches,
        isLoading,
        error,
        selectedBatch,
        isLoadingDetails,
        fetchBatches,
        fetchBatchDetails,
        discardBatch,
        clearSelectedBatch,
    } = useProcessedBatches();
    
    const [isDiscarding, setIsDiscarding] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [commitResult, setCommitResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        fetchBatches();
    }, [fetchBatches]);

    const handleBatchClick = async (batchId: string) => {
        await fetchBatchDetails(batchId);
    };

    const handleDiscard = async () => {
        if (!selectedBatch) return;
        setIsDiscarding(true);
        const success = await discardBatch(selectedBatch.batchId);
        if (success) {
            clearSelectedBatch();
        }
        setIsDiscarding(false);
    };

    const handleCommit = async () => {
        if (!selectedBatch) return;
        
        setIsCommitting(true);
        setCommitResult(null);
        
        try {
            // Build the commit request with full batch data
            const request: BatchCommitRequest = {
                batchId: selectedBatch.batchId,
                projectId: projectId,
                processedAt: selectedBatch.processedAt,
                sheets: selectedBatch.sheets.map(sheet => ({
                    sheetId: sheet.sheetId,
                    fileName: sheet.fileName,
                    pointers: sheet.pointers.map(pointer => ({
                        id: pointer.id,
                        originalMetadata: {
                            title: pointer.originalMetadata.title,
                            description: pointer.originalMetadata.description,
                            pageNumber: pointer.originalMetadata.pageNumber,
                        },
                        aiAnalysis: {
                            technicalDescription: pointer.aiAnalysis.technicalDescription,
                            identifiedElements: pointer.aiAnalysis.identifiedElements,
                            tradeCategory: pointer.aiAnalysis.tradeCategory,
                            measurements: pointer.aiAnalysis.measurements,
                            issues: pointer.aiAnalysis.issues,
                            recommendations: pointer.aiAnalysis.recommendations,
                        },
                    })),
                })),
            };
            
            const result = await commitBatch(request);
            setCommitResult({
                success: true,
                message: `Successfully committed ${result.pointersCreated} context pointers to database.`
            });
            // Refresh batches list and clear selection after successful commit
            await fetchBatches();
            clearSelectedBatch();
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to commit batch';
            setCommitResult({
                success: false,
                message: errorMessage
            });
        } finally {
            setIsCommitting(false);
            // Clear result message after 5 seconds
            setTimeout(() => setCommitResult(null), 5000);
        }
    };

    // Show batch detail if selected
    if (selectedBatch) {
        return (
            <>
                {/* Commit Result Toast */}
                {commitResult && (
                    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 ${
                        commitResult.success 
                            ? 'bg-green-500/90 text-white' 
                            : 'bg-red-500/90 text-white'
                    }`}>
                        {commitResult.success ? (
                            <CheckIcon className="w-5 h-5" />
                        ) : (
                            <ExclamationCircleIcon className="w-5 h-5" />
                        )}
                        <span className="text-sm">{commitResult.message}</span>
                    </div>
                )}
                <BatchDetailView
                    batch={selectedBatch}
                    onBack={clearSelectedBatch}
                    onCommit={handleCommit}
                    onDiscard={handleDiscard}
                    isDiscarding={isDiscarding}
                    isCommitting={isCommitting}
                />
            </>
        );
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <SpinnerIcon className="w-8 h-8 mb-3 text-cyan-400" />
                <p className="text-sm">Loading processed batches...</p>
            </div>
        );
    }

    // Loading details state
    if (isLoadingDetails) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <SpinnerIcon className="w-8 h-8 mb-3 text-cyan-400" />
                <p className="text-sm">Loading batch details...</p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <ExclamationCircleIcon className="w-8 h-8 mb-3 text-amber-500" />
                <p className="text-sm text-amber-400">Error loading batches</p>
                <p className="text-xs text-gray-500 mt-1">{error}</p>
                <button
                    onClick={fetchBatches}
                    className="mt-3 flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                >
                    <RefreshIcon className="w-3.5 h-3.5" />
                    Retry
                </button>
            </div>
        );
    }

    // Empty state
    if (batches.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <InboxIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm text-center">No processed batches yet.</p>
                <p className="text-xs text-gray-600 mt-1 text-center">
                    Export context pointers with "Process with AI" and wait for n8n to process them.
                </p>
                <button
                    onClick={fetchBatches}
                    className="mt-3 flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                >
                    <RefreshIcon className="w-3.5 h-3.5" />
                    Refresh
                </button>
            </div>
        );
    }

    // Batch list
    return (
        <div className="h-full flex flex-col">
            <div className="px-4 py-2 border-b border-gray-700 flex items-center justify-between">
                <span className="text-xs text-gray-500">{batches.length} batch{batches.length !== 1 ? 'es' : ''}</span>
                <button
                    onClick={fetchBatches}
                    className="p-1 hover:bg-gray-800 rounded transition-colors"
                    title="Refresh"
                >
                    <RefreshIcon className="w-3.5 h-3.5 text-gray-400" />
                </button>
            </div>
            <div className="flex-1 overflow-auto p-3 custom-scrollbar space-y-1">
                {batches.map((batch) => (
                    <BatchListItem
                        key={batch.batchId}
                        batch={batch}
                        onClick={() => handleBatchClick(batch.batchId)}
                    />
                ))}
            </div>
        </div>
    );
};

// ============================================
// Main ContextPanel Component
// ============================================

export const ContextPanel: React.FC<ContextPanelProps> = ({
    sheetContexts,
    selectedSheetId,
    onSelectSheet,
    isCollapsed,
    onToggleCollapse,
    width,
    onWidthChange,
    projectId,
    selectedPlanId,
    onPointerNavigate,
    onAddGlobalToContext,
}) => {
    const [isResizing, setIsResizing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('pointers');
    const [exportSuccess, setExportSuccess] = useState<string | null>(null);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [contextPreview, setContextPreview] = useState<ContextPreviewResponse | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [commitSuccess, setCommitSuccess] = useState<{ pages: number; pointers: number } | null>(null);
    
    // Project-wide commit preview state
    const [showProjectPreviewModal, setShowProjectPreviewModal] = useState(false);
    const [projectPreview, setProjectPreview] = useState<ProjectCommitPreviewResponse | null>(null);
    const [isLoadingProjectPreview, setIsLoadingProjectPreview] = useState(false);
    const [projectPreviewError, setProjectPreviewError] = useState<string | null>(null);
    
    // Clear all annotations state
    const [showClearAnnotationsConfirm, setShowClearAnnotationsConfirm] = useState(false);
    const [isClearingAnnotations, setIsClearingAnnotations] = useState(false);
    const [clearAnnotationsError, setClearAnnotationsError] = useState<string | null>(null);
    
    // Lightbox state for viewing crop images at full size
    const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null);
    
    // Pointers view state - for expanded items in the list
    const [expandedPointerIds, setExpandedPointerIds] = useState<Set<string>>(new Set());
    
    const { isExporting, error: exportError, exportBatch } = useN8NExport();
    
    // AI streaming processing hook
    const {
        isProcessing: aiIsProcessing,
        progress: aiProgress,
        processedPointers,
        error: aiError,
        processWithAI,
        cancelProcessing,
        reset: resetAIProcessing,
        loadPersistedPointers,
    } = useAIProcessing();
    
    // Global project context hook
    const {
        contextData,
        isLoading: isLoadingContext,
        error: contextError,
        selection: globalSelection,
        selectedFile,
        selectedPage,
        selectedPointer,
        fetchContext,
        selectFile,
        selectPage,
        selectPointer,
        expandedFiles,
        expandedPages,
        toggleFileExpand,
        togglePageExpand,
        expandAll,
        collapseAll,
    } = useProjectContext(projectId);

    // Build pointer lookup map for PagesTab (includes bounds for snap-to-bbox feature)
    const pointerLookup = useMemo(() => {
        const map = new Map<string, { title: string; description: string | null; bounds?: { xNorm: number; yNorm: number; wNorm: number; hNorm: number } }>();
        if (!contextData) return map;
        for (const file of contextData.files) {
            for (const page of file.pages) {
                for (const pointer of page.pointers) {
                    map.set(pointer.id, {
                        title: pointer.title,
                        description: pointer.description,
                        bounds: pointer.bounds,
                    });
                }
            }
        }
        return map;
    }, [contextData]);

    // Processing status polling
    const { 
        status: processingStatus, 
        isProcessing, 
        isComplete: processingComplete,
        hasErrors: processingHasErrors,
        startPolling,
        refresh: refreshStatus
    } = useProcessingStatus({ 
        planId: selectedPlanId ?? null,
        autoStart: false 
    });
    
    // Auto-fetch project preview when switching to pointers view
    useEffect(() => {
        if (viewMode === 'pointers' && projectId && !projectPreview && !isLoadingProjectPreview) {
            setIsLoadingProjectPreview(true);
            fetchProjectCommitPreview(projectId)
                .then(data => {
                    setProjectPreview(data);
                    setProjectPreviewError(null);
                })
                .catch(err => {
                    setProjectPreviewError(err instanceof Error ? err.message : 'Failed to load pointers');
                })
                .finally(() => {
                    setIsLoadingProjectPreview(false);
                });
        }
    }, [viewMode, projectId, projectPreview, isLoadingProjectPreview]);
    
    // Toggle pointer expansion in Pointers view
    const togglePointerExpand = useCallback((pointerId: string) => {
        setExpandedPointerIds(prev => {
            const next = new Set(prev);
            if (next.has(pointerId)) {
                next.delete(pointerId);
            } else {
                next.add(pointerId);
            }
            return next;
        });
    }, []);
    
    // Refresh pointers data
    const refreshPointersData = useCallback(async () => {
        if (!projectId) return;
        setIsLoadingProjectPreview(true);
        try {
            const data = await fetchProjectCommitPreview(projectId);
            setProjectPreview(data);
            setProjectPreviewError(null);
        } catch (err) {
            setProjectPreviewError(err instanceof Error ? err.message : 'Failed to load pointers');
        } finally {
            setIsLoadingProjectPreview(false);
        }
    }, [projectId]);

    // Sort sheets alphabetically by fileName
    const sortedSheets = useMemo(() => {
        return Object.values(sheetContexts)
            .sort((a, b) => a.fileName.localeCompare(b.fileName));
    }, [sheetContexts]);

    // Get selected sheet
    const selectedSheet = selectedSheetId ? sheetContexts[selectedSheetId] : null;

    // Count stats - only for sheets added to context
    const stats = useMemo(() => {
        const sheets = Object.values(sheetContexts).filter(s => s.addedToContext);
        return {
            total: sheets.length,
            withPointers: sheets.filter(s => s.pointers.length > 0).length,
            complete: sheets.filter(s => s.generationStatus === 'complete').length,
            totalPointers: sheets.reduce((sum, s) => sum + s.pointers.length, 0),
        };
    }, [sheetContexts]);

    // Handle export (legacy n8n)
    const handleExport = async () => {
        setExportSuccess(null);
        const result = await exportBatch(sheetContexts);
        if (result?.success) {
            setExportSuccess(result.batchId);
            // Clear success message after 5 seconds
            setTimeout(() => setExportSuccess(null), 5000);
        }
    };

    // Handle AI processing with streaming
    const handleProcessWithAI = useCallback(async () => {
        // #region agent log
        const addedSheets = Object.values(sheetContexts).filter(sc => sc.addedToContext && sc.pointers.length > 0);
        const firstPointer = addedSheets[0]?.pointers[0];
        fetch('http://127.0.0.1:7243/ingest/6d569bee-72b8-4760-bb05-e3f164c6af6f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ContextPanel.tsx:handleProcessWithAI:entry',message:'Handler called - checking snapshotDataUrl',data:{sheetCount:addedSheets.length,firstPointerTitle:firstPointer?.title,hasSnapshotDataUrl:!!firstPointer?.snapshotDataUrl,snapshotDataUrlLength:firstPointer?.snapshotDataUrl?.length || 0,snapshotDataUrlPrefix:firstPointer?.snapshotDataUrl?.substring(0,50)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8'})}).catch(()=>{});
        // #endregion
        const sheetsToProcess = Object.values(sheetContexts)
            .filter(sc => sc.addedToContext && sc.pointers.length > 0)
            .map(sc => ({
                sheetId: sc.fileId,
                fileName: sc.fileName,
                pointers: sc.pointers.map(p => {
                    const stripped = stripBase64Prefix(p.snapshotDataUrl || '');
                    // #region agent log
                    if (p === sc.pointers[0]) {
                        fetch('http://127.0.0.1:7243/ingest/6d569bee-72b8-4760-bb05-e3f164c6af6f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ContextPanel.tsx:handleProcessWithAI:pointerMap',message:'Pointer transformation',data:{pointerId:p.id,originalLength:p.snapshotDataUrl?.length||0,strippedLength:stripped.length,strippedPrefix:stripped.substring(0,30)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H8'})}).catch(()=>{});
                    }
                    // #endregion
                    return {
                        id: p.id,
                        imageBase64: stripped,
                        title: p.title || '',
                        description: p.description || '',
                        pageNumber: p.pageNumber,
                        sourceFile: sc.fileName,
                        boundingBox: p.bounds,
                    };
                }),
            }));

        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/6d569bee-72b8-4760-bb05-e3f164c6af6f',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'ContextPanel.tsx:handleProcessWithAI:afterMap',message:'Sheets prepared',data:{sheetsToProcessCount:sheetsToProcess.length,totalPointers:sheetsToProcess.reduce((s,sh)=>s+sh.pointers.length,0)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
        // #endregion

        if (sheetsToProcess.length === 0) return;
        await processWithAI(`batch_${Date.now()}`, sheetsToProcess);
    }, [sheetContexts, processWithAI]);
    
    // Handle loading context preview (file-specific)
    const handleLoadContextPreview = async () => {
        if (!selectedPlanId) return;
        
        // Show warning if still processing
        if (isProcessing) {
            const proceed = window.confirm(
                'Processing is still in progress. Some pages may not have complete context yet. Continue anyway?'
            );
            if (!proceed) return;
        }
        
        setIsLoadingPreview(true);
        setPreviewError(null);
        
        try {
            const preview = await fetchContextPreview(selectedPlanId);
            setContextPreview(preview);
            setShowPreviewModal(true);
        } catch (err) {
            setPreviewError(err instanceof Error ? err.message : 'Failed to load context preview');
        } finally {
            setIsLoadingPreview(false);
        }
    };
    
    // Handle loading project-wide commit preview (all pointers with AI analysis)
    const handleLoadProjectPreview = async () => {
        if (!projectId) return;
        
        setIsLoadingProjectPreview(true);
        setProjectPreviewError(null);
        
        try {
            const preview = await fetchProjectCommitPreview(projectId);
            setProjectPreview(preview);
            setShowProjectPreviewModal(true);
        } catch (err) {
            setProjectPreviewError(err instanceof Error ? err.message : 'Failed to load project preview');
        } finally {
            setIsLoadingProjectPreview(false);
        }
    };

    // Handle clearing all annotations from DB
    const handleConfirmClearAnnotations = async () => {
        setShowClearAnnotationsConfirm(false);
        setIsClearingAnnotations(true);
        setClearAnnotationsError(null);

        try {
            await deleteAllProjectPointers(projectId);
            // Refresh context data to show empty state
            fetchContext();
            // Also reset processed pointers local state
            resetAIProcessing();
        } catch (err) {
            setClearAnnotationsError(err instanceof Error ? err.message : 'Failed to clear annotations');
        } finally {
            setIsClearingAnnotations(false);
        }
    };

    // Handle continue processing unprocessed pointers from project preview modal
    const handleContinueProcessing = useCallback(async () => {
        if (!projectPreview) return;
        
        // Close modal
        setShowProjectPreviewModal(false);
        setProjectPreview(null);
        
        // Build sheets with only unprocessed pointers
        const sheetsToProcess = projectPreview.files
            .filter(file => file.pointers.some(p => !p.aiAnalysis))
            .map(file => ({
                sheetId: file.id,
                fileName: file.name,
                pointers: file.pointers
                    .filter(p => !p.aiAnalysis)
                    .map(p => ({
                        id: p.id,
                        imageBase64: '', // Backend will render from PDF using crop image
                        title: p.title,
                        description: p.description || '',
                        pageNumber: p.pageNumber,
                        sourceFile: file.name,
                        boundingBox: p.bounds ? {
                            x: p.bounds.xNorm,
                            y: p.bounds.yNorm,
                            width: p.bounds.wNorm,
                            height: p.bounds.hNorm,
                        } : undefined,
                    })),
            }))
            .filter(sheet => sheet.pointers.length > 0);
        
        if (sheetsToProcess.length > 0) {
            await processWithAI(`batch_${Date.now()}`, sheetsToProcess);
        }
    }, [projectPreview, processWithAI]);

    // Handle resize
    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);

        const handleMouseMove = (e: MouseEvent) => {
            // Calculate new width from the left edge of the panel
            const newWidth = window.innerWidth - e.clientX;
            // Constrain between 300px and 600px
            const constrainedWidth = Math.max(300, Math.min(newWidth, 800));
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
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-gray-200">Context Files</h2>
                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('pointers')}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                viewMode === 'pointers'
                                    ? 'bg-gray-700 text-cyan-400'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                            title="View by pointers"
                        >
                            Pointers
                        </button>
                        <button
                            onClick={() => setViewMode('pages')}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                viewMode === 'pages'
                                    ? 'bg-gray-700 text-cyan-400'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                            title="View by pages"
                        >
                            Pages
                        </button>
                        <button
                            onClick={() => setViewMode('disciplines')}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                viewMode === 'disciplines'
                                    ? 'bg-gray-700 text-cyan-400'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                            title="View by disciplines"
                        >
                            Disciplines
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
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

            {/* Export Success/Error Toast */}
            {exportSuccess && (
                <div className="mx-4 mt-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center gap-2">
                    <CheckIcon className="w-4 h-4 text-green-400" />
                    <span className="text-xs text-green-400">Exported batch: {exportSuccess}</span>
                </div>
            )}
            {exportError && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                    <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-400">{exportError}</span>
                </div>
            )}
            
            
            {/* Preview Error Toast */}
            {previewError && (
                <div className="mx-4 mt-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                    <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                    <span className="text-xs text-red-400">{previewError}</span>
                    <button 
                        onClick={() => setPreviewError(null)} 
                        className="ml-auto text-red-400 hover:text-red-300"
                    >
                        <CloseIcon className="w-3 h-3" />
                    </button>
                </div>
            )}

            {/* Content Area */}
            {viewMode === 'pointers' ? (
                /* Pointers View - All project pointers with full details */
                <div className="flex flex-col h-full min-h-0">
                    <div className="flex-none px-4 py-3 border-b border-gray-700">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium text-gray-200">Pointers</h3>
                            <div className="flex items-center gap-2">
                                {projectPreview && (
                                    <span className="text-xs text-gray-500">
                                        {projectPreview.summary.totalPointers} total
                                        {projectPreview.summary.pointersWithAi > 0 && (
                                            <span className="ml-1 text-cyan-400">
                                                ({projectPreview.summary.pointersWithAi} with AI)
                                            </span>
                                        )}
                                    </span>
                                )}
                                <button
                                    onClick={refreshPointersData}
                                    disabled={isLoadingProjectPreview}
                                    className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
                                    title="Refresh"
                                >
                                    <RefreshIcon className={`w-3.5 h-3.5 ${isLoadingProjectPreview ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-8 custom-scrollbar min-h-0">
                        {isLoadingProjectPreview && !projectPreview ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <SpinnerIcon className="w-8 h-8 mb-3 text-cyan-400" />
                                <p className="text-sm">Loading pointers...</p>
                            </div>
                        ) : projectPreviewError && !projectPreview ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                                <ExclamationCircleIcon className="w-8 h-8 mb-3 text-amber-500" />
                                <p className="text-sm text-amber-400">{projectPreviewError}</p>
                                <button
                                    onClick={refreshPointersData}
                                    className="mt-3 px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : !projectPreview || projectPreview.summary.totalPointers === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <DocumentIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                <p>No pointers yet</p>
                                <p className="text-sm mt-1 text-gray-600">
                                    Create context pointers on PDF pages to see them here.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4 pb-4">
                                {projectPreview.files
                                    .filter(file => file.pointerCount > 0)
                                    .map(file => (
                                        <div key={file.id} className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/30">
                                            {/* File header */}
                                            <button
                                                onClick={() => toggleFileExpand(file.id)}
                                                className="w-full px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center gap-2 hover:bg-gray-750 transition-colors"
                                            >
                                                <ChevronDownIcon className={`w-4 h-4 text-gray-500 transition-transform ${expandedFiles.has(file.id) ? '' : '-rotate-90'}`} />
                                                <DocumentIcon className="w-4 h-4 text-cyan-400" />
                                                <h4 className="font-medium text-sm text-gray-200 flex-1 text-left truncate">{file.name}</h4>
                                                <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                                                    {file.pointerCount} pointer{file.pointerCount !== 1 ? 's' : ''}
                                                </span>
                                                {file.pointersWithAi > 0 && (
                                                    <span className="text-xs text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                                                        {file.pointersWithAi} AI
                                                    </span>
                                                )}
                                            </button>

                                            {/* Pointers list */}
                                            {expandedFiles.has(file.id) && (
                                                <div className="divide-y divide-gray-700/50">
                                                    {file.pointers.map(pointer => (
                                                        <div key={pointer.id} className="bg-gray-900/30">
                                                            {/* Pointer header - clickable to expand */}
                                                            <button
                                                                onClick={() => togglePointerExpand(pointer.id)}
                                                                className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-800/50 text-left transition-colors"
                                                            >
                                                                <ChevronDownIcon className={`w-4 h-4 text-gray-500 transition-transform mt-0.5 flex-shrink-0 ${expandedPointerIds.has(pointer.id) ? '' : '-rotate-90'}`} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="font-medium text-sm text-gray-200 truncate">
                                                                            {pointer.title}
                                                                        </p>
                                                                        {pointer.aiAnalysis?.tradeCategory && (
                                                                            <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded flex-shrink-0">
                                                                                {pointer.aiAnalysis.tradeCategory}
                                                                            </span>
                                                                        )}
                                                                        {pointer.committedAt && (
                                                                            <CheckIcon className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                                                        )}
                                                                    </div>
                                                                    <p className="text-xs text-gray-500 mt-0.5">
                                                                        Page {pointer.pageNumber}
                                                                        {pointer.description && (
                                                                            <span className="ml-2 text-gray-400">• {pointer.description}</span>
                                                                        )}
                                                                    </p>
                                                                </div>
                                                            </button>

                                                            {/* Expanded pointer details */}
                                                            {expandedPointerIds.has(pointer.id) && (
                                                                <div className="px-4 py-4 bg-gray-800/50 border-t border-gray-700/50 space-y-4">
                                                                    {/* Crop Image */}
                                                                    <div>
                                                                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                                                            Crop Image (AI Input)
                                                                        </p>
                                                                        <div 
                                                                            className="bg-gray-900 rounded-lg p-2 border border-gray-700 cursor-pointer hover:border-gray-600 transition-colors"
                                                                            onDoubleClick={() => setLightboxImage({ 
                                                                                url: getPointerCropImageUrl(pointer.id), 
                                                                                alt: pointer.title || 'Pointer crop' 
                                                                            })}
                                                                            title="Double-click to view full size"
                                                                        >
                                                                            <img 
                                                                                src={getPointerCropImageUrl(pointer.id)}
                                                                                alt="Pointer crop"
                                                                                className="max-h-48 object-contain rounded"
                                                                                onError={(e) => {
                                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </div>

                                                                    {/* AI Analysis Section */}
                                                                    {pointer.aiAnalysis ? (
                                                                        <>
                                                                            {/* Technical Description */}
                                                                            {pointer.aiAnalysis.technicalDescription && (
                                                                                <div>
                                                                                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                                        Technical Description
                                                                                    </p>
                                                                                    <p className="text-sm text-gray-300">
                                                                                        {pointer.aiAnalysis.technicalDescription}
                                                                                    </p>
                                                                                </div>
                                                                            )}

                                                                            {/* Trade Category */}
                                                                            {pointer.aiAnalysis.tradeCategory && (
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-[10px] font-semibold text-gray-500 uppercase">Trade:</span>
                                                                                    <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs font-medium rounded">
                                                                                        {pointer.aiAnalysis.tradeCategory}
                                                                                    </span>
                                                                                </div>
                                                                            )}

                                                                            {/* Identified Elements */}
                                                                            {pointer.aiAnalysis.identifiedElements && pointer.aiAnalysis.identifiedElements.length > 0 && (
                                                                                <div>
                                                                                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                                        Identified Elements
                                                                                    </p>
                                                                                    <div className="flex flex-wrap gap-1">
                                                                                        {pointer.aiAnalysis.identifiedElements.map((el, i) => (
                                                                                            <span key={i} className="px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-300">
                                                                                                {typeof el === 'string' ? el : el.name}
                                                                                            </span>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            {/* Recommendations */}
                                                                            {pointer.aiAnalysis.recommendations && (
                                                                                <div>
                                                                                    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                                        Recommendations
                                                                                    </p>
                                                                                    <p className="text-sm text-gray-300">
                                                                                        {pointer.aiAnalysis.recommendations}
                                                                                    </p>
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        <div className="text-center py-4 text-gray-500">
                                                                            <p className="text-sm">No AI analysis yet</p>
                                                                            <p className="text-xs mt-1 text-gray-600">
                                                                                Process this pointer with AI to see analysis.
                                                                            </p>
                                                                        </div>
                                                                    )}

                                                                    {/* Original Metadata */}
                                                                    {pointer.description && (
                                                                        <div>
                                                                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                                Original Description
                                                                            </p>
                                                                            <p className="text-sm text-gray-400">
                                                                                {pointer.description}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : viewMode === 'pages' ? (
                /* Pages View - Context Tree Processing */
                <div className="flex flex-col flex-1 min-h-0">
                    <PagesTab projectId={projectId} pointerLookup={pointerLookup} />
                </div>
            ) : (
                /* Disciplines View - Context Tree Processing */
                <div className="flex flex-col flex-1 min-h-0">
                    <DisciplinesTab projectId={projectId} />
                </div>
            )}
            
            {/* Context Preview Modal (file-specific) */}
            {showPreviewModal && contextPreview && (
                <ContextPreviewModal
                    preview={contextPreview}
                    onClose={() => {
                        setShowPreviewModal(false);
                        setContextPreview(null);
                    }}
                    onCommitSuccess={(result) => {
                        setCommitSuccess({ pages: result.pagesCommitted, pointers: result.pointersCommitted });
                        // Refresh processing status after commit
                        refreshStatus();
                        // Clear success message after 5 seconds
                        setTimeout(() => setCommitSuccess(null), 5000);
                    }}
                />
            )}
            
            {/* Project Commit Preview Modal (all pointers with AI analysis) */}
            {showProjectPreviewModal && projectPreview && (
                <ProjectCommitPreviewModal
                    preview={projectPreview}
                    onClose={() => {
                        setShowProjectPreviewModal(false);
                        setProjectPreview(null);
                    }}
                    onCommitSuccess={(result) => {
                        setCommitSuccess({ pages: result.pagesCommitted, pointers: result.pointersCommitted });
                        // Refresh context data after commit
                        fetchContext();
                        // Clear success message after 5 seconds
                        setTimeout(() => setCommitSuccess(null), 5000);
                    }}
                    onContinueProcessing={handleContinueProcessing}
                    onPreviewRefresh={handleLoadProjectPreview}
                />
            )}
            
            {/* Commit Success Toast - Fixed position */}
            {commitSuccess && (
                <div className="fixed top-4 right-4 z-[100] px-4 py-3 bg-green-500/90 text-white rounded-lg shadow-lg flex items-center gap-2 animate-fade-in">
                    <CheckIcon className="w-5 h-5" />
                    <span className="text-sm">
                        Successfully committed {commitSuccess.pages} pages + {commitSuccess.pointers} pointers
                    </span>
                    <button
                        onClick={() => setCommitSuccess(null)}
                        className="ml-2 text-white/80 hover:text-white"
                    >
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Clear Annotations Error Toast */}
            {clearAnnotationsError && (
                <div className="fixed top-4 right-4 z-[100] px-4 py-3 bg-red-500/90 text-white rounded-lg shadow-lg flex items-center gap-2">
                    <ExclamationCircleIcon className="w-5 h-5" />
                    <span className="text-sm">{clearAnnotationsError}</span>
                    <button
                        onClick={() => setClearAnnotationsError(null)}
                        className="ml-2 text-white/80 hover:text-white"
                    >
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* Clear All Annotations Confirmation Dialog */}
            {showClearAnnotationsConfirm && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowClearAnnotationsConfirm(false)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                                <ExclamationCircleIcon className="w-5 h-5 text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200">Clear All Annotations</h3>
                        </div>
                        <p className="text-gray-400 mb-4">
                            This will permanently delete all <strong className="text-white">{contextData?.totalPointers || 0} context pointers</strong> from the database.
                        </p>
                        <p className="text-sm text-red-400/80 mb-6">
                            This action cannot be undone. You will need to recreate all annotations from scratch.
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowClearAnnotationsConfirm(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmClearAnnotations}
                                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                            >
                                Yes, Delete All
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Image Lightbox for crop images */}
            {lightboxImage && (
                <ImageLightbox
                    imageUrl={lightboxImage.url}
                    alt={lightboxImage.alt}
                    onClose={() => setLightboxImage(null)}
                />
            )}
        </div>
    );
};

// ============================================
// Project Commit Preview Modal Component
// ============================================

const ProjectCommitPreviewModal: React.FC<{
    preview: ProjectCommitPreviewResponse;
    onClose: () => void;
    onCommitSuccess?: (result: ContextCommitResponse) => void;
    onContinueProcessing?: () => void;
    onPreviewRefresh?: () => void;
}> = ({ preview, onClose, onCommitSuccess, onContinueProcessing, onPreviewRefresh }) => {
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
    const [expandedPointers, setExpandedPointers] = useState<Set<string>>(new Set());
    const [isCommitting, setIsCommitting] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    const [commitResult, setCommitResult] = useState<ContextCommitResponse | null>(null);
    const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null);
    // Un-commit state
    const [isUncommitting, setIsUncommitting] = useState(false);
    const [showUncommitConfirm, setShowUncommitConfirm] = useState(false);
    const [uncommitError, setUncommitError] = useState<string | null>(null);

    // Close on Escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !showConfirmDialog) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, showConfirmDialog]);

    const toggleFile = (fileId: string) => {
        setExpandedFiles(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) {
                next.delete(fileId);
            } else {
                next.add(fileId);
            }
            return next;
        });
    };

    const togglePointer = (pointerId: string) => {
        setExpandedPointers(prev => {
            const next = new Set(prev);
            if (next.has(pointerId)) {
                next.delete(pointerId);
            } else {
                next.add(pointerId);
            }
            return next;
        });
    };

    const expandAllFiles = () => {
        setExpandedFiles(new Set(preview.files.map(f => f.id)));
    };

    const collapseAllFiles = () => {
        setExpandedFiles(new Set());
        setExpandedPointers(new Set());
    };

    const handleCommitClick = () => {
        setShowConfirmDialog(true);
    };

    const handleConfirmCommit = async () => {
        setShowConfirmDialog(false);
        setIsCommitting(true);
        setCommitError(null);

        try {
            const result = await commitProjectContext(preview.projectId);
            setCommitResult(result);
            onCommitSuccess?.(result);
        } catch (err) {
            setCommitError(err instanceof Error ? err.message : 'Failed to commit context');
        } finally {
            setIsCommitting(false);
        }
    };

    const handleConfirmUncommit = async () => {
        setShowUncommitConfirm(false);
        setIsUncommitting(true);
        setUncommitError(null);

        try {
            await uncommitProjectPointers(preview.projectId);
            // Refresh the preview to show updated counts
            onPreviewRefresh?.();
        } catch (err) {
            setUncommitError(err instanceof Error ? err.message : 'Failed to un-commit pointers');
        } finally {
            setIsUncommitting(false);
        }
    };

    return (
        <>
            <style>{`
                @keyframes modal-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes modal-slide-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .modal-backdrop {
                    animation: modal-fade-in 0.2s ease-out forwards;
                }
                .modal-content {
                    animation: modal-slide-in 0.2s ease-out forwards;
                }
            `}</style>
            <div 
                className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
                onClick={onClose}
            >
                <div 
                    className="modal-content bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col"
                    style={{ width: '90vw', maxWidth: '1400px', height: '85vh' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Modal Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-200">Commit to ViewM4D</h2>
                            <p className="text-sm text-gray-500 mt-0.5">{preview.projectName} - All Context Pointers</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
                            aria-label="Close modal"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Summary Bar */}
                    <div className="px-6 py-4 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-8">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-gray-200">{preview.summary.totalFiles}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Files</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-cyan-400">{preview.summary.totalPointers}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pointers</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-green-400">{preview.summary.pointersWithAi}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">With AI</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-amber-400">{preview.summary.pointersCommitted}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Already Committed</div>
                                {preview.summary.pointersCommitted > 0 && (
                                    <button
                                        onClick={() => setShowUncommitConfirm(true)}
                                        disabled={isUncommitting}
                                        className="mt-1 px-2 py-0.5 text-[10px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30 rounded transition-colors disabled:opacity-50"
                                    >
                                        {isUncommitting ? 'Resetting...' : 'Un-commit All'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={expandAllFiles}
                                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                            >
                                Expand All
                            </button>
                            <button
                                onClick={collapseAllFiles}
                                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                            >
                                Collapse All
                            </button>
                        </div>
                    </div>

                    {/* Un-commit Error Toast */}
                    {uncommitError && (
                        <div className="mx-6 my-2 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
                            <ExclamationCircleIcon className="w-4 h-4 text-red-400" />
                            <span className="text-xs text-red-400">{uncommitError}</span>
                            <button 
                                onClick={() => setUncommitError(null)} 
                                className="ml-auto text-red-400 hover:text-red-300"
                            >
                                <CloseIcon className="w-3 h-3" />
                            </button>
                        </div>
                    )}

                    {/* Content Area */}
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        {commitResult ? (
                            // Success state
                            <div className="flex flex-col items-center justify-center h-full p-8">
                                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                                    <CheckIcon className="w-8 h-8 text-green-400" />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-200 mb-2">Successfully Committed</h3>
                                <p className="text-gray-400 text-center mb-6">
                                    {commitResult.pointersCommitted} context pointers are now available<br />
                                    to the ViewM4D Grok agent for queries.
                                </p>
                                {commitResult.warnings.length > 0 && (
                                    <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg max-w-md">
                                        <p className="text-sm text-amber-400 font-medium mb-2">Warnings:</p>
                                        {commitResult.warnings.map((warning, i) => (
                                            <p key={i} className="text-xs text-amber-300">{warning}</p>
                                        ))}
                                    </div>
                                )}
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        ) : commitError ? (
                            // Error state
                            <div className="flex flex-col items-center justify-center h-full p-8">
                                <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                                    <ExclamationCircleIcon className="w-8 h-8 text-red-400" />
                                </div>
                                <h3 className="text-xl font-semibold text-gray-200 mb-2">Commit Failed</h3>
                                <p className="text-red-400 text-center mb-6">{commitError}</p>
                                <button
                                    onClick={() => setCommitError(null)}
                                    className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                >
                                    Try Again
                                </button>
                            </div>
                        ) : (
                            // Preview state - Show all files and pointers
                            <div className="divide-y divide-gray-700/50">
                                {preview.files.map(file => (
                                    <div key={file.id}>
                                        {/* File Header */}
                                        <button
                                            onClick={() => toggleFile(file.id)}
                                            className="w-full px-6 py-4 flex items-center gap-3 hover:bg-gray-800/40 transition-colors text-left"
                                        >
                                            <ChevronDownIcon 
                                                className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${
                                                    expandedFiles.has(file.id) ? '' : '-rotate-90'
                                                }`} 
                                            />
                                            <FolderIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                                            <span className="text-sm font-medium text-gray-200 flex-1 truncate">
                                                {file.name}
                                            </span>
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <span className="text-xs text-gray-500">
                                                    {file.pointerCount} pointer{file.pointerCount !== 1 ? 's' : ''}
                                                </span>
                                                {file.pointersWithAi > 0 && (
                                                    <span className="text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                                                        {file.pointersWithAi} with AI
                                                    </span>
                                                )}
                                            </div>
                                        </button>

                                        {/* File Content - Pointers */}
                                        {expandedFiles.has(file.id) && (
                                            <div className="px-6 pb-4 pl-14 space-y-3">
                                                {file.pointers.map(pointer => (
                                                    <div 
                                                        key={pointer.id}
                                                        className={`bg-gray-800/50 rounded-lg overflow-hidden border ${
                                                            !pointer.aiAnalysis ? 'opacity-50 border-dashed border-gray-600' : 'border-cyan-500/50'
                                                        }`}
                                                    >
                                                        {/* Crop Image Preview - Large, above text */}
                                                        <div 
                                                            className="w-full cursor-pointer hover:opacity-90 transition-opacity"
                                                            onDoubleClick={() => setLightboxImage({ 
                                                                url: getPointerCropImageUrl(pointer.id), 
                                                                alt: pointer.title || 'Pointer crop' 
                                                            })}
                                                            title="Double-click to view full size"
                                                        >
                                                            <img 
                                                                src={getPointerCropImageUrl(pointer.id)}
                                                                alt="Pointer crop"
                                                                className="h-40 object-contain object-left"
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                                                                }}
                                                            />
                                                        </div>
                                                        {/* Pointer Header */}
                                                        <button
                                                            onClick={() => togglePointer(pointer.id)}
                                                            className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-700/30 transition-colors text-left"
                                                        >
                                                            <ChevronDownIcon 
                                                                className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 mt-1 ${
                                                                    expandedPointers.has(pointer.id) ? '' : '-rotate-90'
                                                                }`} 
                                                            />
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex items-center gap-2 mb-1">
                                                                    <span className="text-base font-medium text-gray-200">{pointer.title}</span>
                                                                    <span className="text-xs text-gray-500">Page {pointer.pageNumber}</span>
                                                                </div>
                                                                {pointer.description && (
                                                                    <p className="text-sm text-gray-400 line-clamp-2">
                                                                        {pointer.description}
                                                                    </p>
                                                                )}
                                                                {/* Quick AI badges */}
                                                                {pointer.aiAnalysis ? (
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        {pointer.aiAnalysis.tradeCategory && (
                                                                            <span className="text-xs px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded">
                                                                                {pointer.aiAnalysis.tradeCategory}
                                                                            </span>
                                                                        )}
                                                                        {pointer.committedAt && (
                                                                            <span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-400 rounded">
                                                                                Committed
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        <span className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded border border-amber-500/30">
                                                                            Not AI Processed
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </button>

                                                        {/* Expanded Pointer Details */}
                                                        {expandedPointers.has(pointer.id) && pointer.aiAnalysis && (
                                                            <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-700/50 space-y-3">
                                                                {/* Technical Description */}
                                                                {pointer.aiAnalysis.technicalDescription && (
                                                                    <div>
                                                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                            AI Analysis
                                                                        </p>
                                                                        <p className="text-base text-gray-300">
                                                                            {pointer.aiAnalysis.technicalDescription}
                                                                        </p>
                                                                    </div>
                                                                )}

                                                                {/* Trade Category */}
                                                                {pointer.aiAnalysis.tradeCategory && (
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-xs font-semibold text-gray-500 uppercase">Trade:</span>
                                                                        <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-sm font-medium rounded">
                                                                            {pointer.aiAnalysis.tradeCategory}
                                                                        </span>
                                                                    </div>
                                                                )}

                                                                {/* Identified Elements */}
                                                                {pointer.aiAnalysis.identifiedElements && pointer.aiAnalysis.identifiedElements.length > 0 && (
                                                                    <div>
                                                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                            Elements
                                                                        </p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {pointer.aiAnalysis.identifiedElements.map((el, i) => (
                                                                                <span key={i} className="px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-300">
                                                                                    {typeof el === 'string' ? el : (el as any).name || JSON.stringify(el)}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Recommendations */}
                                                                {pointer.aiAnalysis.recommendations && (
                                                                    <div>
                                                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                                                            Recommendations
                                                                        </p>
                                                                        <p className="text-sm text-gray-400 bg-gray-800/50 rounded p-2">
                                                                            {pointer.aiAnalysis.recommendations}
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {!commitResult && !commitError && (
                        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between flex-shrink-0 bg-gray-800/30">
                            <div className="text-xs text-gray-500">
                                {preview.summary.totalPointers - preview.summary.pointersWithAi > 0 && (
                                    <span className="text-amber-400">
                                        {preview.summary.totalPointers - preview.summary.pointersWithAi} pointers without AI analysis
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                {/* Continue Processing button - only show if there are unprocessed pointers */}
                                {preview.summary.totalPointers - preview.summary.pointersWithAi > 0 && onContinueProcessing && (
                                    <button
                                        onClick={onContinueProcessing}
                                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
                                    >
                                        <SpinnerIcon className="w-4 h-4" />
                                        Continue Processing
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCommitClick}
                                    disabled={isCommitting || (preview.summary.pointersWithAi - preview.summary.pointersCommitted) === 0}
                                    className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                                        isCommitting || (preview.summary.pointersWithAi - preview.summary.pointersCommitted) === 0
                                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                            : 'bg-green-600 hover:bg-green-500 text-white'
                                    }`}
                                >
                                    {isCommitting ? (
                                        <>
                                            <SpinnerIcon className="w-4 h-4" />
                                            Committing...
                                        </>
                                    ) : (
                                        <>
                                            <DatabaseIcon className="w-4 h-4" />
                                            Commit {preview.summary.pointersWithAi - preview.summary.pointersCommitted} Pointers
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Image Lightbox */}
            {lightboxImage && (
                <ImageLightbox
                    imageUrl={lightboxImage.url}
                    alt={lightboxImage.alt}
                    onClose={() => setLightboxImage(null)}
                />
            )}

            {/* Confirmation Dialog */}
            {showConfirmDialog && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowConfirmDialog(false)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <ExclamationCircleIcon className="w-5 h-5 text-amber-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200">Confirm Commit</h3>
                        </div>
                        <p className="text-gray-400 mb-4">
                            This will commit <strong className="text-white">{preview.summary.pointersWithAi - preview.summary.pointersCommitted} AI-processed pointers</strong> 
                            {' '}across <strong className="text-white">{preview.summary.filesWithAi} files</strong> to the ViewM4D database.
                        </p>
                        {preview.summary.pointersCommitted > 0 && (
                            <p className="text-sm text-cyan-400/80 mb-4">
                                {preview.summary.pointersCommitted} pointer(s) already committed will be skipped.
                            </p>
                        )}
                        {preview.summary.totalPointers > preview.summary.pointersWithAi && (
                            <p className="text-sm text-amber-400/80 mb-4">
                                {preview.summary.totalPointers - preview.summary.pointersWithAi} pointer(s) without AI analysis will be skipped.
                            </p>
                        )}
                        <p className="text-sm text-gray-500 mb-6">
                            These pointers will be available to superintendents via the Grok AI agent.
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowConfirmDialog(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmCommit}
                                className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                            >
                                Yes, Commit
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Un-commit Confirmation Dialog */}
            {showUncommitConfirm && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowUncommitConfirm(false)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <ExclamationCircleIcon className="w-5 h-5 text-amber-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200">Un-commit Pointers</h3>
                        </div>
                        <p className="text-gray-400 mb-4">
                            This will reset the committed status on <strong className="text-white">{preview.summary.pointersCommitted} pointers</strong>.
                        </p>
                        <p className="text-sm text-amber-400/80 mb-6">
                            They will need to be re-committed to be available to the ViewM4D agent.
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowUncommitConfirm(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmUncommit}
                                className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors"
                            >
                                Yes, Un-commit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ============================================
// Context Preview Modal Component (File-specific)
// ============================================

// Accordion Page Item Component
const AccordionPageItem: React.FC<{
    page: ContextPreviewResponse['pages'][0];
    isExpanded: boolean;
    onToggle: () => void;
}> = ({ page, isExpanded, onToggle }) => {
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'complete':
                return <CheckIcon className="w-4 h-4 text-green-400 flex-shrink-0" />;
            case 'error':
                return <ExclamationCircleIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />;
            case 'processing':
                return <SpinnerIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />;
            default:
                return <HollowCircleIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />;
        }
    };

    const getBorderStyle = (status: string) => {
        switch (status) {
            case 'error':
                return 'border-l-2 border-l-amber-500 bg-amber-500/5';
            case 'processing':
            case 'pending':
                return 'border-l-2 border-l-cyan-500 bg-cyan-500/5';
            default:
                return '';
        }
    };

    return (
        <div className={`${getBorderStyle(page.contextStatus)}`}>
            {/* Header - Always visible */}
            <button
                onClick={onToggle}
                className="w-full px-5 py-3 flex items-center gap-3 hover:bg-gray-800/40 transition-colors text-left"
            >
                <ChevronDownIcon 
                    className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${
                        isExpanded ? '' : '-rotate-90'
                    }`} 
                />
                {getStatusIcon(page.contextStatus)}
                <span className="text-sm font-medium text-gray-200 flex-1 truncate">
                    {page.pageName}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {page.pointers.length > 0 && (
                        <span className="text-[10px] text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
                            {page.pointers.length} pointer{page.pointers.length !== 1 ? 's' : ''}
                        </span>
                    )}
                    {page.committedAt && (
                        <span className="text-[10px] text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                            Committed
                        </span>
                    )}
                </div>
            </button>

            {/* Expandable Content */}
            {isExpanded && (
                <div className="px-5 pb-4 pl-12 space-y-3">
                    {/* Context Preview */}
                    {page.context ? (
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Page Context</h4>
                            <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                                {page.context}
                            </p>
                        </div>
                    ) : page.contextStatus === 'error' ? (
                        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                            <p className="text-xs text-amber-400">
                                Failed to process this page. Context generation encountered an error.
                            </p>
                        </div>
                    ) : page.contextStatus === 'pending' || page.contextStatus === 'processing' ? (
                        <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-3">
                            <p className="text-xs text-cyan-400">
                                {page.contextStatus === 'processing' 
                                    ? 'Processing page context...' 
                                    : 'Page context pending processing'
                                }
                            </p>
                        </div>
                    ) : (
                        <div className="bg-gray-800/50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 italic">No context available</p>
                        </div>
                    )}

                    {/* Context Pointers */}
                    {page.pointers.length > 0 && (
                        <div>
                            <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Context Pointers</h4>
                            <div className="space-y-1.5">
                                {page.pointers.map((pointer) => (
                                    <div 
                                        key={pointer.id}
                                        className="bg-gray-800/30 rounded px-3 py-2 flex items-start gap-2"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-gray-200 font-medium">{pointer.title}</p>
                                            {pointer.description && (
                                                <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                                                    {pointer.description}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const ContextPreviewModal: React.FC<{
    preview: ContextPreviewResponse;
    onClose: () => void;
    onCommitSuccess?: (result: ContextCommitResponse) => void;
}> = ({ preview, onClose, onCommitSuccess }) => {
    const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
    const [isCommitting, setIsCommitting] = useState(false);
    const [showConfirmDialog, setShowConfirmDialog] = useState(false);
    const [commitError, setCommitError] = useState<string | null>(null);
    const [commitResult, setCommitResult] = useState<ContextCommitResponse | null>(null);

    // Close on Escape key (only if no confirmation dialog is open)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !showConfirmDialog) {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose, showConfirmDialog]);

    const togglePage = (pageId: string) => {
        setExpandedPages(prev => {
            const next = new Set(prev);
            if (next.has(pageId)) {
                next.delete(pageId);
            } else {
                next.add(pageId);
            }
            return next;
        });
    };

    const expandAll = () => {
        setExpandedPages(new Set(preview.pages.map(p => p.pageId)));
    };

    const collapseAll = () => {
        setExpandedPages(new Set());
    };

    const handleCommitClick = () => {
        setShowConfirmDialog(true);
    };

    const handleConfirmCommit = async () => {
        setShowConfirmDialog(false);
        setIsCommitting(true);
        setCommitError(null);

        try {
            const result = await commitContext(preview.planId);
            setCommitResult(result);
            onCommitSuccess?.(result);
        } catch (err) {
            setCommitError(err instanceof Error ? err.message : 'Failed to commit context');
        } finally {
            setIsCommitting(false);
        }
    };

    const handleCloseAfterSuccess = () => {
        onClose();
    };

    // Calculate ready-to-commit pages (complete or error status)
    const readyToCommitPages = preview.pages.filter(
        p => p.contextStatus === 'complete' || p.contextStatus === 'error'
    ).length;

    return (
        <>
            <style>{`
                @keyframes modal-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes modal-slide-in {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .modal-backdrop {
                    animation: modal-fade-in 0.2s ease-out forwards;
                }
                .modal-content {
                    animation: modal-slide-in 0.2s ease-out forwards;
                }
            `}</style>
            <div 
                className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6"
                onClick={onClose}
            >
                <div 
                    className="modal-content bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col"
                    style={{ width: '80vw', maxWidth: '1200px', height: '80vh' }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Modal Header */}
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
                        <div>
                            <h2 className="text-xl font-semibold text-gray-200">Context Preview</h2>
                            <p className="text-sm text-gray-500 mt-0.5">{preview.planName}</p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
                            aria-label="Close modal"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Summary Bar */}
                    <div className="px-6 py-4 bg-gray-800/50 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-8">
                            <div className="text-center">
                                <div className="text-2xl font-bold text-gray-200">{preview.summary.totalPages}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pages</div>
                            </div>
                            <div className="text-center">
                                <div className="text-2xl font-bold text-green-400">{preview.summary.pagesComplete}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Complete</div>
                            </div>
                            {preview.summary.pagesWithErrors > 0 && (
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-amber-400">{preview.summary.pagesWithErrors}</div>
                                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Errors</div>
                                </div>
                            )}
                            <div className="text-center">
                                <div className="text-2xl font-bold text-cyan-400">{preview.summary.totalPointers}</div>
                                <div className="text-[10px] text-gray-500 uppercase tracking-wider">Pointers</div>
                            </div>
                            {preview.summary.pagesCommitted > 0 && (
                                <div className="text-center">
                                    <div className="text-2xl font-bold text-purple-400">{preview.summary.pagesCommitted}</div>
                                    <div className="text-[10px] text-gray-500 uppercase tracking-wider">Already Committed</div>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={expandAll}
                                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                            >
                                Expand All
                            </button>
                            <button
                                onClick={collapseAll}
                                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                            >
                                Collapse All
                            </button>
                        </div>
                    </div>

                    {/* Ready to Commit Summary */}
                    <div className="px-6 py-3 bg-gradient-to-r from-cyan-500/10 to-green-500/10 border-b border-gray-700 flex-shrink-0">
                        <p className="text-sm text-gray-300">
                            <span className="font-semibold text-cyan-400">Ready to commit:</span>{' '}
                            {readyToCommitPages} pages + {preview.summary.totalPointers} context pointers
                        </p>
                    </div>

                    {/* Success State */}
                    {commitResult && (
                        <div className="flex-1 flex flex-col items-center justify-center p-8">
                            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                                <CheckIcon className="w-8 h-8 text-green-400" />
                            </div>
                            <h3 className="text-xl font-semibold text-gray-200 mb-2">Successfully Committed!</h3>
                            <p className="text-gray-400 mb-6 text-center">
                                Committed {commitResult.pagesCommitted} pages and {commitResult.pointersCommitted} context pointers to ViewM4D database.
                            </p>
                            {commitResult.warnings.length > 0 && (
                                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 max-w-md">
                                    <h4 className="text-sm font-medium text-amber-400 mb-2">Warnings:</h4>
                                    <ul className="text-xs text-amber-300 space-y-1">
                                        {commitResult.warnings.map((warning, idx) => (
                                            <li key={idx}>{warning}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <button
                                onClick={handleCloseAfterSuccess}
                                className="px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
                            >
                                Close
                            </button>
                        </div>
                    )}

                    {/* Pages List (shown when not in success state) */}
                    {!commitResult && (
                        <>
                            <div className="flex-1 overflow-auto custom-scrollbar">
                                <div className="divide-y divide-gray-800">
                                    {preview.pages.map((page) => (
                                        <AccordionPageItem
                                            key={page.pageId}
                                            page={page}
                                            isExpanded={expandedPages.has(page.pageId)}
                                            onToggle={() => togglePage(page.pageId)}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Error Toast */}
                            {commitError && (
                                <div className="mx-6 mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
                                    <ExclamationCircleIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
                                    <span className="text-sm text-red-400 flex-1">{commitError}</span>
                                    <button
                                        onClick={() => setCommitError(null)}
                                        className="text-red-400 hover:text-red-300"
                                    >
                                        <CloseIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            )}

                            {/* Modal Footer */}
                            <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-end gap-3 flex-shrink-0">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCommitClick}
                                    disabled={isCommitting || readyToCommitPages === 0}
                                    className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                                        isCommitting || readyToCommitPages === 0
                                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                            : 'bg-green-600 hover:bg-green-500 text-white'
                                    }`}
                                >
                                    {isCommitting ? (
                                        <>
                                            <SpinnerIcon className="w-4 h-4" />
                                            Committing...
                                        </>
                                    ) : (
                                        <>
                                            <DatabaseIcon className="w-4 h-4" />
                                            Commit to ViewM4D Database
                                        </>
                                    )}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Confirmation Dialog */}
            {showConfirmDialog && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowConfirmDialog(false)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                                <ExclamationCircleIcon className="w-5 h-5 text-amber-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200">Confirm Commit</h3>
                        </div>
                        <p className="text-gray-400 mb-6">
                            This will push all context to production. This action will mark {readyToCommitPages} pages 
                            and {preview.summary.totalPointers} context pointers as committed to the ViewM4D database.
                        </p>
                        <p className="text-sm text-gray-500 mb-6">
                            Continue?
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowConfirmDialog(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmCommit}
                                className="px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                            >
                                Yes, Commit
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ContextPanel;
