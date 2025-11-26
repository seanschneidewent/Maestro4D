import React from 'react';
import { FloorPlanIcon, BeamIcon, LoadBearingIcon } from './Icons';

interface AnalysisToolsPanelProps {
  onGenerateFloorPlan: () => void;
  onDetectStructure: () => void;
  onAnalyzeLoadBearing: () => void;
  isProcessing: boolean;
  activeFeature: string | null;
}

interface AnalysisCard {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  warning?: string;
  onClick: () => void;
}

const AnalysisToolsPanel: React.FC<AnalysisToolsPanelProps> = ({
  onGenerateFloorPlan,
  onDetectStructure,
  onAnalyzeLoadBearing,
  isProcessing,
  activeFeature,
}) => {
  const analysisCards: AnalysisCard[] = [
    {
      id: 'floor-plan',
      icon: <FloorPlanIcon className="h-6 w-6" />,
      title: 'Generate Floor Plan',
      subtitle: '2D plan with dimensions',
      onClick: () => {
        console.log('[Analysis Tools] Generate Floor Plan clicked');
        onGenerateFloorPlan();
      },
    },
    {
      id: 'structure',
      icon: <BeamIcon className="h-6 w-6" />,
      title: 'Detect Structure',
      subtitle: 'Rafters, beams, walls',
      onClick: () => {
        console.log('[Analysis Tools] Detect Structure clicked');
        onDetectStructure();
      },
    },
    {
      id: 'load-bearing',
      icon: <LoadBearingIcon className="h-6 w-6" />,
      title: 'Load-Bearing Analysis',
      subtitle: 'Structural assessment',
      warning: 'Verify with engineer',
      onClick: () => {
        console.log('[Analysis Tools] Load-Bearing Analysis clicked');
        onAnalyzeLoadBearing();
      },
    },
  ];

  return (
    <div className="absolute top-16 left-4 w-64 bg-gray-800/90 backdrop-blur-sm border border-gray-700/50 rounded-lg p-3 pointer-events-auto z-10">
      {/* Header */}
      <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
        Analysis Tools
      </h3>

      {/* Analysis Cards */}
      <div className="space-y-2">
        {analysisCards.map((card) => {
          const isActive = activeFeature === card.id;
          const isDisabled = isProcessing && !isActive;

          return (
            <button
              key={card.id}
              onClick={card.onClick}
              disabled={isDisabled}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                isActive
                  ? 'bg-cyan-600/20 border-cyan-500/50'
                  : isDisabled
                  ? 'bg-gray-800/50 border-gray-700/30 opacity-50 cursor-not-allowed'
                  : 'bg-gray-800/50 border-gray-700/50 hover:bg-gray-700/50 hover:border-gray-600/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`flex-shrink-0 ${
                    isActive ? 'text-cyan-400' : 'text-gray-400'
                  }`}
                >
                  {card.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`font-medium text-sm ${
                      isActive ? 'text-cyan-300' : 'text-white'
                    }`}
                  >
                    {card.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {card.subtitle}
                  </div>
                  {card.warning && (
                    <div className="flex items-center gap-1 mt-1">
                      <svg
                        className="h-3 w-3 text-amber-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <span className="text-xs text-amber-500">{card.warning}</span>
                    </div>
                  )}
                </div>
                {isActive && isProcessing && (
                  <div className="flex-shrink-0">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-cyan-400 border-t-transparent"></div>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AnalysisToolsPanel;

