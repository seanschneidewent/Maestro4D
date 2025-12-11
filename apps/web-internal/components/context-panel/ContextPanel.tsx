import React, { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SheetContext } from '../../types/context';
import { ProcessedBatch, ProcessedPointer, ProcessedBatchSummary } from '../../types/n8n';
import { useN8NExport, useProcessedBatches } from './hooks';
import { 
    DocumentIcon, 
    ChevronLeftIcon, 
    ChevronRightIcon, 
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
    CloseIcon
} from '../Icons';

type ViewMode = 'context' | 'processed';

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

// Image Lightbox component for viewing snapshots at full size
const ImageLightbox: React.FC<{
    imageUrl: string;
    alt: string;
    onClose: () => void;
}> = ({ imageUrl, alt, onClose }) => {
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
                .lightbox-image {
                    animation: lightbox-scale-in 0.2s ease-out forwards;
                }
            `}</style>
            <div 
                className="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
                onClick={onClose}
            >
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
                    className="lightbox-image relative max-w-[90vw] max-h-[90vh]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <img 
                        src={imageUrl} 
                        alt={alt} 
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                    />
                </div>
                
                {/* Hint text */}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-gray-500">
                    Click outside or press Escape to close
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
}> = ({ batch, onBack, onCommit, onDiscard, isDiscarding }) => {
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
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors"
                    >
                        <DatabaseIcon className="w-3.5 h-3.5" />
                        Commit to DB
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
const ProcessedBatchesView: React.FC = () => {
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

    const handleCommit = () => {
        // Placeholder for database commit functionality
        console.log('Committing batch to database:', selectedBatch?.batchId);
        alert('Database commit functionality will be implemented here.\nThis will integrate with the existing sql.js database.');
    };

    // Show batch detail if selected
    if (selectedBatch) {
        return (
            <BatchDetailView
                batch={selectedBatch}
                onBack={clearSelectedBatch}
                onCommit={handleCommit}
                onDiscard={handleDiscard}
                isDiscarding={isDiscarding}
            />
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
}) => {
    const [isResizing, setIsResizing] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('context');
    const [exportSuccess, setExportSuccess] = useState<string | null>(null);
    
    const { isExporting, error: exportError, exportBatch } = useN8NExport();

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

    // Handle export
    const handleExport = async () => {
        setExportSuccess(null);
        const result = await exportBatch(sheetContexts);
        if (result?.success) {
            setExportSuccess(result.batchId);
            // Clear success message after 5 seconds
            setTimeout(() => setExportSuccess(null), 5000);
        }
    };

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
                <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-gray-200">Context Files</h2>
                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setViewMode('context')}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                viewMode === 'context'
                                    ? 'bg-gray-700 text-cyan-400'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            Files
                        </button>
                        <button
                            onClick={() => setViewMode('processed')}
                            className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                                viewMode === 'processed'
                                    ? 'bg-gray-700 text-cyan-400'
                                    : 'text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            Processed
                        </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Process with AI Button - only show in context view */}
                    {viewMode === 'context' && (
                        <button
                            onClick={handleExport}
                            disabled={stats.total === 0 || isExporting}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors ${
                                stats.total === 0 || isExporting
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                            }`}
                            title={stats.total === 0 ? 'Add sheets to context first' : 'Export for AI processing'}
                        >
                            {isExporting ? (
                                <>
                                    <SpinnerIcon className="w-3.5 h-3.5" />
                                    Exporting...
                                </>
                            ) : (
                                <>
                                    <CloudArrowUpIcon className="w-3.5 h-3.5" />
                                    Process with AI
                                </>
                            )}
                        </button>
                    )}
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

            {/* Content Area */}
            {viewMode === 'context' ? (
                <>
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
                        <span>{stats.total} sheets | {stats.totalPointers} pointers</span>
                        <span>{stats.complete}/{stats.withPointers} generated</span>
                    </div>
                </>
            ) : (
                /* Processed Batches View */
                <div className="flex-1 overflow-hidden">
                    <ProcessedBatchesView />
                </div>
            )}
        </div>
    );
};

export default ContextPanel;
