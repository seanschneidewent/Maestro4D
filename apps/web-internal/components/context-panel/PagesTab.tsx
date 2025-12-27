import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePageProcessing } from './hooks/usePageProcessing';
import { usePageContexts, ContextTreePageContext } from './hooks/usePageContexts';
import { resetPageProcessing, getPointerCropImageUrl, getPagePreviewImageUrl, TextHighlight } from '../../utils/api';
import {
  SpinnerIcon,
  CheckIcon,
  DocumentIcon,
  ChevronDownIcon,
  ExclamationCircleIcon,
  RefreshIcon,
  ArrowsPointingOutIcon,
  CloseIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../Icons';

// =============================================================================
// Constants
// =============================================================================

const REFETCH_DEBOUNCE_MS = 500;

// =============================================================================
// Types
// =============================================================================

interface PointerBounds {
  xNorm: number;
  yNorm: number;
  wNorm: number;
  hNorm: number;
}

interface PointerLookupData {
  title: string;
  description: string | null;
  bounds?: PointerBounds;
}

interface PagesTabProps {
  projectId: string;
  pointerLookup?: Map<string, PointerLookupData>;
}

// =============================================================================
// Constants
// =============================================================================

// Discipline badge colors
const DISCIPLINE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  S: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
  M: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  E: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  P: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  FP: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  C: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  L: { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30' },
  G: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
};

// Discipline full names
const DISCIPLINE_NAMES: Record<string, string> = {
  A: 'Architectural',
  S: 'Structural',
  M: 'Mechanical',
  E: 'Electrical',
  P: 'Plumbing',
  FP: 'Fire Protection',
  C: 'Civil',
  L: 'Landscape',
  G: 'General',
};

// Identifier type badge colors
const IDENTIFIER_COLORS: Record<string, { bg: string; text: string }> = {
  spec: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  assembly: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  detail: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  equipment: { bg: 'bg-green-500/20', text: 'text-green-400' },
  grid: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  schedule: { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  note: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

// =============================================================================
// Helper Components
// =============================================================================

// Discipline badge component
const DisciplineBadge: React.FC<{ code: string | null }> = ({ code }) => {
  if (!code) return null;
  
  const colors = DISCIPLINE_COLORS[code] || DISCIPLINE_COLORS.G;
  const name = DISCIPLINE_NAMES[code] || code;
  
  return (
    <span 
      className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${colors.bg} ${colors.text} ${colors.border}`}
      title={name}
    >
      {code}
    </span>
  );
};

// Processing status indicator for individual pages
const PageStatusIndicator: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case 'pass1_processing':
    case 'pass2_processing':
      return <SpinnerIcon className="h-3 w-3 text-cyan-400" />;
    case 'pass1_complete':
      return (
        <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-blue-500/20 text-blue-400">
          P1
        </span>
      );
    case 'pass2_complete':
      return <CheckIcon className="h-3.5 w-3.5 text-green-400" />;
    default:
      return null;
  }
};

// Identifier type badge
const IdentifierTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors = IDENTIFIER_COLORS[type.toLowerCase()] || IDENTIFIER_COLORS.note;
  
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${colors.bg} ${colors.text}`}>
      {type}
    </span>
  );
};

// Progress bar component
const ProgressBar: React.FC<{ 
  label: string; 
  complete: number; 
  total: number; 
  color: string;
}> = ({ label, complete, total, color }) => {
  const percentage = total > 0 ? (complete / total) * 100 : 0;
  
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className="text-[10px] text-gray-400">{complete}/{total}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

// Expanded page detail view
const PageDetail: React.FC<{
  page: ContextTreePageContext;
  pointerLookup?: Map<string, PointerLookupData>;
  onSnapToPointer?: (pointerId: string) => void;
}> = ({ page, pointerLookup, onSnapToPointer }) => {
  // Use structured pass1_output.summary if available, otherwise fall back to legacy fields
  const summary = page.pass1Output?.summary || page.contextDescription || page.quickDescription;
  const pointers = page.pass1Output?.pointers || [];
  const pass2Output = page.pass2Output || { outbound_refs_context: [] };
  const inboundRefs = page.inboundReferences || [];

  // Build lookup for outbound ref context from pass2_output
  const outboundContextLookup: Record<string, string> = {};
  for (const refCtx of pass2Output.outbound_refs_context || []) {
    outboundContextLookup[refCtx.ref] = refCtx.context;
  }

  // Count total outbound refs across all pointers
  const totalOutboundRefs = pointers.reduce((sum, p) => sum + (p.outbound_refs?.length || 0), 0);

  // Check if we have new structured data or only legacy data
  const hasStructuredData = page.pass1Output !== null || inboundRefs.length > 0;

  return (
    <div className="px-3 py-3 bg-gray-800/30 border-t border-gray-700/50 space-y-3">
      {/* Page Summary */}
      {summary && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Summary
          </h4>
          <p className="text-sm text-gray-300 leading-relaxed">
            {summary}
          </p>
        </div>
      )}

      {/* Pointers with Outbound References (new structured data) */}
      {pointers.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Pointers ({pointers.length}) · Outbound Refs ({totalOutboundRefs})
          </h4>
          <div className="space-y-3">
            {pointers.map((pointer, idx) => {
              const originalPointer = pointerLookup?.get(pointer.pointer_id);
              return (
                <div
                  key={pointer.pointer_id || idx}
                  className="bg-gray-700/30 rounded-lg border border-gray-600/30 overflow-hidden"
                >
                  {/* Pointer crop image */}
                  <div className="bg-gray-900">
                    <img
                      src={getPointerCropImageUrl(pointer.pointer_id)}
                      alt={originalPointer?.title || 'Pointer crop'}
                      className={`w-full h-32 object-contain object-left ${
                        onSnapToPointer && originalPointer?.bounds ? 'cursor-pointer hover:opacity-80' : ''
                      }`}
                      title={onSnapToPointer && originalPointer?.bounds ? 'Double-click to zoom to this area' : undefined}
                      onDoubleClick={() => {
                        if (onSnapToPointer && originalPointer?.bounds) {
                          onSnapToPointer(pointer.pointer_id);
                        }
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                      }}
                    />
                  </div>

                  <div className="p-2">
                    {/* Pointer title */}
                    {originalPointer?.title && (
                      <h5 className="text-sm font-medium text-gray-200 mb-1">
                        {originalPointer.title}
                      </h5>
                    )}

                    {/* Pointer summary */}
                    <p className="text-xs text-gray-300 mb-1.5">{pointer.summary}</p>

                    {/* Outbound refs for this pointer */}
                    {pointer.outbound_refs && pointer.outbound_refs.length > 0 && (
                      <div className="space-y-2 mt-2">
                        {pointer.outbound_refs.map((ref, refIdx) => {
                          const context = outboundContextLookup[ref.ref];
                          return (
                            <div
                              key={refIdx}
                              className="flex flex-col gap-1 p-2 bg-cyan-500/10 rounded border border-cyan-500/30"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="text-cyan-400 font-mono text-xs">{ref.ref}</span>
                                <IdentifierTypeBadge type={ref.type} />
                              </div>
                              {ref.source_text && (
                                <p className="text-xs text-gray-400 italic border-l-2 border-cyan-500/50 pl-2">
                                  "{ref.source_text}"
                                </p>
                              )}
                              {context && (
                                <p className="text-xs text-gray-300 leading-relaxed">
                                  {context}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Inbound References (pages that reference this page) */}
      {inboundRefs.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Inbound References ({inboundRefs.length})
          </h4>
          <div className="space-y-1.5">
            {inboundRefs.map((ref, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 p-2 bg-gray-700/30 rounded border border-gray-600/30"
              >
                <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded border border-amber-500/30">
                  FROM
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-cyan-400 font-mono text-xs">{ref.source_sheet}</span>
                    <IdentifierTypeBadge type={ref.type} />
                  </div>
                  {ref.source_text && (
                    <p className="text-xs text-gray-400 italic border-l-2 border-amber-500/50 pl-2 mt-0.5">
                      "{ref.source_text}"
                    </p>
                  )}
                  {ref.context && (
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{ref.context}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy Identifiers (for backwards compatibility, only shown if no structured data) */}
      {!hasStructuredData && page.identifiers && page.identifiers.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Identifiers ({page.identifiers.length})
          </h4>
          <div className="space-y-1.5">
            {page.identifiers.map((identifier, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 text-sm"
              >
                <IdentifierTypeBadge type={identifier.type} />
                <span className="text-cyan-400 font-mono text-xs">{identifier.ref}</span>
                <span className="text-gray-400 text-xs flex-1">{identifier.content}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy Cross References (for backwards compatibility, only shown if no structured data) */}
      {!hasStructuredData && page.crossRefs && page.crossRefs.length > 0 && (
        <div>
          <h4 className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">
            Cross References ({page.crossRefs.length})
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {page.crossRefs.map((ref, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-700/50 rounded border border-gray-600/50 text-gray-300"
                title={ref.relationship}
              >
                <span className="text-cyan-400">{ref.targetSheet}</span>
                <span className="text-gray-500">•</span>
                <span className="text-gray-400 truncate max-w-[150px]">{ref.relationship}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* No content state */}
      {!summary && pointers.length === 0 && inboundRefs.length === 0 &&
       (!page.identifiers || page.identifiers.length === 0) &&
       (!page.crossRefs || page.crossRefs.length === 0) && (
        <p className="text-sm text-gray-500 italic">No context data yet.</p>
      )}
    </div>
  );
};

// Page preview modal component
const PagePreviewModal: React.FC<{
  page: ContextTreePageContext;
  onClose: () => void;
  pointerLookup?: Map<string, PointerLookupData>;
}> = ({ page, onClose, pointerLookup }) => {
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageError, setImageError] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Get page title for header
  const sheetDisplay = page.pageTitle || page.sheetNumber || `Page ${page.pageNumber}`;

  // Compute highlights from pass1_output pointers with outbound refs
  const highlights = useMemo((): TextHighlight[] => {
    const result: TextHighlight[] = [];
    const pass1Pointers = page.pass1Output?.pointers || [];

    for (const pointer of pass1Pointers) {
      // Get text_content from the actual ContextPointer (via pointerLookup)
      const pointerData = pointerLookup?.get(pointer.pointer_id);
      if (!pointerData?.text_content) continue;

      const textContent = pointerData.text_content as {
        text_elements?: Array<{ id: string; text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
        page_width?: number;
        page_height?: number;
      };
      const elements = textContent.text_elements || [];
      const pageWidth = textContent.page_width || 1;
      const pageHeight = textContent.page_height || 1;

      for (const ref of pointer.outbound_refs || []) {
        if (!ref.source_element_id) continue;

        const element = elements.find(el => el.id === ref.source_element_id);
        if (!element?.bbox) continue;

        // Normalize to full page dimensions (0-1)
        result.push({
          pointerId: pointer.pointer_id,
          elementId: element.id,
          bboxNormalized: {
            x: element.bbox.x0 / pageWidth,
            y: element.bbox.y0 / pageHeight,
            width: (element.bbox.x1 - element.bbox.x0) / pageWidth,
            height: (element.bbox.y1 - element.bbox.y0) / pageHeight,
          },
          matchedText: element.text,
        });
      }
    }
    return result;
  }, [page.pass1Output, pointerLookup]);

  // Handle image load to capture natural dimensions
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // Snap to bounding box with animation
  const snapToBounds = useCallback((bounds: PointerBounds) => {
    if (!containerRef.current || imageDimensions.width === 0 || imageDimensions.height === 0) return;

    const container = containerRef.current.getBoundingClientRect();
    const { xNorm, yNorm, wNorm, hNorm } = bounds;

    // Calculate the displayed size of the image at zoom=1 (object-contain)
    const containerAspect = container.width / container.height;
    const imageAspect = imageDimensions.width / imageDimensions.height;

    let displayedWidth: number, displayedHeight: number;
    if (imageAspect > containerAspect) {
      // Image is wider - width fills container
      displayedWidth = container.width;
      displayedHeight = container.width / imageAspect;
    } else {
      // Image is taller - height fills container
      displayedHeight = container.height;
      displayedWidth = container.height * imageAspect;
    }

    // Calculate target zoom to fit bbox with 15% padding on each side
    // This means the bbox should fill ~70% of the view
    const padding = 0.15;
    const availableWidth = container.width * (1 - 2 * padding);
    const availableHeight = container.height * (1 - 2 * padding);

    // The bbox in displayed pixels (at zoom=1)
    const bboxWidthDisplayed = wNorm * displayedWidth;
    const bboxHeightDisplayed = hNorm * displayedHeight;

    // Calculate zoom needed to fit bbox in available space
    const zoomForWidth = availableWidth / bboxWidthDisplayed;
    const zoomForHeight = availableHeight / bboxHeightDisplayed;
    let targetZoom = Math.min(zoomForWidth, zoomForHeight);

    // Clamp zoom to reasonable bounds (always zoom in, never below 1)
    targetZoom = Math.min(Math.max(targetZoom, 1), 5);

    // Position of bbox center in displayed image coords (at zoom=1, relative to image top-left)
    const displayedBboxCenterX = (xNorm + wNorm / 2) * displayedWidth;
    const displayedBboxCenterY = (yNorm + hNorm / 2) * displayedHeight;

    // The transform is: translate(panX, panY) scale(zoom)
    // Scaling happens around the image center (default transform-origin)
    // So we need to calculate pan to bring bbox center to container center

    // Distance from bbox center to image center (in displayed coords at zoom=1)
    const offsetFromImageCenterX = displayedBboxCenterX - displayedWidth / 2;
    const offsetFromImageCenterY = displayedBboxCenterY - displayedHeight / 2;

    // After scaling, this offset becomes multiplied by zoom
    // To center the bbox, we need to pan in the opposite direction by the scaled offset
    const panX = -offsetFromImageCenterX * targetZoom;
    const panY = -offsetFromImageCenterY * targetZoom;

    // Enable animation and apply transform
    setIsAnimating(true);
    setZoom(targetZoom);
    setPan({ x: panX, y: panY });

    // Disable animation after transition completes
    setTimeout(() => setIsAnimating(false), 300);
  }, [imageDimensions]);

  // Handle snap to pointer by looking up bounds
  const handleSnapToPointer = useCallback((pointerId: string) => {
    const pointer = pointerLookup?.get(pointerId);
    if (pointer?.bounds) {
      snapToBounds(pointer.bounds);
    }
  }, [pointerLookup, snapToBounds]);

  // Keyboard handler for Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Zoom handlers
  const handleZoomIn = () => setZoom(prev => Math.min(prev * 1.25, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev / 1.25, 0.5));
  const handleZoomReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.5, Math.min(5, zoom * zoomFactor));

    // Zoom toward mouse position
    const scaleChange = newZoom / zoom;
    const newPanX = mouseX - (mouseX - pan.x) * scaleChange;
    const newPanY = mouseY - (mouseY - pan.y) * scaleChange;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  }, [zoom, pan]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <>
      <style>{`
        @keyframes modal-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modal-slide-in {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .page-preview-backdrop {
          animation: modal-fade-in 0.2s ease-out forwards;
        }
        .page-preview-content {
          animation: modal-slide-in 0.2s ease-out forwards;
        }
      `}</style>
      <div
        className="page-preview-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="page-preview-content bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          style={{ width: '90vw', maxWidth: '1600px', height: '90vh' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-gray-200">{sheetDisplay}</h2>
              {page.disciplineCode && (
                <span className={`px-2 py-0.5 text-xs font-medium rounded border ${
                  DISCIPLINE_COLORS[page.disciplineCode]?.bg || 'bg-gray-500/20'
                } ${DISCIPLINE_COLORS[page.disciplineCode]?.text || 'text-gray-400'} ${
                  DISCIPLINE_COLORS[page.disciplineCode]?.border || 'border-gray-500/30'
                }`}>
                  {DISCIPLINE_NAMES[page.disciplineCode] || page.disciplineCode}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
            >
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Content: Side-by-side layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left panel: Image preview */}
            <div className="w-1/2 flex flex-col border-r border-gray-700 bg-gray-950">
              {/* Image container */}
              <div
                ref={containerRef}
                className="flex-1 overflow-hidden relative flex items-center justify-center"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                {!imageError ? (
                  <div
                    className="relative max-w-full max-h-full"
                    style={{
                      transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                      cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default',
                      transition: isDragging ? 'none' : isAnimating ? 'transform 0.3s ease-out' : 'transform 0.1s ease-out',
                    }}
                  >
                    <img
                      ref={imageRef}
                      src={getPagePreviewImageUrl(page.fileId, page.pageNumber)}
                      alt={`Page ${page.pageNumber} preview`}
                      className="max-w-full max-h-full object-contain select-none"
                      draggable={false}
                      onLoad={handleImageLoad}
                      onError={() => setImageError(true)}
                    />
                    {/* Reference highlight overlays */}
                    {highlights.length > 0 && (
                      <div className="absolute inset-0 pointer-events-none">
                        {highlights.map((h, idx) => (
                          <div
                            key={idx}
                            className="absolute"
                            style={{
                              left: `${h.bboxNormalized.x * 100}%`,
                              top: `${h.bboxNormalized.y * 100}%`,
                              width: `${h.bboxNormalized.width * 100}%`,
                              height: `${h.bboxNormalized.height * 100}%`,
                              backgroundColor: 'rgba(255, 255, 0, 0.4)',
                              border: '1px solid rgba(255, 200, 0, 0.8)',
                              borderRadius: '2px',
                            }}
                            title={h.matchedText}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-500">
                    <DocumentIcon className="w-16 h-16 mb-2 opacity-30" />
                    <p className="text-sm">Failed to load page preview</p>
                  </div>
                )}
              </div>

              {/* Zoom controls toolbar */}
              <div className="flex-shrink-0 px-4 py-3 border-t border-gray-800 bg-gray-900/50">
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleZoomOut}
                    className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
                    title="Zoom out"
                  >
                    <ZoomOutIcon className="w-5 h-5" />
                  </button>
                  <span className="text-sm font-medium text-gray-400 min-w-[50px] text-center">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
                    title="Zoom in"
                  >
                    <ZoomInIcon className="w-5 h-5" />
                  </button>
                  <div className="w-px h-5 bg-gray-700 mx-1" />
                  <button
                    onClick={handleZoomReset}
                    className="p-2 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors"
                    title="Reset zoom and pan"
                  >
                    <RefreshIcon className="w-5 h-5" />
                  </button>
                </div>
                {zoom > 1 && (
                  <p className="text-[10px] text-gray-600 text-center mt-1">
                    Drag to pan • Scroll to zoom
                  </p>
                )}
              </div>
            </div>

            {/* Right panel: Page data */}
            <div className="w-1/2 overflow-y-auto custom-scrollbar bg-gray-900/50">
              <PageDetail page={page} pointerLookup={pointerLookup} onSnapToPointer={handleSnapToPointer} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

// Single page item component
const PageItem: React.FC<{
  page: ContextTreePageContext;
  isExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  pointerLookup?: Map<string, PointerLookupData>;
}> = ({ page, isExpanded, onToggle, onExpand, pointerLookup }) => {
  const sheetDisplay = page.pageTitle || page.sheetNumber || `Page ${page.pageNumber}`;
  const hasContent = page.processingStatus === 'pass2_complete' ||
                     page.processingStatus === 'pass1_complete';

  return (
    <div className="border-b border-gray-700/50 last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-800/30 transition-colors">
        {/* Expand/collapse chevron button */}
        <button
          onClick={onToggle}
          className="p-0.5 hover:bg-gray-700/50 rounded transition-colors"
        >
          <ChevronDownIcon
            className={`h-4 w-4 text-gray-500 flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? '' : '-rotate-90'
            }`}
          />
        </button>

        {/* Sheet number and title - clickable to toggle */}
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">
              {sheetDisplay}
            </span>
            {page.pageTitle && page.pageTitle !== sheetDisplay && (
              <span className="text-xs text-gray-500 truncate">
                {page.pageTitle}
              </span>
            )}
          </div>
        </button>

        {/* Right side: expand button + discipline badge + status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Expand to modal button - only show for processed pages */}
          {hasContent && (
            <button
              onClick={onExpand}
              className="p-1.5 hover:bg-gray-700/50 text-gray-500 hover:text-cyan-400 rounded transition-colors"
              title="Preview page"
            >
              <ArrowsPointingOutIcon className="h-4 w-4" />
            </button>
          )}
          <DisciplineBadge code={page.disciplineCode} />
          <PageStatusIndicator status={page.processingStatus} />
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && hasContent && <PageDetail page={page} pointerLookup={pointerLookup} />}
      {isExpanded && !hasContent && (
        <div className="px-3 py-3 bg-gray-800/30 border-t border-gray-700/50">
          <p className="text-sm text-gray-500 italic">Processing not complete yet.</p>
        </div>
      )}
    </div>
  );
};

// Loading skeleton
const LoadingSkeleton: React.FC = () => (
  <div className="p-3 space-y-2">
    {[1, 2, 3, 4, 5].map((i) => (
      <div key={i} className="flex items-center gap-3 p-2">
        <div className="w-4 h-4 bg-gray-700 rounded animate-pulse" />
        <div className="flex-1 h-4 bg-gray-700 rounded animate-pulse" />
        <div className="w-8 h-4 bg-gray-700 rounded animate-pulse" />
      </div>
    ))}
  </div>
);

// Empty state
const EmptyState: React.FC<{ onProcess: () => void }> = ({ onProcess }) => (
  <div className="flex flex-col items-center justify-center h-full text-gray-500 p-6">
    <DocumentIcon className="w-12 h-12 mb-3 opacity-20" />
    <p className="text-sm text-center">No pages processed yet.</p>
    <p className="text-xs text-gray-600 mt-1 text-center mb-4">
      Click Process to analyze your construction documents.
    </p>
    <button
      onClick={onProcess}
      className="px-4 py-2 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors"
    >
      Process Pages
    </button>
  </div>
);

// Error state
const ErrorState: React.FC<{ error: string; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="flex flex-col items-center justify-center h-full p-6">
    <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
      <ExclamationCircleIcon className="w-6 h-6 text-red-400" />
    </div>
    <p className="text-sm text-red-400 text-center mb-1">Error loading pages</p>
    <p className="text-xs text-gray-500 text-center mb-4">{error}</p>
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
    >
      <RefreshIcon className="w-4 h-4" />
      Retry
    </button>
  </div>
);

// =============================================================================
// Main Component
// =============================================================================

export const PagesTab: React.FC<PagesTabProps> = ({ projectId, pointerLookup }) => {
  // Hooks
  const {
    status,
    pass1Progress,
    pass2Progress,
    currentPage,
    startProcessing,
    error: processingError,
  } = usePageProcessing(projectId);
  
  const {
    pages,
    loading,
    error: fetchError,
    refetch,
  } = usePageContexts(projectId);
  
  // Local state for expanded items
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  
  // State for reprocessing
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // State for page preview modal
  const [previewPage, setPreviewPage] = useState<ContextTreePageContext | null>(null);

  // Refs for refetch debouncing
  const refetchRef = useRef(refetch);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastProgressRef = useRef({ pass1: 0, pass2: 0 });
  
  // Keep refetch ref up to date
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);
  
  // Debounced refetch function
  const debouncedRefetch = useCallback(() => {
    // Clear any pending refetch
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    
    // Schedule a new refetch
    debounceTimeoutRef.current = setTimeout(() => {
      refetchRef.current();
    }, REFETCH_DEBOUNCE_MS);
  }, []);
  
  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);
  
  // Refetch pages when processing completes or makes progress
  useEffect(() => {
    const hasProgressChanged = 
      pass1Progress.complete !== lastProgressRef.current.pass1 ||
      pass2Progress.complete !== lastProgressRef.current.pass2;
    
    // Update last progress ref
    lastProgressRef.current = { 
      pass1: pass1Progress.complete, 
      pass2: pass2Progress.complete 
    };
    
    // Trigger refetch on progress change or completion
    if (status === 'complete') {
      // Immediate refetch on completion
      refetchRef.current();
    } else if (hasProgressChanged && (pass1Progress.complete > 0 || pass2Progress.complete > 0)) {
      // Debounced refetch during processing to avoid overwhelming the API
      debouncedRefetch();
    }
  }, [status, pass1Progress.complete, pass2Progress.complete, debouncedRefetch]);
  
  // Toggle page expansion
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
  
  // Handle process button click
  const handleProcessClick = () => {
    setResetError(null);
    startProcessing();
  };
  
  // Handle reprocess button click (reset then process)
  const handleReprocessClick = async () => {
    if (!projectId) return;
    
    setResetError(null);
    setIsResetting(true);
    
    try {
      await resetPageProcessing(projectId);
      // Refetch to update the UI with reset pages
      refetch();
      // Start processing after reset
      startProcessing();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset pages';
      setResetError(msg);
    } finally {
      setIsResetting(false);
    }
  };
  
  // Determine if we should show processing UI
  const isProcessing = status === 'processing';
  const hasProgress = pass1Progress.total > 0 || pass2Progress.total > 0;
  const showProgress = isProcessing || hasProgress;
  
  // Group pages by discipline (optional enhancement)
  const sortedPages = [...pages].sort((a, b) => {
    // Sort by discipline, then by sheet number
    const discA = a.disciplineCode || 'ZZZ';
    const discB = b.disciplineCode || 'ZZZ';
    if (discA !== discB) return discA.localeCompare(discB);
    
    const sheetA = a.sheetNumber || `${a.pageNumber}`;
    const sheetB = b.sheetNumber || `${b.pageNumber}`;
    return sheetA.localeCompare(sheetB, undefined, { numeric: true });
  });
  
  return (
    <div className="flex flex-col h-full">
      {/* Header with processing controls */}
      <div className="flex-none px-4 py-3 border-b border-gray-700 space-y-3">
        {/* Title row with process button */}
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-gray-200">Pages</h3>
          
          {/* Process/Reprocess buttons */}
          <div className="flex items-center gap-2">
            {status === 'complete' && (
              <button
                onClick={handleReprocessClick}
                disabled={isResetting || isProcessing}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  isResetting
                    ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
                title="Reset and reprocess all pages with current annotations"
              >
                {isResetting ? (
                  <>
                    <SpinnerIcon className="w-3.5 h-3.5" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <RefreshIcon className="w-3.5 h-3.5" />
                    Reprocess
                  </>
                )}
              </button>
            )}
            <button
              onClick={handleProcessClick}
              disabled={isProcessing || isResetting || status === 'complete'}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                status === 'complete'
                  ? 'bg-green-600/20 text-green-400 border border-green-500/30'
                  : isProcessing || isResetting
                  ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white'
              }`}
            >
              {status === 'complete' ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5" />
                  Complete
                </>
              ) : isProcessing ? (
                <>
                  <SpinnerIcon className="w-3.5 h-3.5" />
                  Processing...
                </>
              ) : (
                'Process'
              )}
            </button>
          </div>
        </div>
        
        {/* Progress bars */}
        {showProgress && (
          <div className="flex items-center gap-4">
            <ProgressBar 
              label="Pass 1" 
              complete={pass1Progress.complete} 
              total={pass1Progress.total}
              color="bg-blue-500"
            />
            <ProgressBar 
              label="Pass 2" 
              complete={pass2Progress.complete} 
              total={pass2Progress.total}
              color="bg-green-500"
            />
          </div>
        )}
        
        {/* Current page indicator */}
        {isProcessing && currentPage && (
          <div className="text-[10px] text-gray-500">
            Processing: {currentPage.sheetNumber || 'page'} 
            {currentPage.discipline && ` (${currentPage.discipline})`}
          </div>
        )}
        
        {/* Processing error */}
        {processingError && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {processingError}
          </div>
        )}
        
        {/* Reset error */}
        {resetError && (
          <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            <ExclamationCircleIcon className="w-3.5 h-3.5 flex-shrink-0" />
            {resetError}
          </div>
        )}
      </div>
      
      {/* Content area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Loading state */}
        {loading && pages.length === 0 && <LoadingSkeleton />}
        
        {/* Error state */}
        {fetchError && !loading && (
          <ErrorState error={fetchError} onRetry={refetch} />
        )}
        
        {/* Empty state */}
        {!loading && !fetchError && pages.length === 0 && status === 'idle' && (
          <EmptyState onProcess={handleProcessClick} />
        )}
        
        {/* Page list */}
        {pages.length > 0 && (
          <div className="divide-y divide-gray-700/50">
            {sortedPages.map((page) => (
              <PageItem
                key={page.id}
                page={page}
                isExpanded={expandedPages.has(page.id)}
                onToggle={() => togglePage(page.id)}
                onExpand={() => setPreviewPage(page)}
                pointerLookup={pointerLookup}
              />
            ))}
          </div>
        )}
        
        {/* Processing empty state */}
        {pages.length === 0 && isProcessing && (
          <div className="flex flex-col items-center justify-center h-full p-6">
            <SpinnerIcon className="w-8 h-8 text-cyan-400 mb-3" />
            <p className="text-sm text-gray-400">Processing pages...</p>
            <p className="text-xs text-gray-500 mt-1">Pages will appear here as they complete.</p>
          </div>
        )}
      </div>

      {/* Page preview modal */}
      {previewPage && (
        <PagePreviewModal
          page={previewPage}
          onClose={() => setPreviewPage(null)}
          pointerLookup={pointerLookup}
        />
      )}
    </div>
  );
};

export default PagesTab;

