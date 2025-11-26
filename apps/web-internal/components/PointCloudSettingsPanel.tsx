import React from 'react';
import { CloseIcon } from './Icons';

interface PointCloudSettingsPanelProps {
  pointSize: number;
  onPointSizeChange: (size: number) => void;
  pointBudget: number;
  onPointBudgetChange: (budget: number) => void;
  colorMode: 'rgb' | 'elevation' | 'intensity' | 'classification';
  onColorModeChange: (mode: string) => void;
  visiblePointCount: number;
  onClose: () => void;
}

const PointCloudSettingsPanel: React.FC<PointCloudSettingsPanelProps> = ({
  pointSize,
  onPointSizeChange,
  pointBudget,
  onPointBudgetChange,
  colorMode,
  onColorModeChange,
  visiblePointCount,
  onClose,
}) => {
  const formatPointCount = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(2)}M`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  const formatBudget = (budget: number): string => {
    return `${(budget / 1000000).toFixed(1)}M`;
  };

  return (
    <div className="absolute top-16 right-4 w-72 bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-lg p-4 pointer-events-auto z-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-semibold text-sm">Point Cloud Settings</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Close settings"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Point Size */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-gray-300 text-sm">Point Size</label>
          <span className="text-cyan-400 text-sm font-mono">{pointSize.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="5.0"
          step="0.1"
          value={pointSize}
          onChange={(e) => {
            const value = parseFloat(e.target.value);
            console.log('[Point Cloud Settings] Point size changed:', value);
            onPointSizeChange(value);
          }}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider-cyan"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0.1</span>
          <span>5.0</span>
        </div>
      </div>

      {/* Point Budget */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-gray-300 text-sm">Point Budget</label>
          <span className="text-cyan-400 text-sm font-mono">{formatBudget(pointBudget)}</span>
        </div>
        <input
          type="range"
          min="500000"
          max="10000000"
          step="500000"
          value={pointBudget}
          onChange={(e) => {
            const value = parseInt(e.target.value);
            console.log('[Point Cloud Settings] Point budget changed:', formatBudget(value));
            onPointBudgetChange(value);
          }}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider-cyan"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0.5M</span>
          <span>10M</span>
        </div>
      </div>

      {/* Color Mode */}
      <div className="mb-4">
        <label className="text-gray-300 text-sm block mb-2">Color Mode</label>
        <select
          value={colorMode}
          onChange={(e) => {
            console.log('[Point Cloud Settings] Color mode changed:', e.target.value);
            onColorModeChange(e.target.value);
          }}
          className="w-full bg-gray-700 border border-gray-600 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
        >
          <option value="rgb">RGB</option>
          <option value="elevation">Elevation</option>
          <option value="intensity">Intensity</option>
          <option value="classification">Classification</option>
        </select>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700 my-3"></div>

      {/* Visible Points */}
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-sm">Visible Points</span>
        <span className="text-white text-sm font-mono">{formatPointCount(visiblePointCount)}</span>
      </div>
    </div>
  );
};

export default PointCloudSettingsPanel;

