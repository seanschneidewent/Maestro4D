/**
 * GlobalPreviewView - Preview panel that shows details based on selection type.
 * Handles file summary, page context, and pointer details.
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    DocumentIcon,
    CheckIcon,
    SpinnerIcon,
    ExclamationCircleIcon,
    EyeIcon,
    FolderIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    ZoomInIcon,
    ZoomOutIcon,
    ZoomResetIcon,
    ArrowDownTrayIcon,
} from '../Icons';
import { 
    FileSummary, 
    PageSummary, 
    PointerSummary,
    SelectionType 
} from './hooks/useProjectContext';
import { getPointerCropImageUrl, getPagePreviewImageUrl } from '../../utils/api';

// AI Input Preview component - shows the image sent to Gemini
const AIInputPreview: React.FC<{ 
    imageUrl: string; 
    label: string;
    defaultExpanded?: boolean;
}> = ({ imageUrl, label, defaultExpanded = false }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    
    // Zoom and pan state
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Reset zoom/pan when modal opens
    useEffect(() => {
        if (isModalOpen) {
            setZoom(1);
            setPan({ x: 0, y: 0 });
        }
    }, [isModalOpen]);

    // Handle wheel zoom
    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        
        const container = containerRef.current;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Calculate zoom
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(0.5, Math.min(5, zoom * zoomFactor));
        
        // Zoom toward mouse position
        const scaleChange = newZoom / zoom;
        const newPanX = mouseX - (mouseX - pan.x) * scaleChange;
        const newPanY = mouseY - (mouseY - pan.y) * scaleChange;
        
        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
    }, [zoom, pan]);

    // Handle mouse down for panning
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) return; // Only left click
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
        setDragStart({
            x: e.clientX - pan.x,
            y: e.clientY - pan.y,
        });
    }, [pan]);

    // Handle mouse move for panning
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isDragging) return;
        e.preventDefault();
        e.stopPropagation();
        
        setPan({
            x: e.clientX - dragStart.x,
            y: e.clientY - dragStart.y,
        });
    }, [isDragging, dragStart]);

    // Handle mouse up to stop panning
    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Handle mouse leave to stop panning
    const handleMouseLeave = useCallback(() => {
        setIsDragging(false);
    }, []);

    // Zoom controls
    const handleZoomIn = useCallback(() => {
        const newZoom = Math.min(5, zoom + 0.25);
        setZoom(newZoom);
    }, [zoom]);

    const handleZoomOut = useCallback(() => {
        const newZoom = Math.max(0.5, zoom - 0.25);
        setZoom(newZoom);
    }, [zoom]);

    const handleResetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    // Handle image download - open in new tab for user to save
    const handleDownload = useCallback(() => {
        // Open image in new tab where user can right-click and save
        window.open(imageUrl, '_blank');
    }, [imageUrl]);

    // Handle ESC key to close modal
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isModalOpen) {
                setIsModalOpen(false);
            }
        };
        if (isModalOpen) {
            window.addEventListener('keydown', handleEscape);
            return () => window.removeEventListener('keydown', handleEscape);
        }
    }, [isModalOpen]);

    return (
        <div className="mb-6">
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 w-full text-left group"
            >
                {isExpanded ? (
                    <ChevronDownIcon className="w-4 h-4 text-gray-400 group-hover:text-cyan-400 transition-colors" />
                ) : (
                    <ChevronRightIcon className="w-4 h-4 text-gray-400 group-hover:text-cyan-400 transition-colors" />
                )}
                <h4 className="text-xs text-gray-500 uppercase tracking-wider group-hover:text-gray-400 transition-colors">
                    {label}
                </h4>
            </button>
            
            {isExpanded && (
                <div className="mt-3">
                    {imageError ? (
                        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
                            <ExclamationCircleIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                            <p className="text-sm text-gray-500">Preview not available</p>
                            <p className="text-xs text-gray-600 mt-1">Image may not have been generated yet</p>
                        </div>
                    ) : (
                        <div 
                            className="relative bg-gray-800/50 rounded-lg border border-gray-700 overflow-hidden cursor-pointer hover:border-cyan-500/50 transition-colors"
                            onClick={() => setIsModalOpen(true)}
                        >
                            {isLoading && (
                                <div className="absolute inset-0 flex items-center justify-center bg-gray-800/80">
                                    <SpinnerIcon className="w-6 h-6 text-cyan-400" />
                                </div>
                            )}
                            <img
                                src={imageUrl}
                                alt="AI input preview"
                                className="w-full h-auto max-h-48 object-contain"
                                onLoad={() => setIsLoading(false)}
                                onError={() => {
                                    setIsLoading(false);
                                    setImageError(true);
                                }}
                            />
                            <div className="absolute bottom-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-gray-300 flex items-center gap-1">
                                <EyeIcon className="w-3 h-3" />
                                Click to enlarge
                            </div>
                        </div>
                    )}
                </div>
            )}
            
            {/* Full-size modal */}
            {isModalOpen && !imageError && (
                <div 
                    className="fixed inset-0 z-50 bg-black/80"
                    onClick={(e) => {
                        // Only close if clicking the backdrop, not the image container
                        if (e.target === e.currentTarget) {
                            setIsModalOpen(false);
                        }
                    }}
                >
                    <div 
                        ref={containerRef}
                        className="relative w-full h-full flex items-center justify-center overflow-hidden"
                        onWheel={handleWheel}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseLeave}
                    >
                        <img
                            ref={imageRef}
                            src={imageUrl}
                            alt="AI input preview (full size)"
                            className="max-w-full max-h-full object-contain select-none"
                            style={{
                                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                                cursor: isDragging ? 'grabbing' : 'grab',
                                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                            }}
                            draggable={false}
                            onClick={(e) => e.stopPropagation()}
                        />
                        
                        {/* Zoom control toolbar */}
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 backdrop-blur-sm rounded-lg px-4 py-2 flex items-center gap-3 shadow-2xl border border-gray-700/50">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleZoomOut();
                                }}
                                className="p-1.5 hover:bg-gray-700/50 rounded transition-colors"
                                title="Zoom out"
                            >
                                <ZoomOutIcon className="w-5 h-5 text-gray-300" />
                            </button>
                            <span className="text-sm text-gray-300 min-w-[3rem] text-center">
                                {Math.round(zoom * 100)}%
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleZoomIn();
                                }}
                                className="p-1.5 hover:bg-gray-700/50 rounded transition-colors"
                                title="Zoom in"
                            >
                                <ZoomInIcon className="w-5 h-5 text-gray-300" />
                            </button>
                            <div className="w-px h-6 bg-gray-600" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleResetView();
                                }}
                                className="p-1.5 hover:bg-gray-700/50 rounded transition-colors"
                                title="Reset zoom"
                            >
                                <ZoomResetIcon className="w-5 h-5 text-gray-300" />
                            </button>
                            <div className="w-px h-6 bg-gray-600" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownload();
                                }}
                                className="p-1.5 hover:bg-gray-700/50 rounded transition-colors"
                                title="Download image"
                            >
                                <ArrowDownTrayIcon className="w-5 h-5 text-gray-300" />
                            </button>
                            <div className="w-px h-6 bg-gray-600" />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsModalOpen(false);
                                }}
                                className="p-1.5 hover:bg-gray-700/50 rounded transition-colors"
                                title="Close"
                            >
                                <svg className="w-5 h-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        
                        {/* Info label */}
                        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/60 px-3 py-1.5 rounded text-sm text-gray-300">
                            Exact image sent to Gemini AI
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// File summary view
const FileSummaryView: React.FC<{ file: FileSummary }> = ({ file }) => {
    const getStatusColor = (complete: number, errors: number, total: number) => {
        if (errors > 0) return 'text-amber-400';
        if (complete === total && total > 0) return 'text-green-400';
        if (complete > 0) return 'text-cyan-400';
        return 'text-gray-400';
    };

    return (
        <div className="p-4 h-full overflow-auto custom-scrollbar">
            {/* File header */}
            <div className="flex items-center gap-3 mb-6">
                <DocumentIcon className="w-8 h-8 text-cyan-400" />
                <div>
                    <h3 className="text-lg font-medium text-gray-200">{file.name}</h3>
                    <p className="text-xs text-gray-500">{file.fileType || 'PDF Document'}</p>
                </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="text-2xl font-bold text-gray-200">{file.pageCount}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Pages</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="text-2xl font-bold text-cyan-400">{file.pointerCount}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Pointers</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className={`text-2xl font-bold ${getStatusColor(file.pagesComplete, file.pagesWithErrors, file.pageCount)}`}>
                        {file.pagesComplete}/{file.pageCount}
                    </div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Complete</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className={`text-2xl font-bold ${file.pagesCommitted > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                        {file.pagesCommitted}
                    </div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Committed</div>
                </div>
            </div>

            {/* Status breakdown */}
            {file.pagesWithErrors > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center gap-2">
                        <ExclamationCircleIcon className="w-4 h-4 text-amber-400" />
                        <span className="text-sm text-amber-300">
                            {file.pagesWithErrors} page{file.pagesWithErrors !== 1 ? 's' : ''} with errors
                        </span>
                    </div>
                </div>
            )}

            {/* Pages list preview */}
            {file.pages.length > 0 && (
                <div>
                    <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Pages</h4>
                    <div className="space-y-1">
                        {file.pages.slice(0, 10).map((page) => (
                            <div 
                                key={page.id}
                                className="flex items-center gap-2 px-3 py-2 bg-gray-800/30 rounded-lg text-sm"
                            >
                                <StatusIcon status={page.status} />
                                <span className="text-gray-300">Page {page.pageNumber}</span>
                                {page.pointerCount > 0 && (
                                    <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded ml-auto">
                                        {page.pointerCount} ptr
                                    </span>
                                )}
                            </div>
                        ))}
                        {file.pages.length > 10 && (
                            <p className="text-xs text-gray-500 text-center py-2">
                                +{file.pages.length - 10} more pages
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Page context view
const PageContextView: React.FC<{ page: PageSummary; fileName?: string; fileId?: string }> = ({ page, fileName, fileId }) => {
    return (
        <div className="p-4 h-full overflow-auto custom-scrollbar">
            {/* Page header */}
            <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                    <span className="text-lg font-bold text-cyan-400">{page.pageNumber}</span>
                </div>
                <div>
                    <h3 className="text-base font-medium text-gray-200">Page {page.pageNumber}</h3>
                    {fileName && <p className="text-xs text-gray-500">{fileName}</p>}
                </div>
                <div className="ml-auto">
                    <StatusBadge status={page.status} />
                </div>
            </div>

            {/* Committed status */}
            {page.committedAt && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 flex items-center gap-2">
                    <CheckIcon className="w-4 h-4 text-green-400" />
                    <span className="text-sm text-green-300">
                        Committed on {new Date(page.committedAt).toLocaleDateString()}
                    </span>
                </div>
            )}

            {/* AI Input Preview - Page image sent to Gemini */}
            {fileId && page.hasContext && (
                <AIInputPreview
                    imageUrl={getPagePreviewImageUrl(fileId, page.pageNumber)}
                    label="AI Input Preview (Page)"
                />
            )}

            {/* Context content */}
            <div className="mb-6">
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Page Context</h4>
                {page.hasContext ? (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {page.contextPreview}
                        </p>
                        {page.contextPreview && page.contextPreview.endsWith('...') && (
                            <p className="text-xs text-gray-500 mt-2 italic">
                                Full context available - select page for complete view
                            </p>
                        )}
                    </div>
                ) : page.status === 'error' ? (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-2">
                            <ExclamationCircleIcon className="w-4 h-4 text-amber-400" />
                            <span className="text-sm text-amber-300">Context generation failed</span>
                        </div>
                        <p className="text-xs text-gray-400">
                            Try reprocessing this page or check the PDF for issues.
                        </p>
                    </div>
                ) : page.status === 'processing' ? (
                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4 flex items-center gap-3">
                        <SpinnerIcon className="w-5 h-5 text-cyan-400" />
                        <span className="text-sm text-cyan-300">Generating context...</span>
                    </div>
                ) : (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
                        <p className="text-sm text-gray-500">No context generated yet</p>
                        <p className="text-xs text-gray-600 mt-1">Process this PDF to generate page context</p>
                    </div>
                )}
            </div>

            {/* Pointers list */}
            {page.pointers.length > 0 && (
                <div>
                    <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                        Context Pointers ({page.pointerCount})
                    </h4>
                    <div className="space-y-2">
                        {page.pointers.map((pointer) => (
                            <div 
                                key={pointer.id}
                                className="bg-gray-800/30 rounded-lg p-3 border border-gray-700/50"
                            >
                                <div className="flex items-start gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-2 flex-shrink-0" />
                                    <div>
                                        <h5 className="text-sm font-medium text-gray-200">{pointer.title}</h5>
                                        {pointer.description && (
                                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                                                {pointer.description}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// Pointer detail view
const PointerDetailView: React.FC<{ pointer: PointerSummary; pageNumber?: number; fileName?: string }> = ({ 
    pointer, 
    pageNumber,
    fileName 
}) => {
    return (
        <div className="p-4 h-full overflow-auto custom-scrollbar">
            {/* Pointer header */}
            <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span className="text-xs text-gray-500 uppercase tracking-wider">Context Pointer</span>
                </div>
                <h3 className="text-lg font-medium text-gray-200">{pointer.title}</h3>
                {(pageNumber || fileName) && (
                    <p className="text-xs text-gray-500 mt-1">
                        {fileName && <span>{fileName}</span>}
                        {fileName && pageNumber && <span> • </span>}
                        {pageNumber && <span>Page {pageNumber}</span>}
                    </p>
                )}
            </div>

            {/* AI Input Preview - Crop image sent to Gemini */}
            <AIInputPreview
                imageUrl={getPointerCropImageUrl(pointer.id)}
                label="AI Input Preview (Crop)"
                defaultExpanded={true}
            />

            {/* Description */}
            <div className="mb-6">
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Description</h4>
                {pointer.description ? (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                            {pointer.description}
                        </p>
                    </div>
                ) : (
                    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 text-center">
                        <p className="text-sm text-gray-500 italic">No description provided</p>
                    </div>
                )}
            </div>

            {/* Metadata */}
            <div>
                <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Details</h4>
                <div className="bg-gray-800/30 rounded-lg p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-500">ID</span>
                        <span className="text-gray-400 font-mono text-xs">{pointer.id.slice(0, 8)}...</span>
                    </div>
                    {pageNumber && (
                        <div className="flex justify-between">
                            <span className="text-gray-500">Page</span>
                            <span className="text-gray-300">{pageNumber}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Status badge component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
    const config: Record<string, { bg: string; text: string; label: string }> = {
        complete: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Complete' },
        processing: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', label: 'Processing' },
        error: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Error' },
        pending: { bg: 'bg-gray-500/10', text: 'text-gray-400', label: 'Pending' },
    };
    
    const { bg, text, label } = config[status] || config.pending;
    
    return (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${bg} ${text}`}>
            {label}
        </span>
    );
};

