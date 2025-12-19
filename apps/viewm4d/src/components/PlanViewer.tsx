import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { api } from '../services/api';
import type { ContextPointer, ProjectFile } from '../types';
import { NarrativeResponse } from './NarrativeResponse';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface Props {
  fileId: string | null;
  highlightedPointerId: string | null;
  activePointerIds: string[];
  narrative?: string | null;
  onDismissNarrative?: () => void;
}

export function PlanViewer({ fileId, highlightedPointerId, activePointerIds, narrative, onDismissNarrative }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(900);

  const [file, setFile] = useState<ProjectFile | null>(null);
  const [pointers, setPointers] = useState<ContextPointer[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setContainerWidth(Math.max(320, el.clientWidth));
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fileId) {
      setFile(null);
      setPointers([]);
      setPdfUrl(null);
      setError(null);
      setNumPages(0);
      setPageNumber(1);
      setScale(1);
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
    setScale(1);

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

  const pageWidth = Math.max(320, Math.floor(containerWidth - 32));

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
        <div className="px-3 py-2 border-b border-slate-200 bg-white">
          <div className="text-sm font-medium text-slate-900 truncate">{file.name}</div>
        </div>
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
    <div className="h-full flex flex-col min-h-0 relative">
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
          <button
            type="button"
            className="px-2 py-1 text-sm rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))}
            disabled={scale <= 0.6}
          >
            −
          </button>
          <div className="text-sm text-slate-700 w-12 text-center">{Math.round(scale * 100)}%</div>
          <button
            type="button"
            className="px-2 py-1 text-sm rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => setScale((s) => Math.min(2, Math.round((s + 0.1) * 10) / 10))}
            disabled={scale >= 2}
          >
            +
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto p-4">
        <div className="flex justify-center">
          <Document
            file={pdfUrl}
            onLoadSuccess={(info) => {
              setNumPages(info.numPages);
              setPageNumber((p) => Math.min(Math.max(1, p), info.numPages));
            }}
            onLoadError={(e) => setError(api.formatError(e))}
            loading={null}
          >
            <div className="relative inline-block bg-white shadow-sm rounded-md overflow-hidden">
              <Page
                pageNumber={pageNumber}
                width={pageWidth}
                scale={scale}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                loading={null}
              />
              <div className="absolute inset-0 pointer-events-none">
                {visiblePointers.map((p) => {
                  const isHighlighted = p.id === highlightedPointerId;
                  const strokeWidth = Math.max(1, p.style?.strokeWidth ?? 2);
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
                        background: 'linear-gradient(to right, #3b82f6, #06b6d4)',
                        WebkitMask: `linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)`,
                        WebkitMaskComposite: 'xor',
                        mask: `linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)`,
                        maskComposite: 'exclude',
                        padding: `${strokeWidth}px`,
                        boxSizing: 'border-box',
                      }}
                    />
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


