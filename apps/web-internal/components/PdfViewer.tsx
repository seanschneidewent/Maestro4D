import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Rnd } from 'react-rnd';
import { DocumentIcon, PenIcon, TextIcon, ArrowToolIcon, RectangleIcon, UndoIcon, RedoIcon, TrashIcon, ZoomInIcon, ZoomOutIcon, ZoomResetIcon, PencilIcon, CloseIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';
import { PdfAnnotation, PdfStroke } from '../types';
import { ContextPointer } from '../types/context';

// Set up PDF.js worker - use the version that matches react-pdf's bundled pdfjs-dist
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

export interface PdfToolbarHandlers {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  textColor: string;
  onTextColorClick: (color: string) => void;
  rectangleColor: string;
  onRectangleColorChange: (color: string) => void;
  effectiveTextColor: string;
  pageAnnotations: Record<number, PageAnnotations>;
  currentPage: number;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onUploadClick: () => void;
  isToolbarExpanded: boolean;
  onToolbarExpandedChange: (expanded: boolean) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  effectiveFontSize: number;
}

interface PdfViewerProps {
  pdfUrl?: string;
  onPdfUpload?: (url: string) => void;
  annotations?: Record<number, PdfAnnotation[]>;
  onAnnotationsChange?: (annotations: Record<number, PdfAnnotation[]>) => void;
  isToolsOpen?: boolean;
  onToolsOpenChange?: (open: boolean) => void;
  onToolbarHandlersReady?: (handlers: PdfToolbarHandlers) => void;
  renderToolbarExternally?: boolean;
  toolbarRef?: React.RefObject<HTMLDivElement>;
  // Unified ContextPointer system for rectangles
  pointers?: ContextPointer[];
  onPointerCreate?: (pointer: Omit<ContextPointer, 'title' | 'description'>) => void;
  visibleRectangleIds?: Set<string>;
}

export type Tool = 'pen' | 'text' | 'arrow' | 'rectangle';

interface NormalizedPoint {
  xNorm: number;
  yNorm: number;
}

export interface PageAnnotations {
  annotations: PdfAnnotation[];
  undoStack: PdfAnnotation[][];
  redoStack: PdfAnnotation[][];
}

interface TextDraft {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface ArrowDraft {
  headX: number;  // Arrow tip (pointer-down point)
  headY: number;
  tailX: number;   // Arrow back (pointer-up point, text box location)
  tailY: number;
}

interface RectangleDraft {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface TextAnnotationEditorProps {
  annotation: Extract<PdfAnnotation, { kind: 'text' }> | Extract<PdfAnnotation, { kind: 'arrow' }>;
  isEditing: boolean;
  isAnnotationEnabled: boolean;
  editorRefs: React.MutableRefObject<Record<string, HTMLDivElement>>;
  onInput: (e: React.FormEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onBlur: (e: React.FocusEvent<HTMLDivElement>) => void;
  getAnnotationHtml: (annotation: Extract<PdfAnnotation, { kind: 'text' }> | Extract<PdfAnnotation, { kind: 'arrow' }>) => string;
}

// Component to handle contenteditable text annotation
const TextAnnotationEditor: React.FC<TextAnnotationEditorProps> = ({
  annotation,
  isEditing,
  isAnnotationEnabled,
  editorRefs,
  onInput,
  onFocus,
  onBlur,
  getAnnotationHtml,
}) => {
  const lastHtmlRef = useRef<string>('');

  // Sync HTML when annotation changes externally (not from user input)
  useEffect(() => {
    const editor = editorRefs.current[annotation.id];
    if (!editor || isEditing) return;

    const expectedHtml = getAnnotationHtml(annotation);
    if (editor.innerHTML !== expectedHtml && lastHtmlRef.current !== expectedHtml) {
      editor.innerHTML = expectedHtml;
      lastHtmlRef.current = expectedHtml;
    }
  }, [annotation, isEditing, editorRefs, getAnnotationHtml]);

  return (
    <div
      ref={(el) => {
        if (el) {
          editorRefs.current[annotation.id] = el;
          // Initialize HTML on mount
          if (!isEditing) {
            const html = getAnnotationHtml(annotation);
            el.innerHTML = html;
            lastHtmlRef.current = html;
          }
        } else {
          delete editorRefs.current[annotation.id];
        }
      }}
      contentEditable={isAnnotationEnabled}
      suppressContentEditableWarning
      onInput={(e) => {
        if (!isAnnotationEnabled) return;
        const editor = editorRefs.current[annotation.id];
        if (editor) {
          lastHtmlRef.current = editor.innerHTML;
        }
        onInput(e);
      }}
      onFocus={() => {
        if (!isAnnotationEnabled) return;
        onFocus();
      }}
      onBlur={onBlur}
      role="textbox"
      aria-multiline="true"
      className="bg-transparent border border-cyan-500 resize-none p-1 focus:outline-none focus:ring-2 focus:ring-cyan-400 whitespace-pre-wrap overflow-auto w-full h-full"
      style={{
        fontSize: `${annotation.fontSize || 14}px`,
        color: annotation.kind === 'arrow' ? (annotation.textColor || '#000000') : (annotation.color || '#000000'),
        pointerEvents: isAnnotationEnabled ? 'auto' : 'none',
      }}
    />
  );
};

const PdfViewer: React.FC<PdfViewerProps> = ({ pdfUrl, onPdfUpload, annotations, onAnnotationsChange, isToolsOpen: controlledIsToolsOpen, onToolsOpenChange, onToolbarHandlersReady, renderToolbarExternally, toolbarRef, pointers, onPointerCreate, visibleRectangleIds }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef<{ x: number; y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pdfLoaded, setPdfLoaded] = useState(!!pdfUrl);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [scale, setScale] = useState<number>(1);

  // Annotation state
  const [tool, setTool] = useState<Tool>('pen');
  const [penStrokeColor, setPenStrokeColor] = useState<string>('#3b82f6'); // blue-500
  const [arrowStrokeColor, setArrowStrokeColor] = useState<string>('#000000'); // black
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [textColor, setTextColor] = useState<string>('#000000');
  const [rectangleColor, setRectangleColor] = useState<string>('#ef4444');
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentStroke, setCurrentStroke] = useState<NormalizedPoint[]>([]);
  const [pageAnnotations, setPageAnnotations] = useState<Record<number, PageAnnotations>>({});
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const [arrowDraft, setArrowDraft] = useState<ArrowDraft | null>(null);
  const [rectangleDraft, setRectangleDraft] = useState<RectangleDraft | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [internalIsToolsOpen, setInternalIsToolsOpen] = useState<boolean>(false);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState<boolean>(true);
  const [fontSize, setFontSize] = useState<number>(14);

  // Use controlled state if provided, otherwise use internal state
  const isToolsOpen = controlledIsToolsOpen !== undefined ? controlledIsToolsOpen : internalIsToolsOpen;
  const setIsToolsOpen = (open: boolean) => {
    if (onToolsOpenChange) {
      onToolsOpenChange(open);
    } else {
      setInternalIsToolsOpen(open);
    }
  };

  // Annotation is only enabled when tools panel is expanded
  const isAnnotationEnabled = isToolsOpen;

  // Reset toolbar expanded state when tools panel opens
  useEffect(() => {
    if (isToolsOpen) {
      setIsToolbarExpanded(true);
    }
  }, [isToolsOpen]);

  // Clear editing state when tools close
  useEffect(() => {
    if (!isToolsOpen && editingTextId) {
      setEditingTextId(null);
    }
  }, [isToolsOpen, editingTextId]);

  // Auto-focus text editor when editingTextId changes (especially for new arrow annotations)
  useEffect(() => {
    if (editingTextId) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        const editor = editorRefs.current[editingTextId];
        if (editor) {
          editor.focus();
          // Place cursor at the end of any existing text
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      });
    }
  }, [editingTextId]);

  // Helper function to handle tool switching
  const handleToolChange = useCallback((newTool: Tool) => {
    setTool(newTool);
  }, []);

  // Compute active stroke color based on current tool
  const activeStrokeColor = useMemo(() => {
    return tool === 'arrow' ? arrowStrokeColor : penStrokeColor;
  }, [tool, penStrokeColor, arrowStrokeColor]);

  // Handle stroke color change - update the appropriate color based on current tool
  const handleStrokeColorChange = useCallback((color: string) => {
    if (tool === 'arrow') {
      setArrowStrokeColor(color);
    } else {
      setPenStrokeColor(color);
    }
  }, [tool]);

  // Refs for canvas overlays
  const canvasRefs = useRef<Record<number, HTMLCanvasElement>>({});
  const pageContainerRefs = useRef<Record<number, HTMLDivElement>>({});
  const pageWrapperRefs = useRef<Record<number, HTMLDivElement>>({});
  const editorRefs = useRef<Record<string, HTMLDivElement>>({});
  const lastPdfUrlRef = useRef<string | undefined>(undefined);
  const resizeTimeoutRef = useRef<number | null>(null);
  const baseWidthRef = useRef<number | null>(null);
  const basePageDimensionsRef = useRef<Record<number, { width: number; height: number }>>({});
  const pageRefs = useRef<Record<number, HTMLDivElement>>({});

  // Debounced container width update - snaps after panel animation completes
  const scheduleSnapWidthUpdate = useCallback(() => {
    if (resizeTimeoutRef.current) window.clearTimeout(resizeTimeoutRef.current);
    resizeTimeoutRef.current = window.setTimeout(() => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth - 32; // Account for padding
      setContainerWidth(Math.max(300, width));
    }, 320); // Match/tail the 300ms panel animation
  }, []);

  // Update container width on resize (including panel toggles) - debounced to snap after animation
  useEffect(() => {
    // Initial measurement
    if (containerRef.current) {
      const width = containerRef.current.clientWidth - 32;
      setContainerWidth(Math.max(300, width));
    }

    const resizeObserver = new ResizeObserver(() => {
      scheduleSnapWidthUpdate();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', scheduleSnapWidthUpdate);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleSnapWidthUpdate);
      if (resizeTimeoutRef.current) window.clearTimeout(resizeTimeoutRef.current);
    };
  }, [scheduleSnapWidthUpdate]);

  // Initialize annotations from props when PDF URL changes (scan switch)
  useEffect(() => {
    setIsToolsOpen(false);

    const pdfUrlChanged = pdfUrl !== lastPdfUrlRef.current;
    lastPdfUrlRef.current = pdfUrl;

    if (pdfUrlChanged) {
      if (pdfUrl && annotations) {
        // Convert annotations prop to internal PageAnnotations format
        const newPageAnnotations: Record<number, PageAnnotations> = {};
        Object.entries(annotations).forEach(([pageStr, annots]) => {
          const pageNum = parseInt(pageStr, 10);
          // Convert legacy strokes (with tool property) to new format
          const annotsArray = annots as PdfAnnotation[];
          const convertedAnnotations: PdfAnnotation[] = annotsArray.map((a: any) => {
            if ('kind' in a) {
              return a as PdfAnnotation;
            }
            // Legacy stroke format
            return {
              kind: 'stroke',
              points: a.points,
              color: a.color,
              width: a.width,
            } as PdfAnnotation;
          });
          newPageAnnotations[pageNum] = {
            annotations: convertedAnnotations,
            undoStack: [],
            redoStack: [],
          };
        });
        setPageAnnotations(newPageAnnotations);
      } else {
        // PDF changed but no annotations - clear
        setPageAnnotations({});
      }
      setPdfLoaded(!!pdfUrl);
      setError(null);
      setScale(1);
      setCurrentPage(1);

      // Capture base width when PDF URL changes
      if (pdfUrl && containerRef.current) {
        const width = containerRef.current.clientWidth - 32;
        baseWidthRef.current = Math.max(300, width);
        basePageDimensionsRef.current = {}; // Reset page dimensions
      } else {
        baseWidthRef.current = null;
        basePageDimensionsRef.current = {};
      }
    }
  }, [pdfUrl]); // Only depend on pdfUrl to avoid update loop with annotations prop

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setError('Please upload a valid PDF file.');
        return;
      }
      const url = URL.createObjectURL(file);
      if (onPdfUpload) {
        onPdfUpload(url);
      }
      setPdfLoaded(true);
      setError(null);
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setError(null);
  };

  const onDocumentLoadError = (error: Error) => {
    setError(`Failed to load PDF: ${error.message}`);
  };

  // Redraw all strokes for a page
  const redrawPage = useCallback((pageNumber: number) => {
    const canvas = canvasRefs.current[pageNumber];
    const annotations = pageAnnotations[pageNumber]?.annotations || [];
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw internal annotations (strokes, arrows - NOT rectangles)
    annotations.forEach((annotation) => {
      if (annotation.kind === 'stroke') {
        if (annotation.points.length === 0) return;

        ctx.beginPath();
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = annotation.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';

        const firstPoint = annotation.points[0];
        ctx.moveTo(firstPoint.xNorm * canvas.width, firstPoint.yNorm * canvas.height);

        for (let i = 1; i < annotation.points.length; i++) {
          const point = annotation.points[i];
          ctx.lineTo(point.xNorm * canvas.width, point.yNorm * canvas.height);
        }

        ctx.stroke();
      } else if (annotation.kind === 'arrow') {
        // Draw arrow line
        const startX = annotation.startXNorm * canvas.width;
        const startY = annotation.startYNorm * canvas.height;
        const endX = annotation.endXNorm * canvas.width;
        const endY = annotation.endYNorm * canvas.height;

        ctx.beginPath();
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = annotation.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';

        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Draw arrowhead
        const angle = Math.atan2(endY - startY, endX - startX);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;

        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowLength * Math.cos(angle - arrowAngle),
          endY - arrowLength * Math.sin(angle - arrowAngle)
        );
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowLength * Math.cos(angle + arrowAngle),
          endY - arrowLength * Math.sin(angle + arrowAngle)
        );
        ctx.stroke();
      }
      // Text annotations are rendered as DOM overlays, not on canvas
      // Rectangles are now rendered from pointers prop below
    });

    // Draw rectangles from pointers prop (unified ContextPointer system)
    const pagePointers = (pointers || []).filter(p => p.pageNumber === pageNumber);
    pagePointers.forEach((pointer) => {
      // Check if this rectangle should be visible
      if (visibleRectangleIds && !visibleRectangleIds.has(pointer.id)) {
        return; // Skip rendering this rectangle
      }

      const x = pointer.bounds.xNorm * canvas.width;
      const y = pointer.bounds.yNorm * canvas.height;
      const w = pointer.bounds.wNorm * canvas.width;
      const h = pointer.bounds.hNorm * canvas.height;

      ctx.beginPath();

      // Create radial gradient for stroke
      const centerX = x + w / 2;
      const centerY = y + h / 2;
      const radius = Math.sqrt(w * w + h * h) / 2;

      const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      gradient.addColorStop(0, '#3b82f6'); // Blue
      gradient.addColorStop(1, '#06b6d4'); // Cyan

      ctx.strokeStyle = gradient;
      ctx.lineWidth = pointer.style.strokeWidth;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeRect(x, y, w, h);
    });
  }, [pageAnnotations, pointers, visibleRectangleIds]);

  // Initialize overlay canvas size once at base dimensions
  const initBaseSize = useCallback((pageNumber: number) => {
    const canvas = canvasRefs.current[pageNumber];
    const wrapper = pageWrapperRefs.current[pageNumber];
    if (canvas && wrapper && baseWidthRef.current && containerWidth) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        // Capture base dimensions on first render (at current scale)
        if (!basePageDimensionsRef.current[pageNumber]) {
          // Store the base dimensions at scale=1 for consistent coordinate system
          // wrapper.clientWidth is now containerWidth * scale, so divide by scale
          const currentDisplayScale = containerWidth / baseWidthRef.current;
          basePageDimensionsRef.current[pageNumber] = {
            width: wrapper.clientWidth / (scale * currentDisplayScale),
            height: wrapper.clientHeight / (scale * currentDisplayScale),
          };
        }

        // Set canvas to actual rendered dimensions (includes scale for high resolution)
        canvas.width = wrapper.clientWidth;
        canvas.height = wrapper.clientHeight;

        // Position canvas to fill wrapper (already positioned via CSS)
        canvas.style.position = 'absolute';
        canvas.style.left = '0px';
        canvas.style.top = '0px';
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        redrawPage(pageNumber);
      });
    }
  }, [redrawPage, scale, containerWidth]);

  // Update canvas size when scale changes
  useEffect(() => {
    Object.keys(canvasRefs.current).forEach((pageNumStr) => {
      const pageNum = parseInt(pageNumStr, 10);
      const canvas = canvasRefs.current[pageNum];
      const wrapper = pageWrapperRefs.current[pageNum];
      const baseDims = basePageDimensionsRef.current[pageNum];
      
      if (canvas && wrapper && baseDims) {
        // Update canvas resolution to match new scale
        canvas.width = wrapper.clientWidth;
        canvas.height = wrapper.clientHeight;
        redrawPage(pageNum);
      }
    });
  }, [scale, redrawPage]);

  // Update redraw when annotations or pointers change
  useEffect(() => {
    Object.keys(canvasRefs.current).forEach((pageNumStr) => {
      const pageNum = parseInt(pageNumStr, 10);
      redrawPage(pageNum);
    });
  }, [pageAnnotations, pointers, redrawPage]);

  // Emit annotations to parent when pageAnnotations change
  useEffect(() => {
    if (!onAnnotationsChange) return;
    const annotationsByPage: Record<number, PdfAnnotation[]> = {};
    Object.entries(pageAnnotations).forEach(([pageStr, pageData]) => {
      const pageNum = parseInt(pageStr, 10);
      const pageDataTyped = pageData as PageAnnotations;
      annotationsByPage[pageNum] = pageDataTyped.annotations;
    });
    onAnnotationsChange(annotationsByPage);
  }, [pageAnnotations, onAnnotationsChange]);

  // Get normalized coordinates from pointer event
  const getNormalizedPoint = (e: React.PointerEvent<HTMLCanvasElement>, pageNumber: number): NormalizedPoint | null => {
    const canvas = canvasRefs.current[pageNumber];
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { xNorm: Math.max(0, Math.min(1, x)), yNorm: Math.max(0, Math.min(1, y)) };
  };

  // Capture snapshot of PDF page region as PNG data URL at 150 DPI (print quality)
  // Storage format: PNG data URLs (image/png) are stored inline for quick embedding
  // These are then packaged into the generated PDF (application/pdf) for download/sharing
  const capturePageSnapshot = useCallback(async (pageNumber: number, xNorm: number, yNorm: number, wNorm: number, hNorm: number): Promise<string | null> => {
    if (!pdfUrl) return null;

    try {
      // Load the PDF document directly using PDF.js for high-resolution rendering
      const loadingTask = pdfjs.getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      
      // Get the specific page
      const page = await pdf.getPage(pageNumber);
      
      // Calculate scale for 150 DPI (PDF uses 72 points per inch)
      // 150 DPI / 72 PPI = ~2.08 scale factor
      const DPI_SCALE = 150 / 72;
      
      // Get the viewport at 150 DPI scale
      const viewport = page.getViewport({ scale: DPI_SCALE });
      
      // Create an offscreen canvas at the high-resolution dimensions
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = viewport.width;
      fullCanvas.height = viewport.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return null;

      // Render the page to the offscreen canvas at high resolution
      await page.render({
        canvasContext: fullCtx,
        viewport: viewport,
      }).promise;

      // Calculate pixel coordinates from normalized coordinates using high-res dimensions
      const canvasWidth = fullCanvas.width;
      const canvasHeight = fullCanvas.height;
      
      const x = Math.floor(xNorm * canvasWidth);
      const y = Math.floor(yNorm * canvasHeight);
      const w = Math.floor(wNorm * canvasWidth);
      const h = Math.floor(hNorm * canvasHeight);

      // Ensure coordinates are within bounds
      const clampedX = Math.max(0, Math.min(x, canvasWidth));
      const clampedY = Math.max(0, Math.min(y, canvasHeight));
      const clampedW = Math.min(w, canvasWidth - clampedX);
      const clampedH = Math.min(h, canvasHeight - clampedY);

      if (clampedW <= 0 || clampedH <= 0) return null;

      // Create a temporary canvas to extract the region
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = clampedW;
      tempCanvas.height = clampedH;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return null;

      // Draw the region from high-res canvas to temp canvas
      tempCtx.drawImage(
        fullCanvas,
        clampedX, clampedY, clampedW, clampedH,
        0, 0, clampedW, clampedH
      );

      // Convert to PNG data URL
      return tempCanvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error capturing page snapshot:', error);
      return null;
    }
  }, [pdfUrl]);

  // Calculate the nearest border midpoint for arrow attachment
  const getClosestBorderAnchor = useCallback((
    boxX: number,
    boxY: number,
    boxW: number,
    boxH: number,
    targetX: number,
    targetY: number
  ): { xNorm: number; yNorm: number } => {
    // Calculate center of the box
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;

    // Calculate direction vector from box center to target point
    const dx = targetX - centerX;
    const dy = targetY - centerY;

    // Calculate border midpoints
    const borders = [
      { x: centerX, y: boxY, name: 'top' },           // Top border center
      { x: centerX, y: boxY + boxH, name: 'bottom' }, // Bottom border center
      { x: boxX, y: centerY, name: 'left' },          // Left border center
      { x: boxX + boxW, y: centerY, name: 'right' }   // Right border center
    ];

    // Find which border the arrow direction points toward most directly
    // We'll use the angle to determine which edge is most appropriate
    const angle = Math.atan2(dy, dx);

    // Determine which border based on angle
    // Right: -45° to 45° (-π/4 to π/4)
    // Bottom: 45° to 135° (π/4 to 3π/4)
    // Left: 135° to -135° (3π/4 to -3π/4)
    // Top: -135° to -45° (-3π/4 to -π/4)

    let anchor;
    if (angle >= -Math.PI / 4 && angle < Math.PI / 4) {
      // Arrow points right
      anchor = borders[3]; // right
    } else if (angle >= Math.PI / 4 && angle < 3 * Math.PI / 4) {
      // Arrow points down
      anchor = borders[1]; // bottom
    } else if (angle >= 3 * Math.PI / 4 || angle < -3 * Math.PI / 4) {
      // Arrow points left
      anchor = borders[2]; // left
    } else {
      // Arrow points up
      anchor = borders[0]; // top
    }

    return { xNorm: anchor.x, yNorm: anchor.y };
  }, []);

  // Start drawing, text draft, or panning
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>, pageNumber: number) => {
    // Handle right-click panning (only when zoomed in)
    if (e.button === 2 && scale > 1) {
      e.preventDefault();
      isPanningRef.current = true;
      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      const canvas = canvasRefs.current[pageNumber];
      if (canvas) {
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
      }
      return;
    }

    if (!isAnnotationEnabled) return;

    e.preventDefault();
    const point = getNormalizedPoint(e, pageNumber);
    if (!point) return;

    setCurrentPage(pageNumber);

    if (tool === 'pen') {
      setIsDrawing(true);
      setCurrentStroke([point]);
    } else if (tool === 'text') {
      const canvas = canvasRefs.current[pageNumber];
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setTextDraft({
        startX: point.xNorm,
        startY: point.yNorm,
        endX: point.xNorm,
        endY: point.yNorm,
      });
      setIsDrawing(true);
    } else if (tool === 'arrow') {
      setArrowDraft({
        headX: point.xNorm,  // Arrow tip at pointer-down
        headY: point.yNorm,
        tailX: point.xNorm,   // Tail starts same, will move with cursor
        tailY: point.yNorm,
      });
      setIsDrawing(true);
    } else if (tool === 'rectangle') {
      setRectangleDraft({
        startX: point.xNorm,
        startY: point.yNorm,
        endX: point.xNorm,
        endY: point.yNorm,
      });
      setIsDrawing(true);
    }

    const canvas = canvasRefs.current[pageNumber];
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
    }
  };

  // Continue drawing, text draft, or panning
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>, pageNumber: number) => {
    // Handle panning
    if (isPanningRef.current && lastPanPointRef.current && scrollContainerRef.current) {
      e.preventDefault();
      const deltaX = e.clientX - lastPanPointRef.current.x;
      const deltaY = e.clientY - lastPanPointRef.current.y;

      // console.log('Panning:', { deltaX, deltaY, scrollLeft: scrollContainerRef.current.scrollLeft, scrollTop: scrollContainerRef.current.scrollTop, scrollHeight: scrollContainerRef.current.scrollHeight, clientHeight: scrollContainerRef.current.clientHeight });

      scrollContainerRef.current.scrollLeft -= deltaX;
      scrollContainerRef.current.scrollTop -= deltaY;

      lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDrawing || pageNumber !== currentPage) return;

    const point = getNormalizedPoint(e, pageNumber);
    if (!point) return;

    const canvas = canvasRefs.current[pageNumber];
    if (!canvas) return;

    if (tool === 'pen') {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const newStroke = [...currentStroke, point];
      setCurrentStroke(newStroke);

      // Draw current stroke
      if (newStroke.length >= 2) {
        ctx.beginPath();
        ctx.strokeStyle = penStrokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalCompositeOperation = 'source-over';

        const prevPoint = newStroke[newStroke.length - 2];
        const currPoint = newStroke[newStroke.length - 1];
        ctx.moveTo(prevPoint.xNorm * canvas.width, prevPoint.yNorm * canvas.height);
        ctx.lineTo(currPoint.xNorm * canvas.width, currPoint.yNorm * canvas.height);
        ctx.stroke();
      }
    } else if (tool === 'text' && textDraft) {
      setTextDraft({
        ...textDraft,
        endX: point.xNorm,
        endY: point.yNorm,
      });
    } else if (tool === 'arrow' && arrowDraft) {
      setArrowDraft({
        ...arrowDraft,
        tailX: point.xNorm,  // Tail follows cursor (will be text box location)
        tailY: point.yNorm,
      });
    } else if (tool === 'rectangle' && rectangleDraft) {
      setRectangleDraft({
        ...rectangleDraft,
        endX: point.xNorm,
        endY: point.yNorm,
      });
    }
  };

  // Finish drawing, text draft, or panning
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>, pageNumber: number) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      lastPanPointRef.current = null;
      const canvas = canvasRefs.current[pageNumber];
      if (canvas) {
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = isAnnotationEnabled ? 'crosshair' : 'default';
      }
      return;
    }

    if (!isDrawing || pageNumber !== currentPage) return;

    setIsDrawing(false);

    if (tool === 'pen' && currentStroke.length > 0) {
      const annotation: PdfAnnotation = {
        kind: 'stroke',
        points: currentStroke,
        color: penStrokeColor,
        width: strokeWidth,
      };

      setPageAnnotations((prev) => {
        const pageData = prev[pageNumber] || { annotations: [], undoStack: [], redoStack: [] };
        const newAnnotations = [...pageData.annotations, annotation];
        const newUndoStack = [...pageData.undoStack, pageData.annotations];

        return {
          ...prev,
          [pageNumber]: {
            annotations: newAnnotations,
            undoStack: newUndoStack.slice(-50), // Keep last 50 states
            redoStack: [], // Clear redo stack on new action
          },
        };
      });
      setCurrentStroke([]);
    } else if (tool === 'text' && textDraft) {
      // Create text box from draft
      const minSize = 0.02; // Minimum 2% of page size
      const x = Math.min(textDraft.startX, textDraft.endX);
      const y = Math.min(textDraft.startY, textDraft.endY);
      const w = Math.max(Math.abs(textDraft.endX - textDraft.startX), minSize);
      const h = Math.max(Math.abs(textDraft.endY - textDraft.startY), minSize);

      const textId = `text-${Date.now()}-${Math.random()}`;
      const annotation: PdfAnnotation = {
        kind: 'text',
        id: textId,
        xNorm: x,
        yNorm: y,
        wNorm: w,
        hNorm: h,
        text: '',
        html: '',
        color: textColor,
        fontSize: fontSize,
      };

      setPageAnnotations((prev) => {
        const pageData = prev[pageNumber] || { annotations: [], undoStack: [], redoStack: [] };
        const newAnnotations = [...pageData.annotations, annotation];
        const newUndoStack = [...pageData.undoStack, pageData.annotations];

        return {
          ...prev,
          [pageNumber]: {
            annotations: newAnnotations,
            undoStack: newUndoStack.slice(-50),
            redoStack: [],
          },
        };
      });

      setTextDraft(null);
      setEditingTextId(textId);
    } else if (tool === 'arrow' && arrowDraft) {
      // Create arrow annotation with text box from draft
      const arrowId = `arrow-${Date.now()}-${Math.random()}`;

      // Position text box at the tail (release point, back end) of the arrow
      const minSize = 0.08; // Minimum text box size (8% of page)
      const textBoxWidth = minSize;
      const textBoxHeight = minSize * 0.5; // Half the width for aspect ratio

      // Center text box on arrow tail (release point)
      const textX = arrowDraft.tailX - textBoxWidth / 2;
      const textY = arrowDraft.tailY - textBoxHeight / 2;

      // Calculate the closest border anchor point for the arrow tail
      // Anchor should point toward the head (tip)
      const anchor = getClosestBorderAnchor(
        textX,
        textY,
        textBoxWidth,
        textBoxHeight,
        arrowDraft.headX,
        arrowDraft.headY
      );

      const annotation: PdfAnnotation = {
        kind: 'arrow',
        id: arrowId,
        startXNorm: anchor.xNorm,  // Arrow line starts at text box border anchor
        startYNorm: anchor.yNorm,
        endXNorm: arrowDraft.headX, // Arrow tip at head (pointer-down point)
        endYNorm: arrowDraft.headY,
        color: arrowStrokeColor,
        width: strokeWidth,
        xNorm: textX,
        yNorm: textY,
        wNorm: textBoxWidth,
        hNorm: textBoxHeight,
        text: '',
        html: '',
        textColor: textColor,
        fontSize: fontSize,
      };

      setPageAnnotations((prev) => {
        const pageData = prev[pageNumber] || { annotations: [], undoStack: [], redoStack: [] };
        const newAnnotations = [...pageData.annotations, annotation];
        const newUndoStack = [...pageData.undoStack, pageData.annotations];

        return {
          ...prev,
          [pageNumber]: {
            annotations: newAnnotations,
            undoStack: newUndoStack.slice(-50),
            redoStack: [],
          },
        };
      });

      setArrowDraft(null);
      setEditingTextId(arrowId);
    } else if (tool === 'rectangle' && rectangleDraft) {
      const minSize = 0.005;
      const x = Math.min(rectangleDraft.startX, rectangleDraft.endX);
      const y = Math.min(rectangleDraft.startY, rectangleDraft.endY);
      const w = Math.max(Math.abs(rectangleDraft.endX - rectangleDraft.startX), minSize);
      const h = Math.max(Math.abs(rectangleDraft.endY - rectangleDraft.startY), minSize);

      const pointerId = `pointer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Capture snapshot and create pointer via callback
      capturePageSnapshot(pageNumber, x, y, w, h).then((snapshotDataUrl) => {
        if (onPointerCreate) {
          const pointer: Omit<ContextPointer, 'title' | 'description'> = {
            id: pointerId,
            pageNumber: pageNumber,
            bounds: {
              xNorm: x,
              yNorm: y,
              wNorm: w,
              hNorm: h,
            },
            style: {
              color: rectangleColor,
              strokeWidth: strokeWidth,
            },
            snapshotDataUrl: snapshotDataUrl,
            createdAt: new Date().toISOString(),
          };
          onPointerCreate(pointer);
        }
      });

      setRectangleDraft(null);
    }

    const canvas = canvasRefs.current[pageNumber];
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }
  };

  // Undo last annotation
  const handleUndo = () => {
    const pageData = pageAnnotations[currentPage];
    if (!pageData || pageData.undoStack.length === 0) return;

    const previousAnnotations = pageData.undoStack[pageData.undoStack.length - 1];
    const newUndoStack = pageData.undoStack.slice(0, -1);
    const newRedoStack = [...pageData.redoStack, pageData.annotations];

    setPageAnnotations((prev) => ({
      ...prev,
      [currentPage]: {
        annotations: previousAnnotations,
        undoStack: newUndoStack,
        redoStack: newRedoStack.slice(-50),
      },
    }));
  };

  // Redo last undone annotation
  const handleRedo = () => {
    const pageData = pageAnnotations[currentPage];
    if (!pageData || pageData.redoStack.length === 0) return;

    const nextAnnotations = pageData.redoStack[pageData.redoStack.length - 1];
    const newRedoStack = pageData.redoStack.slice(0, -1);
    const newUndoStack = [...pageData.undoStack, pageData.annotations];

    setPageAnnotations((prev) => ({
      ...prev,
      [currentPage]: {
        annotations: nextAnnotations,
        undoStack: newUndoStack.slice(-50),
        redoStack: newRedoStack,
      },
    }));
  };

  // Clear current page
  const handleClear = () => {
    setPageAnnotations((prev) => {
      const pageData = prev[currentPage] || { annotations: [], undoStack: [], redoStack: [] };
      return {
        ...prev,
        [currentPage]: {
          annotations: [],
          undoStack: [...pageData.undoStack, pageData.annotations].slice(-50),
          redoStack: [],
        },
      };
    });
  };

  // Zoom controls
  const handleZoomIn = () => setScale((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setScale((prev) => Math.max(prev - 0.25, 0.5));
  const handleZoomReset = () => setScale(1);

  // HTML sanitizer - allows only span, br, and color style
  const sanitizeHtml = useCallback((html: string): string => {
    if (!html) return '';

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const allowedTags = ['SPAN', 'BR'];

    // Collect all elements first (to avoid modifying while iterating)
    const allElements: Element[] = [];
    const walker = doc.createTreeWalker(
      doc.body,
      NodeFilter.SHOW_ELEMENT,
      null
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        allElements.push(node as Element);
      }
    }

    // Process elements
    allElements.forEach((element) => {
      const tagName = element.tagName.toUpperCase();

      if (!allowedTags.includes(tagName)) {
        // Replace disallowed elements with their text content
        const textNode = doc.createTextNode(element.textContent || '');
        element.parentNode?.replaceChild(textNode, element);
      } else if (tagName === 'SPAN') {
        // Only allow color style
        const style = element.getAttribute('style');
        if (style) {
          const colorMatch = style.match(/color:\s*([^;]+)/i);
          if (colorMatch) {
            element.setAttribute('style', `color: ${colorMatch[1]}`);
          } else {
            element.removeAttribute('style');
          }
        }
        // Remove any other attributes
        Array.from(element.attributes).forEach(attr => {
          if (attr.name !== 'style') {
            element.removeAttribute(attr.name);
          }
        });
      }
    });

    return doc.body.innerHTML;
  }, []);

  // Get HTML content for an annotation (prefer html, fallback to escaped text)
  const getAnnotationHtml = useCallback((annotation: Extract<PdfAnnotation, { kind: 'text' }> | Extract<PdfAnnotation, { kind: 'arrow' }>): string => {
    if (annotation.html) {
      return sanitizeHtml(annotation.html);
    }
    // Escape HTML and wrap in default color span if color is set
    const escaped = annotation.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>');

    const color = annotation.kind === 'arrow' ? annotation.textColor : annotation.color;
    if (color && color !== '#000000') {
      return `<span style="color: ${color}">${escaped}</span>`;
    }
    return escaped;
  }, [sanitizeHtml]);

  // Find page number for a given text annotation ID
  const findPageForTextId = useCallback((textId: string): number | null => {
    for (const [pageStr, pageData] of Object.entries(pageAnnotations)) {
      const pageDataTyped = pageData as PageAnnotations;
      const annotation = pageDataTyped.annotations.find(
        (a) => (a.kind === 'text' || a.kind === 'arrow') && a.id === textId
      );
      if (annotation) {
        return parseInt(pageStr, 10);
      }
    }
    return null;
  }, [pageAnnotations]);

  // Text annotation handlers for contenteditable
  const handleTextInput = useCallback((textId: string, pageNum: number, e: React.FormEvent<HTMLDivElement>) => {
    const editor = editorRefs.current[textId];
    if (!editor) return;

    const html = sanitizeHtml(editor.innerHTML);
    const text = editor.innerText || editor.textContent || '';

    setPageAnnotations((prev) => {
      const pageData = prev[pageNum];
      if (!pageData) return prev;

      const updatedAnnotations = pageData.annotations.map(a => {
        if ((a.kind === 'text' || a.kind === 'arrow') && a.id === textId) {
          return { ...a, text, html };
        }
        return a;
      });

      return {
        ...prev,
        [pageNum]: {
          ...pageData,
          annotations: updatedAnnotations,
        },
      };
    });
  }, [sanitizeHtml]);

  const handleTextBlur = useCallback((textId: string, pageNum: number, e: React.FocusEvent<HTMLDivElement>) => {
    const editor = editorRefs.current[textId];
    if (editor) {
      // Final update on blur
      const html = sanitizeHtml(editor.innerHTML);
      const text = editor.innerText || editor.textContent || '';

      setPageAnnotations((prev) => {
        const pageData = prev[pageNum];
        if (!pageData) return prev;

        const updatedAnnotations = pageData.annotations.map(a => {
          if ((a.kind === 'text' || a.kind === 'arrow') && a.id === textId) {
            return { ...a, text, html };
          }
          return a;
        });

        return {
          ...prev,
          [pageNum]: {
            annotations: updatedAnnotations,
            undoStack: [...pageData.undoStack, pageData.annotations].slice(-50),
            redoStack: [], // Clear redo on edit
          },
        };
      });
    }
    // Check if focus moved to the toolbar
    if (toolbarRef?.current && e.relatedTarget instanceof Node && toolbarRef.current.contains(e.relatedTarget)) {
      return;
    }
    setEditingTextId(null);
  }, [sanitizeHtml, toolbarRef]);

  const handleTextColorClick = useCallback((color: string) => {
    if (editingTextId) {
      const editor = editorRefs.current[editingTextId];
      const selection = window.getSelection();

      // Check if there's a valid selection within the editor
      if (editor && selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const isSelectionInEditor = editor.contains(range.commonAncestorContainer);

        if (isSelectionInEditor) {
          // Apply color to selection
          try {
            // Use execCommand to apply color
            document.execCommand('styleWithCSS', false, 'true');
            document.execCommand('foreColor', false, color);

            // Update annotation with new HTML
            const pageNum = findPageForTextId(editingTextId);
            if (pageNum !== null) {
              const html = sanitizeHtml(editor.innerHTML);
              const text = editor.innerText || editor.textContent || '';

              setPageAnnotations((prev) => {
                const pageData = prev[pageNum];
                if (!pageData) return prev;

                const updatedAnnotations = pageData.annotations.map((a) =>
                  (a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId ? { ...a, text, html } : a
                );

                return {
                  ...prev,
                  [pageNum]: {
                    ...pageData,
                    annotations: updatedAnnotations,
                  },
                };
              });
            }
          } catch (e) {
            // Fallback: wrap selection in span
            try {
              const span = document.createElement('span');
              span.style.color = color;
              span.appendChild(range.extractContents());
              range.insertNode(span);
              selection.removeAllRanges();
              selection.addRange(range);

              const pageNum = findPageForTextId(editingTextId);
              if (pageNum !== null && editor) {
                const html = sanitizeHtml(editor.innerHTML);
                const text = editor.innerText || editor.textContent || '';

                setPageAnnotations((prev) => {
                  const pageData = prev[pageNum];
                  if (!pageData) return prev;

                  const updatedAnnotations = pageData.annotations.map((a) =>
                    (a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId ? { ...a, text, html } : a
                  );

                  return {
                    ...prev,
                    [pageNum]: {
                      ...pageData,
                      annotations: updatedAnnotations,
                    },
                  };
                });
              }
            } catch (fallbackError) {
              console.error('Failed to apply color to selection', fallbackError);
            }
          }
          return;
        }
      }

      // No selection or selection outside editor - set default color for entire annotation
      const pageNum = findPageForTextId(editingTextId);
      if (pageNum !== null) {
        setPageAnnotations((prev) => {
          let updated = false;
          const next: Record<number, PageAnnotations> = {};
          for (const [pageStr, pageData] of Object.entries(prev)) {
            const pNum = parseInt(pageStr, 10);
            const pageDataTyped = pageData as PageAnnotations;
            const newAnnots = pageDataTyped.annotations.map((a) => {
              if ((a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId) {
                // For arrow annotations, update textColor; for text annotations, update color
                if (a.kind === 'arrow') {
                  return { ...a, textColor: color };
                } else {
                  return { ...a, color };
                }
              }
              return a;
            });
            if (newAnnots !== pageDataTyped.annotations) updated = true;
            next[pNum] = {
              annotations: newAnnots,
              undoStack: updated ? [...pageDataTyped.undoStack, pageDataTyped.annotations].slice(-50) : pageDataTyped.undoStack,
              redoStack: updated ? [] : pageDataTyped.redoStack,
            };
          }
          return next;
        });
      }
    } else {
      setTextColor(color);
    }
  }, [editingTextId, findPageForTextId, sanitizeHtml]);

  // Handle text annotation resize
  const handleTextResizeStop = useCallback((textId: string, pageNum: number, newWidth: number, newHeight: number, newX: number, newY: number) => {
    const baseDims = basePageDimensionsRef.current[pageNum];
    if (!baseDims) return;

    const baseW = baseDims.width;
    const baseH = baseDims.height;

    const newWNorm = newWidth / baseW;
    const newHNorm = newHeight / baseH;
    const newXNorm = newX / baseW;
    const newYNorm = newY / baseH;

    setPageAnnotations((prev) => {
      const pageData = prev[pageNum];
      if (!pageData) return prev;

      const updatedAnnotations = pageData.annotations.map((a) => {
        if ((a.kind === 'text' || a.kind === 'arrow') && a.id === textId) {
          if (a.kind === 'arrow') {
            // For arrows, recalculate the start point to snap to the nearest border
            const anchor = getClosestBorderAnchor(
              newXNorm,
              newYNorm,
              newWNorm,
              newHNorm,
              a.endXNorm,
              a.endYNorm
            );
            return { ...a, xNorm: newXNorm, yNorm: newYNorm, wNorm: newWNorm, hNorm: newHNorm, startXNorm: anchor.xNorm, startYNorm: anchor.yNorm };
          }
          return { ...a, xNorm: newXNorm, yNorm: newYNorm, wNorm: newWNorm, hNorm: newHNorm };
        }
        return a;
      });

      return {
        ...prev,
        [pageNum]: {
          annotations: updatedAnnotations,
          undoStack: [...pageData.undoStack, pageData.annotations].slice(-50),
          redoStack: [],
        },
      };
    });
  }, [getClosestBorderAnchor]);

  // Handle text annotation delete
  const handleTextDelete = useCallback((textId: string, pageNum: number) => {
    // Check if this is an arrow with a groupId before deleting
    const pageData = pageAnnotations[pageNum];
    const annotation = pageData?.annotations.find(
      a => (a.kind === 'text' || a.kind === 'arrow') && a.id === textId
    );

    setPageAnnotations((prev) => {
      const pageData = prev[pageNum];
      if (!pageData) return prev;

      const updatedAnnotations = pageData.annotations.filter((a) => !((a.kind === 'text' || a.kind === 'arrow') && a.id === textId));

      return {
        ...prev,
        [pageNum]: {
          annotations: updatedAnnotations,
          undoStack: [...pageData.undoStack, pageData.annotations].slice(-50),
          redoStack: [],
        },
      };
    });

    // Clear editing state if this annotation was being edited
    if (editingTextId === textId) {
      setEditingTextId(null);
    }
  }, [editingTextId, pageAnnotations]);

  // Get the effective text color (focused annotation's color or default)
  const effectiveTextColor = useMemo(() => {
    if (editingTextId) {
      // Find the focused text annotation across all pages
      for (const pageData of Object.values(pageAnnotations)) {
        const pageDataTyped = pageData as PageAnnotations;
        const annotation = pageDataTyped.annotations.find(
          (a) => (a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId
        );
        if (annotation && annotation.kind === 'text') {
          return annotation.color || '#000000';
        } else if (annotation && annotation.kind === 'arrow') {
          return annotation.textColor || '#000000';
        }
      }
    }
    return textColor;
  }, [editingTextId, pageAnnotations, textColor]);

  // Get the effective font size (focused annotation's font size or default)
  const effectiveFontSize = useMemo(() => {
    if (editingTextId) {
      // Find the focused text annotation across all pages
      for (const pageData of Object.values(pageAnnotations)) {
        const pageDataTyped = pageData as PageAnnotations;
        const annotation = pageDataTyped.annotations.find(
          (a) => (a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId
        );
        if (annotation && (annotation.kind === 'text' || annotation.kind === 'arrow')) {
          return annotation.fontSize || 14;
        }
      }
    }
    return fontSize;
  }, [editingTextId, pageAnnotations, fontSize]);

  const handleFontSizeChange = useCallback((newSize: number) => {
    if (editingTextId) {
      const pageNum = findPageForTextId(editingTextId);
      if (pageNum !== null) {
        setPageAnnotations((prev) => {
          const pageData = prev[pageNum];
          if (!pageData) return prev;

          const updatedAnnotations = pageData.annotations.map((a) =>
            (a.kind === 'text' || a.kind === 'arrow') && a.id === editingTextId ? { ...a, fontSize: newSize } : a
          );

          return {
            ...prev,
            [pageNum]: {
              ...pageData,
              annotations: updatedAnnotations,
            },
          };
        });
      }
    } else {
      setFontSize(newSize);
    }
  }, [editingTextId, findPageForTextId]);

  // Expose toolbar handlers to parent component
  useEffect(() => {
    if (onToolbarHandlersReady && pdfLoaded) {
      onToolbarHandlersReady({
        tool,
        onToolChange: handleToolChange,
        strokeColor: activeStrokeColor,
        onStrokeColorChange: handleStrokeColorChange,
        strokeWidth,
        onStrokeWidthChange: setStrokeWidth,
        textColor,
        onTextColorClick: handleTextColorClick,
        rectangleColor,
        onRectangleColorChange: setRectangleColor,
        effectiveTextColor,
        pageAnnotations,
        currentPage,
        onUndo: handleUndo,
        onRedo: handleRedo,
        onClear: handleClear,
        onZoomIn: handleZoomIn,
        onZoomOut: handleZoomOut,
        onZoomReset: handleZoomReset,
        onUploadClick: handleUploadClick,
        isToolbarExpanded,
        onToolbarExpandedChange: setIsToolbarExpanded,
        fontSize,
        onFontSizeChange: handleFontSizeChange,
        effectiveFontSize,
      });
    }
  }, [
    tool,
    handleToolChange,
    activeStrokeColor,
    handleStrokeColorChange,
    strokeWidth,
    textColor,
    handleTextColorClick,
    rectangleColor,
    effectiveTextColor,
    pageAnnotations,
    currentPage,
    isToolbarExpanded,
    pdfLoaded,
    onToolbarHandlersReady,
    handleUndo,
    handleRedo,
    handleClear,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleZoomReset,
    handleUploadClick,
    fontSize,
    handleFontSizeChange,
    effectiveFontSize,
  ]);

  // Compute display scale for CSS transform (without changing Page props)
  const displayScale = useMemo(() => {
    if (!baseWidthRef.current) return 1;
    return (containerWidth / baseWidthRef.current);
  }, [containerWidth]);

  // Use container width multiplied by scale for Page rendering
  const pageWidth = containerWidth * scale;

  return (
    <div ref={containerRef} className="flex-1 flex flex-col m-2 relative min-h-0">
      {/* Hidden file input */}
      <input
        type="file"
        accept=".pdf,application/pdf"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload PDF"
      />

      {/* Toolbar */}
      {pdfUrl && pdfLoaded && !renderToolbarExternally && (
        isToolsOpen ? (
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-lg p-2">
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={handleUploadClick}
                className="px-3 py-2 bg-gray-700/80 text-white text-xs font-semibold rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                aria-label="Change PDF"
                type="button"
              >
                Change PDF
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
                  className="p-2 bg-gray-700/80 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                  aria-label={isToolbarExpanded ? "Collapse toolbar controls" : "Expand toolbar controls"}
                  aria-expanded={isToolbarExpanded}
                  type="button"
                >
                  {isToolbarExpanded ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
                </button>
                <button
                  onClick={() => setIsToolsOpen(false)}
                  className="p-2 bg-gray-700/80 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                  aria-label="Collapse PDF tools"
                  type="button"
                >
                  <CloseIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {isToolbarExpanded && (
              <>
                {/* Tool selection */}
                <div className="flex gap-1 border-t border-gray-700 pt-2">
                  <button
                    onClick={() => handleToolChange('pen')}
                    className={`p-2 rounded ${tool === 'pen' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
                    aria-label="Pen tool"
                    title="Pen"
                  >
                    <PenIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToolChange('text')}
                    className={`p-2 rounded ${tool === 'text' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
                    aria-label="Text tool"
                    title="Text"
                  >
                    <TextIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToolChange('rectangle')}
                    className={`p-2 rounded ${tool === 'rectangle' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
                    aria-label="Rectangle tool"
                    title="Rectangle"
                  >
                    <RectangleIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleToolChange('arrow')}
                    className={`p-2 rounded ${tool === 'arrow' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
                    aria-label="Arrow tool"
                    title="Arrow"
                  >
                    <ArrowToolIcon className="h-4 w-4" />
                  </button>
                </div>

                {/* Color picker */}
                {tool === 'pen' && (
                  <div className="flex gap-1 border-t border-gray-700 pt-2">
                    {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#000000'].map((color) => (
                      <button
                        key={color}
                        onClick={() => handleStrokeColorChange(color)}
                        className={`w-6 h-6 rounded border-2 ${penStrokeColor === color ? 'border-white' : 'border-gray-600'}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Select color ${color}`}
                      />
                    ))}
                  </div>
                )}

                {/* Rectangle color picker */}
                {tool === 'rectangle' && (
                  <div className="flex gap-1 border-t border-gray-700 pt-2">
                    {['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#000000', '#ffffff'].map((color) => (
                      <button
                        key={color}
                        onClick={() => setRectangleColor(color)}
                        className={`w-6 h-6 rounded border-2 ${rectangleColor === color ? 'border-white' : 'border-gray-600'}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Select rectangle color ${color}`}
                      />
                    ))}
                  </div>
                )}

                {/* Text color picker */}
                {tool === 'text' && (
                  <div className="flex gap-1 border-t border-gray-700 pt-2">
                    {['#000000', '#ffffff', '#ef4444', '#10b981', '#f59e0b', '#3b82f6'].map((color) => (
                      <button
                        key={color}
                        onClick={() => handleTextColorClick(color)}
                        className={`w-6 h-6 rounded border-2 ${effectiveTextColor === color ? 'border-white' : 'border-gray-600'}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Select text color ${color}`}
                      />
                    ))}
                  </div>
                )}

                {/* Arrow color picker */}
                {tool === 'arrow' && (
                  <>
                    <div className="border-t border-gray-700 pt-2">
                      <label className="text-xs text-gray-300 block mb-1">Arrow Color</label>
                      <div className="flex gap-1">
                        {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#000000'].map((color) => (
                          <button
                            key={color}
                            onClick={() => handleStrokeColorChange(color)}
                            className={`w-6 h-6 rounded border-2 ${arrowStrokeColor === color ? 'border-white' : 'border-gray-600'}`}
                            style={{ backgroundColor: color }}
                            aria-label={`Select arrow color ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-gray-700 pt-2">
                      <label className="text-xs text-gray-300 block mb-1">Text Color</label>
                      <div className="flex gap-1">
                        {['#000000', '#ffffff', '#ef4444', '#10b981', '#f59e0b', '#3b82f6'].map((color) => (
                          <button
                            key={color}
                            onClick={() => handleTextColorClick(color)}
                            className={`w-6 h-6 rounded border-2 ${effectiveTextColor === color ? 'border-white' : 'border-gray-600'}`}
                            style={{ backgroundColor: color }}
                            aria-label={`Select text color ${color}`}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Stroke width */}
                {(tool === 'pen' || tool === 'arrow' || tool === 'rectangle') && (
                  <div className="border-t border-gray-700 pt-2">
                    <label className="text-xs text-gray-300 block mb-1">Width</label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={strokeWidth}
                      onChange={(e) => setStrokeWidth(parseInt(e.target.value, 10))}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Undo/Redo/Clear */}
                <div className="flex gap-1 border-t border-gray-700 pt-2">
                  <button
                    onClick={handleUndo}
                    disabled={!pageAnnotations[currentPage] || pageAnnotations[currentPage].undoStack.length === 0}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                    aria-label="Undo"
                    title="Undo"
                  >
                    <UndoIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleRedo}
                    disabled={!pageAnnotations[currentPage] || pageAnnotations[currentPage].redoStack.length === 0}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
                    aria-label="Redo"
                    title="Redo"
                  >
                    <RedoIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleClear}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                    aria-label="Clear page"
                    title="Clear page"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                {/* Zoom controls */}
                <div className="flex gap-1 border-t border-gray-700 pt-2">
                  <button
                    onClick={handleZoomIn}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                    aria-label="Zoom in"
                    title="Zoom in"
                  >
                    <ZoomInIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleZoomOut}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                    aria-label="Zoom out"
                    title="Zoom out"
                  >
                    <ZoomOutIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleZoomReset}
                    className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
                    aria-label="Reset zoom"
                    title="Reset zoom"
                  >
                    <ZoomResetIcon className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null
      )}

      {/* PDF Document */}
      {pdfUrl && pdfLoaded && (
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          <Document
            key={pdfUrl || 'none'}
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            loading={
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-400">Loading PDF...</div>
              </div>
            }
          >
            {Array.from(new Array(numPages), (el, index) => {
              const pageNum = index + 1;
              const baseDims = basePageDimensionsRef.current[pageNum];
              // Calculate dimensions based on the base width and scale
              const baseW = baseDims?.width || (baseWidthRef.current || 800);
              const baseH = baseDims?.height || (baseW * 1.414); // Approximate A4 ratio if not set
              const scaledW = baseW * displayScale * scale;
              const scaledH = baseH * displayScale * scale;

              return (
                <div
                  key={`page_${pageNum}`}
                  ref={(el) => {
                    if (el) pageContainerRefs.current[pageNum] = el;
                  }}
                  className="relative mb-4 flex justify-center"
                  onMouseEnter={() => setCurrentPage(pageNum)}
                  style={{
                    width: '100%',
                    minWidth: scaledW,
                  }}
                >
                  <div
                    style={{
                      width: scaledW,
                      height: scaledH,
                    }}
                  >
                    <div
                      ref={(el) => {
                        if (el) pageWrapperRefs.current[pageNum] = el;
                      }}
                      className="relative inline-block"
                    >
                      <Page
                        pageNumber={pageNum}
                        width={pageWidth}
                        onRenderSuccess={() => initBaseSize(pageNum)}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                      />
                      <canvas
                        ref={(el) => {
                          if (el) canvasRefs.current[pageNum] = el;
                        }}
                        className={isAnnotationEnabled ? "cursor-crosshair touch-none" : "touch-none"}
                        style={{
                          pointerEvents: isAnnotationEnabled || scale > 1 ? 'auto' : 'none',
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%'
                        }}
                        onContextMenu={(e) => {
                          if (scale > 1) e.preventDefault();
                        }}
                        onPointerDown={(e) => handlePointerDown(e, pageNum)}
                        onPointerMove={(e) => handlePointerMove(e, pageNum)}
                        onPointerUp={(e) => handlePointerUp(e, pageNum)}
                        onPointerCancel={(e) => handlePointerUp(e, pageNum)}
                      />
                      {/* Text and Arrow annotations */}
                      {pageAnnotations[pageNum]?.annotations.map((annotation) => {
                        if (annotation.kind !== 'text' && annotation.kind !== 'arrow') return null;
                        const textAnnotation = annotation;
                        const isEditing = editingTextId === textAnnotation.id;
                        const baseDims = basePageDimensionsRef.current[pageNum];

                        // Don't render Rnd until base dimensions are available
                        if (!baseDims) return null;

                        const baseW = baseDims.width;
                        const baseH = baseDims.height;

                        const w = textAnnotation.wNorm * baseW * displayScale;
                        const h = textAnnotation.hNorm * baseH * displayScale;
                        const x = textAnnotation.xNorm * baseW * displayScale;
                        const y = textAnnotation.yNorm * baseH * displayScale;

                        return (
                          <Rnd
                            key={textAnnotation.id}
                            className="absolute group"
                            bounds="parent"
                            disableDragging
                            enableResizing={isAnnotationEnabled ? {
                              top: true,
                              right: true,
                              bottom: true,
                              left: true,
                              topRight: true,
                              bottomRight: true,
                              bottomLeft: true,
                              topLeft: true,
                            } : false}
                            size={{ width: w * scale, height: h * scale }}
                            position={{ x: x * scale, y: y * scale }}
                            minWidth={baseW * displayScale * scale * 0.02}
                            minHeight={baseH * displayScale * scale * 0.02}
                            scale={1}
                            onResizeStop={(e, dir, ref, delta, pos) => {
                              if (!isAnnotationEnabled) return;
                              const newWidth = ref.offsetWidth / (scale * displayScale);
                              const newHeight = ref.offsetHeight / (scale * displayScale);
                              handleTextResizeStop(textAnnotation.id, pageNum, newWidth, newHeight, pos.x / (scale * displayScale), pos.y / (scale * displayScale));
                            }}
                          >
                            {isAnnotationEnabled && (
                              <button
                                className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 z-10 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-red-500"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  ev.preventDefault();
                                  handleTextDelete(textAnnotation.id, pageNum);
                                }}
                                aria-label={annotation.kind === 'arrow' ? "Delete arrow annotation" : "Delete text box"}
                                title={annotation.kind === 'arrow' ? "Delete arrow annotation" : "Delete text box"}
                              >
                                <TrashIcon className="h-3 w-3" />
                              </button>
                            )}
                            <TextAnnotationEditor
                              annotation={textAnnotation}
                              isEditing={isEditing}
                              isAnnotationEnabled={isAnnotationEnabled}
                              editorRefs={editorRefs}
                              onInput={(e) => handleTextInput(textAnnotation.id, pageNum, e)}
                              onFocus={() => setEditingTextId(textAnnotation.id)}
                              onBlur={(e) => handleTextBlur(textAnnotation.id, pageNum, e)}
                              getAnnotationHtml={getAnnotationHtml}
                            />
                          </Rnd>
                        );
                      })}
                      {/* Text draft preview */}
                      {textDraft && pageNum === currentPage && (
                        <div
                          className="absolute border-2 border-dashed border-cyan-400 pointer-events-none"
                          style={{
                            left: `${Math.min(textDraft.startX, textDraft.endX) * 100}%`,
                            top: `${Math.min(textDraft.startY, textDraft.endY) * 100}%`,
                            width: `${Math.abs(textDraft.endX - textDraft.startX) * 100}%`,
                            height: `${Math.abs(textDraft.endY - textDraft.startY) * 100}%`,
                          }}
                        />
                      )}
                      {/* Arrow draft preview */}
                      {arrowDraft && pageNum === currentPage && (
                        <svg
                          className="absolute pointer-events-none"
                          style={{
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                          }}
                        >
                          <defs>
                            <marker
                              id="arrowhead-preview"
                              markerWidth="10"
                              markerHeight="7"
                              refX="9"
                              refY="3.5"
                              orient="auto"
                            >
                              <polygon points="0 0, 10 3.5, 0 7" fill="#22d3ee" />
                            </marker>
                          </defs>
                          <line
                            x1={`${arrowDraft.tailX * 100}%`}
                            y1={`${arrowDraft.tailY * 100}%`}
                            x2={`${arrowDraft.headX * 100}%`}
                            y2={`${arrowDraft.headY * 100}%`}
                            stroke="#22d3ee"
                            strokeWidth="2"
                            strokeDasharray="5,5"
                            markerEnd="url(#arrowhead-preview)"
                          />
                        </svg>
                      )}
                      {/* Rectangle draft preview */}
                      {rectangleDraft && pageNum === currentPage && (
                        <svg
                          className="absolute pointer-events-none"
                          style={{
                            left: 0,
                            top: 0,
                            width: '100%',
                            height: '100%',
                          }}
                        >
                          <defs>
                            <radialGradient id="rect-gradient-preview">
                              <stop offset="0%" stopColor="#3b82f6" />
                              <stop offset="100%" stopColor="#06b6d4" />
                            </radialGradient>
                          </defs>
                          <rect
                            x={`${Math.min(rectangleDraft.startX, rectangleDraft.endX) * 100}%`}
                            y={`${Math.min(rectangleDraft.startY, rectangleDraft.endY) * 100}%`}
                            width={`${Math.abs(rectangleDraft.endX - rectangleDraft.startX) * 100}%`}
                            height={`${Math.abs(rectangleDraft.endY - rectangleDraft.startY) * 100}%`}
                            stroke="url(#rect-gradient-preview)"
                            strokeWidth="2"
                            strokeDasharray="5,5"
                            fill="none"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </Document>
        </div>
      )}

      {/* Empty state when no PDF is loaded */}
      {!pdfUrl && (
        <div className="absolute inset-0 bg-gray-900 border-2 border-dashed border-gray-700 rounded-lg flex flex-col justify-center items-center pointer-events-none">
          <div className="text-center p-8">
            <DocumentIcon className="mx-auto h-12 w-12 text-gray-600" />
            <h2 className="mt-4 text-xl font-semibold text-gray-400">Construction Plan Viewer</h2>
            <p className="mt-1 text-sm text-gray-500">Upload a PDF file to get started.</p>
            <button
              onClick={handleUploadClick}
              className="mt-6 px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto"
            >
              Upload PDF
            </button>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}

      {/* Error display */}
      {error && pdfUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/90">
          <div className="text-center p-8">
            <p className="text-red-400">{error}</p>
            <button
              onClick={handleUploadClick}
              className="mt-4 px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700"
            >
              Try Another PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PdfViewer;
