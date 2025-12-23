import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { api } from '../services/api';
import type { ContextPointer, ProjectFile, TextHighlight } from '../types';
import { NarrativeResponse } from './NarrativeResponse';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface Props {
  fileId: string | null;
  highlightedPointerId: string | null;
  activePointerIds: string[];
  activeHighlights?: TextHighlight[];
  narrative?: string | null;
  onDismissNarrative?: () => void;
  showHeader?: boolean;
}

export function PlanViewer({ fileId, highlightedPointerId, activePointerIds, activeHighlights, narrative, onDismissNarrative, showHeader = true }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pdfWrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  const [file, setFile] = useState<ProjectFile | null>(null);
  const [pointers, setPointers] = useState<ContextPointer[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = 100% = fit-to-height
  const [renderZoomLevel, setRenderZoomLevel] = useState<number>(1); // Debounced zoom level for PDF rendering
  const [initialScaleSet, setInitialScaleSet] = useState(false);
  const [basePdfSize, setBasePdfSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // Keep zoom level in a ref for use in wheel handler (avoids stale closure)
  const zoomLevelRef = useRef(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  // Debounce zoom level changes: wait 300ms after zoom stops before re-rendering PDF at actual size
  useEffect(() => {
    const timer = setTimeout(() => {
      setRenderZoomLevel(zoomLevel);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [zoomLevel]);

  // Panning state
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Pinch-to-zoom state
  const pinchStateRef = useRef<{
    initialDistance: number;
    initialZoom: number;
    focalPoint: { x: number; y: number }; // viewport coords of pinch midpoint
    contentPoint: { x: number; y: number }; // content coords at pinch start
  } | null>(null);


  // Track container height with ResizeObserver for accurate measurements
  // Re-run when pdfUrl changes since that's when the container becomes visible
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateHeight = () => {
      const h = el.clientHeight;
      if (h > 0) setContainerHeight(h);
    };
    // Initial measurement after a frame to ensure layout is complete
    requestAnimationFrame(updateHeight);

    const ro = new ResizeObserver(updateHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfUrl]);

  // Track PDF base dimensions for proper scroll wrapper sizing
  useEffect(() => {
    const el = pdfWrapperRef.current;
    if (!el) return;

    const updateSize = () => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) {
        setBasePdfSize({ width: el.offsetWidth, height: el.offsetHeight });
      }
    };
    requestAnimationFrame(updateSize);

    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfUrl, pageNumber]);

  useEffect(() => {
    if (!fileId) {
      setFile(null);
      setPointers([]);
      setPdfUrl(null);
      setError(null);
      setNumPages(0);
      setPageNumber(1);
      setZoomLevel(1);
      setRenderZoomLevel(1);
      setInitialScaleSet(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    setLoading(true);
    setError(null);
    setFile(null);
    setPointers([]);
    setPdfUrl(null);
      setNumPages(0);
      setPageNumber(1);
      setZoomLevel(1);
      setRenderZoomLevel(1);
      setInitialScaleSet(false);

    Promise.all([api.getFile(fileId), api.getContextPointers(fileId), api.downloadFile(fileId)])
      .then(([meta, ptrs, blob]) => {
        if (cancelled) return;
        setFile(meta);
        setPointers(ptrs);
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(api.formatError(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  useEffect(() => {
    if (!highlightedPointerId) return;
    const p = pointers.find((x) => x.id === highlightedPointerId);
    if (p && p.pageNumber && p.pageNumber !== pageNumber) {
      setPageNumber(p.pageNumber);
    }
  }, [highlightedPointerId, pointers, pageNumber]);

  // Mark initial scale as set once we have container height
  useEffect(() => {
    if (containerHeight > 100 && !initialScaleSet) {
      setInitialScaleSet(true);
    }
  }, [containerHeight, initialScaleSet]);

  // PDF renders at debounced zoom level for crisp resolution after zoom stabilizes
  // CSS transform handles smooth zooming during scroll without flicker
  const pdfHeight = containerHeight > 0 ? containerHeight * renderZoomLevel : undefined;

  // Auto-scroll to the right edge on initial load so title block is visible
  useEffect(() => {
    if (initialScaleSet && containerRef.current) {
      const el = containerRef.current;
      // Use double RAF to ensure DOM has fully updated with new scale
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.scrollLeft = el.scrollWidth - el.clientWidth;
        });
      });
    }
  }, [initialScaleSet]);

  const isPdf = useMemo(() => {
    if (!file) return true;
    const ft = (file.fileType || '').toLowerCase();
    if (ft === 'pdf') return true;
    return file.name.toLowerCase().endsWith('.pdf');
  }, [file]);

  const pagePointers = useMemo(
    () => pointers.filter((p) => p.pageNumber === pageNumber),
    [pointers, pageNumber]
  );

  // Only show pointers that are in the activePointerIds list (from query results)
  const visiblePointers = useMemo(
    () => pagePointers.filter((p) => activePointerIds.includes(p.id)),
    [pagePointers, activePointerIds]
  );

  // === Left-click drag to pan ===
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left mouse button (or primary touch)
    if (e.button !== 0) return;
    
    isPanningRef.current = true;
    lastPanPointRef.current = { x: e.clientX, y: e.clientY };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current || !lastPanPointRef.current || !containerRef.current) return;

    const deltaX = e.clientX - lastPanPointRef.current.x;
    const deltaY = e.clientY - lastPanPointRef.current.y;

    containerRef.current.scrollLeft -= deltaX;
    containerRef.current.scrollTop -= deltaY;

    lastPanPointRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    
    isPanningRef.current = false;
    lastPanPointRef.current = null;
    setIsPanning(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  // === Pinch-to-zoom for mobile/tablet ===
  const getDistance = useCallback((t1: Touch, t2: Touch) => {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const container = containerRef.current;
      if (!container) return;
      
      // Start pinch gesture
      const distance = getDistance(e.touches[0], e.touches[1]);
      
      // Calculate midpoint of the two touches
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      const rect = container.getBoundingClientRect();
      
      // Midpoint relative to container viewport
      const viewportX = midX - rect.left;
      const viewportY = midY - rect.top;
      
      // Midpoint in content coordinates
      const contentX = viewportX + container.scrollLeft;
      const contentY = viewportY + container.scrollTop;
      
      pinchStateRef.current = {
        initialDistance: distance,
        initialZoom: zoomLevel,
        focalPoint: { x: viewportX, y: viewportY },
        contentPoint: { x: contentX, y: contentY },
      };
    }
  }, [getDistance, zoomLevel]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStateRef.current) {
      e.preventDefault(); // Prevent default browser zoom
      
      const container = containerRef.current;
      if (!container) return;
      
      const currentDistance = getDistance(e.touches[0], e.touches[1]);
      const scale = currentDistance / pinchStateRef.current.initialDistance;
      const newZoom = Math.min(4, Math.max(0.5, pinchStateRef.current.initialZoom * scale));
      const roundedZoom = Math.round(newZoom * 10) / 10;
      
      // Calculate zoom ratio from initial pinch state
      const zoomRatio = roundedZoom / pinchStateRef.current.initialZoom;
      
      // Calculate new content position for the focal point
      const newContentX = pinchStateRef.current.contentPoint.x * zoomRatio;
      const newContentY = pinchStateRef.current.contentPoint.y * zoomRatio;
      
      // Set zoom level (will trigger re-render)
      setZoomLevel(roundedZoom);
      
      // Adjust scroll to keep focal point under pinch midpoint
      // Use RAF to ensure DOM has updated
      requestAnimationFrame(() => {
        container.scrollLeft = Math.max(0, newContentX - pinchStateRef.current!.focalPoint.x);
        container.scrollTop = Math.max(0, newContentY - pinchStateRef.current!.focalPoint.y);
      });
    }
  }, [getDistance]);

  const handleTouchEnd = useCallback(() => {
    pinchStateRef.current = null;
  }, []);

  // === Scroll wheel zoom with focal point ===
  // Throttle wheel events to ~60fps for smooth zooming
  const lastWheelTimeRef = useRef(0);
  const WHEEL_THROTTLE_MS = 16;
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // Prevent default scroll behavior
      
      // Throttle: skip if too soon after last processed wheel event
      const now = Date.now();
      if (now - lastWheelTimeRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelTimeRef.current = now;

      const rect = container.getBoundingClientRect();
      const currentZoom = zoomLevelRef.current;
      
      // Cursor position relative to container viewport
      const viewportX = e.clientX - rect.left;
      const viewportY = e.clientY - rect.top;
      
      // Cursor position in content coordinates (accounting for current scroll)
      const contentX = viewportX + container.scrollLeft;
      const contentY = viewportY + container.scrollTop;
      
      // Calculate zoom delta: 1% per wheel event for smooth zooming
      // Scroll up (negative deltaY) = zoom in, scroll down = zoom out
      const zoomDelta = e.deltaY > 0 ? -0.08 : 0.08;
      const newZoom = Math.min(4, Math.max(0.5, Math.round((currentZoom + zoomDelta) * 100) / 100));
      const zoomRatio = newZoom / currentZoom;
      
      // Calculate new scroll position to keep point under cursor fixed
      // Content scales from top-left, so: newScrollPos = contentPos * zoomRatio - viewportPos
      const newScrollLeft = Math.max(0, contentX * zoomRatio - viewportX);
      const newScrollTop = Math.max(0, contentY * zoomRatio - viewportY);
      
      // Update zoom level and scroll position
      setZoomLevel(newZoom);
      container.scrollLeft = newScrollLeft;
      container.scrollTop = newScrollTop;
    };

    // Use passive: false to allow preventDefault()
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfUrl]);

  if (!fileId) {
    return (
      <div className="h-full flex items-center justify-center text-slate-500">
        <div className="text-center">
          <div className="text-lg font-medium">Select a plan</div>
          <div className="text-sm mt-1">Choose a sheet from the left panel.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <div className="max-w-xl rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }

  if (!file || !pdfUrl) {
    return null;
  }

  if (!isPdf) {
    return (
      <div className="h-full flex flex-col">
        {showHeader && (
          <div className="px-3 py-2 border-b border-slate-200 bg-white">
            <div className="text-sm font-medium text-slate-900 truncate">{file.name}</div>
          </div>
        )}
        <div className="flex-1 flex items-center justify-center text-slate-600">
          <div className="text-center">
            <div className="text-sm">Preview not available for this file type.</div>
            <a
              className="text-blue-600 hover:underline text-sm"
              href={api.getFileDownloadUrl(fileId)}
              target="_blank"
              rel="noreferrer"
            >
              Download
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {showHeader && (
        <div className="px-3 py-2 border-b border-slate-200 bg-white flex items-center gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 truncate">{file.name}</div>
            <div className="text-xs text-slate-500">
              Page {pageNumber} / {numPages || '…'}{visiblePointers.length > 0 && ` • ${visiblePointers.length} pointer${visiblePointers.length !== 1 ? 's' : ''}`}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="px-2 py-1 text-sm rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="px-2 py-1 text-sm rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))}
              disabled={!!numPages && pageNumber >= numPages}
            >
              Next
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1" />
            <div className="text-sm text-slate-700 w-14 text-center">{Math.round(zoomLevel * 100)}%</div>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className={`flex-1 min-h-0 overflow-auto ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Outer wrapper expands to match zoomed content size for proper scrolling */}
        <div 
          className="inline-block min-w-full"
          style={{
            // This wrapper's size = base PDF size * renderZoomLevel, enabling proper scroll behavior
            width: basePdfSize.width > 0 ? basePdfSize.width * renderZoomLevel : 'auto',
            height: basePdfSize.height > 0 ? basePdfSize.height * renderZoomLevel : 'auto',
          }}
        >
          <Document
            file={pdfUrl}
            onLoadSuccess={(info) => {
              setNumPages(info.numPages);
              setPageNumber((p) => Math.min(Math.max(1, p), info.numPages));
            }}
            onLoadError={(e) => setError(api.formatError(e))}
            loading={null}
          >
            <div
              ref={pdfWrapperRef}
              className="relative inline-block touch-none"
              style={{
                transform: `scale(${zoomLevel / renderZoomLevel})`,
                transformOrigin: 'top left',
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <Page
                pageNumber={pageNumber}
                height={pdfHeight}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                loading={null}
              />
              <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10, transform: 'translateZ(0)' }}>
                {visiblePointers.map((p) => {
                  const isHighlighted = p.id === highlightedPointerId;
                  const strokeWidth = Math.max(1, p.style?.strokeWidth ?? 2);
                  // Get highlights for this specific pointer
                  // Get highlights for this specific pointer (API returns snake_case keys)
                  const pointerHighlights = activeHighlights?.filter((h: any) => h.pointer_id === p.id) || [];
                  
                  return (
                    <div
                      key={p.id}
                      title={p.title}
                      className={[
                        'absolute rounded-sm',
                        isHighlighted ? 'ring-2 ring-yellow-400' : '',
                      ].join(' ')}
                      style={{
                        left: `${p.bounds.xNorm * 100}%`,
                        top: `${p.bounds.yNorm * 100}%`,
                        width: `${p.bounds.wNorm * 100}%`,
                        height: `${p.bounds.hNorm * 100}%`,
                        border: `${strokeWidth}px solid`,
                        borderImage: 'linear-gradient(to right, #3b82f6, #06b6d4) 1',
                        background: 'transparent',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Render text highlights within this pointer */}
                      {pointerHighlights.map((highlight: any, idx: number) => (
                        <div
                          key={`highlight-${idx}`}
                          className="absolute"
                          style={{
                            left: `${highlight.bbox_normalized.x * 100}%`,
                            top: `${highlight.bbox_normalized.y * 100}%`,
                            width: `${highlight.bbox_normalized.width * 100}%`,
                            height: `${highlight.bbox_normalized.height * 100}%`,
                            backgroundColor: 'rgba(255, 255, 0, 0.4)',
                            border: '1px solid rgba(255, 200, 0, 0.8)',
                            borderRadius: '2px',
                          }}
                          title={highlight.matched_text}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </Document>
        </div>
      </div>

      {/* Narrative response overlay */}
      {onDismissNarrative && (
        <NarrativeResponse narrative={narrative ?? null} onDismiss={onDismissNarrative} />
      )}
    </div>
  );
}


