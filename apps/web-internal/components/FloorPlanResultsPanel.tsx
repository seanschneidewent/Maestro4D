import React from 'react';
import { CloseIcon, LayersIcon } from './Icons';

interface FloorPlanResultsPanelProps {
  svgContent: string;
  roomCount: number;
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

const FloorPlanResultsPanel: React.FC<FloorPlanResultsPanelProps> = ({
  svgContent,
  roomCount,
  totalArea,
  layers,
  onLayerToggle,
  onExport,
  onClose,
}) => {
  const formatArea = (sqFt: number): string => {
    return sqFt.toLocaleString();
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

      {/* SVG Preview Area */}
      <div className="p-4 border-b border-gray-700/50">
        <div className="bg-gray-900 rounded-lg border border-gray-700 h-48 flex items-center justify-center overflow-hidden">
          {svgContent ? (
            <div
              className="w-full h-full p-2"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
          ) : (
            <div className="text-center text-gray-500">
              <LayersIcon className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Floor plan preview</p>
              <p className="text-xs">(interactive pan/zoom)</p>
            </div>
          )}
        </div>
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
            <div className="text-lg font-semibold text-white">{roomCount}</div>
            <div className="text-xs text-gray-500">Rooms Detected</div>
          </div>
          <div className="w-px h-8 bg-gray-700"></div>
          <div className="text-center flex-1">
            <div className="text-lg font-semibold text-white">
              {formatArea(totalArea)} <span className="text-sm font-normal">sq ft</span>
            </div>
            <div className="text-xs text-gray-500">Total Area</div>
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

