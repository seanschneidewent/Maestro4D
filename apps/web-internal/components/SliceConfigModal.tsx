import React, { useState } from 'react';
import { CloseIcon } from './Icons';

interface SliceConfig {
  floorId: string;
  sliceHeight: number;
  sliceThickness: number;
}

interface Floor {
  id: string;
  label: string;
  elevation: number;
}

interface SliceConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: SliceConfig) => void;
  floors: Floor[];
  boundingBox: { minZ: number; maxZ: number };
  pointsInSlice: number;
  isPreviewEnabled: boolean;
  onPreviewToggle: (enabled: boolean) => void;
  sliceHeight: number;
  onSliceHeightChange: (height: number) => void;
  sliceThickness: number;
  onSliceThicknessChange: (thickness: number) => void;
}

const SliceConfigModal: React.FC<SliceConfigModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  floors,
  boundingBox,
  pointsInSlice,
  isPreviewEnabled,
  onPreviewToggle,
  sliceHeight,
  onSliceHeightChange,
  sliceThickness,
  onSliceThicknessChange,
}) => {
  const [selectedFloorId, setSelectedFloorId] = useState(floors[0]?.id || '');

  if (!isOpen) {
    return null;
  }

  const formatFeet = (feet: number): string => {
    const wholeFeet = Math.floor(feet);
    const inches = Math.round((feet - wholeFeet) * 12);
    if (inches === 12) {
      return `${wholeFeet + 1}' 0"`;
    }
    return `${wholeFeet}' ${inches}"`;
  };

  const formatMeters = (feet: number): string => {
    const meters = feet * 0.3048;
    return `${meters.toFixed(2)}m`;
  };

  const formatInches = (inches: number): string => {
    return `${inches} in`;
  };

  const inchesToMeters = (inches: number): string => {
    const meters = inches * 0.0254;
    return `${meters.toFixed(2)}m`;
  };

  const formatPointCount = (count: number): string => {
    if (count >= 1000000) {
      return `~${(count / 1000000).toFixed(2)}M`;
    } else if (count >= 1000) {
      return `~${(count / 1000).toFixed(0)}K`;
    }
    return `~${count}`;
  };

  const handleGenerate = () => {
    const config: SliceConfig = {
      floorId: selectedFloorId,
      sliceHeight,
      sliceThickness,
    };
    console.log('[Slice Config] Generating floor plan with config:', config);
    onGenerate(config);
  };

  const handleFloorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFloorId = e.target.value;
    console.log('[Slice Config] Floor changed:', newFloorId);
    setSelectedFloorId(newFloorId);
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="slice-config-title"
    >
      <div
        className="bg-[#1a1f2e] rounded-xl border border-[#2d3748] w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 id="slice-config-title" className="text-xl font-bold text-white">
            Configure Floor Plan Slice
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
            aria-label="Close modal"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Floor Level */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Floor Level
            </label>
            <select
              value={selectedFloorId}
              onChange={handleFloorChange}
              className="w-full bg-[#0f1419] border border-[#2d3748] rounded-lg py-2 px-4 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              {floors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.label}
                </option>
              ))}
            </select>
          </div>

          {/* Slice Height */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                Slice Height
              </label>
              <span className="text-cyan-400 text-sm font-mono">
                {formatFeet(sliceHeight)} ({formatMeters(sliceHeight)})
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="12"
              step="0.5"
              value={sliceHeight}
              onChange={(e) => {
                const value = parseFloat(e.target.value);
                console.log('[Slice Config] Slice height changed:', value, 'ft');
                onSliceHeightChange(value);
              }}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0 ft</span>
              <span>12 ft</span>
            </div>
          </div>

          {/* Slice Thickness */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-300">
                Slice Thickness
              </label>
              <span className="text-cyan-400 text-sm font-mono">
                {formatInches(sliceThickness)} ({inchesToMeters(sliceThickness)})
              </span>
            </div>
            <input
              type="range"
              min="2"
              max="24"
              step="1"
              value={sliceThickness}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                console.log('[Slice Config] Slice thickness changed:', value, 'in');
                onSliceThicknessChange(value);
              }}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>2 in</span>
              <span>24 in</span>
            </div>
          </div>

          {/* Preview Toggle */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="preview-toggle"
              checked={isPreviewEnabled}
              onChange={(e) => {
                console.log('[Slice Config] Preview toggled:', e.target.checked);
                onPreviewToggle(e.target.checked);
              }}
              className="w-4 h-4 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500 focus:ring-2 accent-cyan-500"
            />
            <label
              htmlFor="preview-toggle"
              className="text-sm text-gray-300 cursor-pointer"
            >
              Preview slice in 3D view
            </label>
          </div>

          {/* Points in Slice */}
          <div className="bg-gray-800/50 rounded-lg px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Points in slice</span>
              <span className="text-white text-sm font-mono">
                {formatPointCount(pointsInSlice)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            className="px-4 py-2 text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 rounded-lg transition-colors"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
};

export default SliceConfigModal;