// Status icon component
const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'complete':
            return <CheckIcon className="w-4 h-4 text-green-400" />;
        case 'processing':
            return <SpinnerIcon className="w-4 h-4 text-cyan-400" />;
        case 'error':
            return <ExclamationCircleIcon className="w-4 h-4 text-amber-500" />;
        default:
            return <div className="w-4 h-4 rounded-full border border-gray-600" />;
    }
};

// Main GlobalPreviewView component
export interface GlobalPreviewViewProps {
    selectionType: SelectionType;
    selectedFile: FileSummary | null;
    selectedPage: PageSummary | null;
    selectedPointer: PointerSummary | null;
}

export const GlobalPreviewView: React.FC<GlobalPreviewViewProps> = ({
    selectionType,
    selectedFile,
    selectedPage,
    selectedPointer,
}) => {
    // Empty state - nothing selected
    if (!selectionType || (!selectedFile && !selectedPage && !selectedPointer)) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
                <EyeIcon className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">Select an item to preview</p>
                <p className="text-xs text-gray-600 mt-1">
                    Choose a file, page, or pointer from the tree
                </p>
            </div>
        );
    }

    // Pointer selected
    if (selectionType === 'pointer' && selectedPointer) {
        return (
            <PointerDetailView 
                pointer={selectedPointer} 
                pageNumber={selectedPage?.pageNumber}
                fileName={selectedFile?.name}
            />
        );
    }

    // Page selected
    if (selectionType === 'page' && selectedPage) {
        return <PageContextView page={selectedPage} fileName={selectedFile?.name} fileId={selectedFile?.id} />;
    }

    // File selected
    if (selectionType === 'file' && selectedFile) {
        return <FileSummaryView file={selectedFile} />;
    }

    // Fallback
    return (
        <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
            <EyeIcon className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">Select an item to preview</p>
        </div>
    );
};

export default GlobalPreviewView;


