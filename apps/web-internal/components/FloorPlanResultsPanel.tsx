import React, { useState, useRef, useCallback } from 'react';
import { CloseIcon, LayersIcon } from './Icons';

interface FloorPlanResultsPanelProps {
  svgContent: string;
  wallCount: number;
  totalArea: number;
  layers: {
    dimensions: boolean;
    roomLabels: boolean;
    openings: boolean;
    wallThickness: boolean;
  };
  onLayerToggle: (layer: string, enabled: boolean) => void;
  onExport: (format: 'svg' | 'dxf' | 'pdf' | 'json') => void;
  onClose: () => void;
}

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

const FloorPlanResultsPanel: React.FC<FloorPlanResultsPanelProps> = ({
  svgContent,
  wallCount,
  totalArea,
  layers,
  onLayerToggle,
  onExport,
  onClose,
}) => {
  // Pan/zoom state
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const formatArea = (sqFt: number): string => {
    return sqFt.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const exportFormats: Array<{ format: 'svg' | 'dxf' | 'pdf' | 'json'; label: string }> = [
    { format: 'svg', label: 'SVG' },
    { format: 'dxf', label: 'DXF' },
    { format: 'pdf', label: 'PDF' },
    { format: 'json', label: 'JSON' },
  ];

  const layerOptions: Array<{ key: keyof typeof layers; label: string }> = [
    { key: 'dimensions', label: 'Dimensions' },
    { key: 'roomLabels', label: 'Room Labels' },
    { key: 'openings', label: 'Openings' },
    { key: 'wallThickness', label: 'Wall Thickness' },
  ];

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const container = containerRef.current;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate zoom
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.5, Math.min(5, transform.scale * zoomFactor));
    
    // Zoom toward mouse position
    const scaleChange = newScale / transform.scale;
    const newTranslateX = mouseX - (mouseX - transform.translateX) * scaleChange;
    const newTranslateY = mouseY - (mouseY - transform.translateY) * scaleChange;
    
    setTransform({
      scale: newScale,
      translateX: newTranslateX,
      translateY: newTranslateY,
    });
  }, [transform]);

  // Handle mouse down for panning
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    setDragStart({
      x: e.clientX - transform.translateX,
      y: e.clientY - transform.translateY,
    });
  }, [transform.translateX, transform.translateY]);

  // Handle mouse move for panning
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    setTransform(prev => ({
      ...prev,
      translateX: e.clientX - dragStart.x,
      translateY: e.clientY - dragStart.y,
    }));
  }, [isDragging, dragStart]);

  // Handle mouse up to stop panning
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle mouse leave to stop panning
  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Reset view
  const handleResetView = useCallback(() => {
    setTransform({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
  }, []);

  return (
    <div className="absolute top-16 right-4 w-80 bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-lg pointer-events-auto z-10 flex flex-col max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <h3 className="text-white font-semibold text-sm">Floor Plan Results</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close results"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* SVG Preview Area with Pan/Zoom */}
      <div className="p-4 border-b border-gray-700/50">
        <div 
          ref={containerRef}
          className="bg-gray-900 rounded-lg border border-gray-700 h-48 overflow-hidden relative"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {svgContent ? (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale})`,
                transformOrigin: '0 0',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              <div
                className="w-full h-full"
                dangerouslySetInnerHTML={{ __html: svgContent }}
                style={{ 
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-center text-gray-500">
              <div>
                <LayersIcon className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm">Floor plan preview</p>
                <p className="text-xs">(scroll to zoom, drag to pan)</p>
              </div>
            </div>
          )}
          
          {/* Zoom indicator */}
          {svgContent && transform.scale !== 1 && (
            <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
              {Math.round(transform.scale * 100)}%
            </div>
          )}
        </div>
        
        {/* Reset View button */}
        {svgContent && (transform.scale !== 1 || transform.translateX !== 0 || transform.translateY !== 0) && (
          <button
            onClick={handleResetView}
            className="mt-2 w-full px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium rounded transition-colors"
          >
            Reset View
          </button>
        )}
      </div>

      {/* Layers Section */}
      <div className="p-4 border-b border-gray-700/50">
        <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
          Layers
        </h4>
        <div className="grid grid-cols-2 gap-2">
          {layerOptions.map((option) => (
            <label
              key={option.key}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={layers[option.key]}
                onChange={(e) => {
                  console.log(`[Floor Plan] Layer "${option.key}" toggled:`, e.target.checked);
                  onLayerToggle(option.key, e.target.checked);
                }}
                className="w-4 h-4 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500 focus:ring-2 accent-cyan-500"
              />
              <span className="text-sm text-gray-300">{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Stats Section */}
      <div className="p-4 border-b border-gray-700/50">
        <div className="flex items-center justify-between gap-4">
          <div className="text-center flex-1">
            <div className="text-lg font-semibold text-white">{wallCount}</div>
            <div className="text-xs text-gray-500">Walls Detected</div>
          </div>
          <div className="w-px h-8 bg-gray-700"></div>
          <div className="text-center flex-1">
            <div className="text-lg font-semibold text-white">
              {formatArea(totalArea)} <span className="text-sm font-normal">sq ft</span>
            </div>
            <div className="text-xs text-gray-500">Bounding Area</div>
          </div>
        </div>
      </div>

      {/* Export Section */}
      <div className="p-4">
        <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
          Export
        </h4>
        <div className="flex gap-2">
          {exportFormats.map((item) => (
            <button
              key={item.format}
              onClick={() => {
                console.log(`[Floor Plan] Exporting as ${item.format.toUpperCase()}`);
                onExport(item.format);
              }}
              className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-md transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FloorPlanResultsPanel;
