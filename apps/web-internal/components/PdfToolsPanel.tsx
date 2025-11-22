import React from 'react';
import { PenIcon, TextIcon, ArrowToolIcon, RectangleIcon, UndoIcon, RedoIcon, TrashIcon, ZoomInIcon, ZoomOutIcon, ZoomResetIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon } from './Icons';
import { PdfToolbarHandlers } from './PdfViewer';

interface PdfToolsPanelProps extends PdfToolbarHandlers {
  onClose: () => void;
}

const PdfToolsPanel: React.FC<PdfToolsPanelProps> = ({
  tool,
  onToolChange,
  strokeColor,
  onStrokeColorChange,
  strokeWidth,
  onStrokeWidthChange,
  textColor,
  onTextColorClick,
  rectangleColor,
  onRectangleColorChange,
  effectiveTextColor,
  pageAnnotations,
  currentPage,
  onUndo,
  onRedo,
  onClear,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onUploadClick,
  isToolbarExpanded,
  onToolbarExpandedChange,
  onClose,
  effectiveFontSize,
  onFontSizeChange,
}) => {
  return (
    <div className="flex flex-col gap-2 bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-lg p-2">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onUploadClick}
          className="px-3 py-2 bg-gray-700/80 text-white text-xs font-semibold rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
          aria-label="Change PDF"
          type="button"
        >
          Change PDF
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onToolbarExpandedChange(!isToolbarExpanded)}
            className="p-2 bg-gray-700/80 text-white rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
            aria-label={isToolbarExpanded ? "Collapse toolbar controls" : "Expand toolbar controls"}
            aria-expanded={isToolbarExpanded}
            type="button"
          >
            {isToolbarExpanded ? <ChevronUpIcon className="h-5 w-5" /> : <ChevronDownIcon className="h-5 w-5" />}
          </button>
          <button
            onClick={onClose}
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
              onClick={() => onToolChange('pen')}
              className={`p-2 rounded ${tool === 'pen' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
              aria-label="Pen tool"
              title="Pen"
            >
              <PenIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onToolChange('text')}
              className={`p-2 rounded ${tool === 'text' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
              aria-label="Text tool"
              title="Text"
            >
              <TextIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onToolChange('rectangle')}
              className={`p-2 rounded ${tool === 'rectangle' ? 'bg-cyan-600' : 'bg-gray-700 hover:bg-gray-600'} text-white transition-colors`}
              aria-label="Rectangle tool"
              title="Rectangle"
            >
              <RectangleIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onToolChange('arrow')}
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
                  onClick={() => onStrokeColorChange(color)}
                  className={`w-6 h-6 rounded border-2 ${strokeColor === color ? 'border-white' : 'border-gray-600'}`}
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
                  onClick={() => onRectangleColorChange(color)}
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
                  onClick={() => onTextColorClick(color)}
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
                      onClick={() => onStrokeColorChange(color)}
                      className={`w-6 h-6 rounded border-2 ${strokeColor === color ? 'border-white' : 'border-gray-600'}`}
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
                      onClick={() => onTextColorClick(color)}
                      className={`w-6 h-6 rounded border-2 ${effectiveTextColor === color ? 'border-white' : 'border-gray-600'}`}
                      style={{ backgroundColor: color }}
                      aria-label={`Select text color ${color}`}
                    />
                  ))}
                </div>
              </div>
              <div className="border-t border-gray-700 pt-2">
                <label className="text-xs text-gray-300 block mb-1">Font Size: {effectiveFontSize}px</label>
                <input
                  type="range"
                  min="5"
                  max="32"
                  value={effectiveFontSize}
                  onChange={(e) => onFontSizeChange(parseInt(e.target.value, 10))}
                  className="w-full"
                />
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
                onChange={(e) => onStrokeWidthChange(parseInt(e.target.value, 10))}
                className="w-full"
              />
            </div>
          )}

          {/* Undo/Redo/Clear */}
          <div className="flex gap-1 border-t border-gray-700 pt-2">
            <button
              onClick={onUndo}
              disabled={!pageAnnotations[currentPage] || pageAnnotations[currentPage].undoStack.length === 0}
              className="p-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              aria-label="Undo"
              title="Undo"
            >
              <UndoIcon className="h-4 w-4" />
            </button>
            <button
              onClick={onRedo}
              disabled={!pageAnnotations[currentPage] || pageAnnotations[currentPage].redoStack.length === 0}
              className="p-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              aria-label="Redo"
              title="Redo"
            >
              <RedoIcon className="h-4 w-4" />
            </button>
            <button
              onClick={onClear}
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
              onClick={onZoomIn}
              className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomInIcon className="h-4 w-4" />
            </button>
            <button
              onClick={onZoomOut}
              className="p-2 rounded bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOutIcon className="h-4 w-4" />
            </button>
            <button
              onClick={onZoomReset}
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
  );
};

export default PdfToolsPanel;

