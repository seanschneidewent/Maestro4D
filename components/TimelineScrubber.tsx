import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PlusIcon, TrashIcon } from './Icons';

interface TimelineScrubberProps {
  scanDates: string[];
  currentDate: string;
  onDateChange: (date: string) => void;
  onAddScan: () => void;
  isDeleteMode?: boolean;
  selectedScanDates?: string[];
  onToggleDeleteMode?: () => void;
  onToggleScanSelection?: (date: string) => void;
  onConfirmDelete?: () => void;
  isGlbActive?: boolean;
  onToggleGlb?: () => void;
}

const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ 
  scanDates, 
  currentDate, 
  onDateChange, 
  onAddScan,
  isDeleteMode = false,
  selectedScanDates = [],
  onToggleDeleteMode,
  onToggleScanSelection,
  onConfirmDelete,
  isGlbActive = false,
  onToggleGlb
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0); // 0 to 1
  
  const dateToIndex = useCallback((date: string) => scanDates.indexOf(date), [scanDates]);
  const indexToPosition = useCallback((index: number) => {
    if (scanDates.length <= 1) return 0.5;
    return index / (scanDates.length - 1);
  }, [scanDates.length]);

  // Set position based on currentDate prop
  useEffect(() => {
    const currentIndex = dateToIndex(currentDate);
    if (currentIndex !== -1 && !isScrubbing) {
      setScrubPosition(indexToPosition(currentIndex));
    }
  }, [currentDate, dateToIndex, indexToPosition, isScrubbing]);

  const handleScrub = useCallback((clientX: number) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const position = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setScrubPosition(position);
  }, []);

  const handleScrubEnd = useCallback(() => {
    if (!isScrubbing) return;
    setIsScrubbing(false);
    const closestIndex = Math.round(scrubPosition * (scanDates.length - 1));
    const newDate = scanDates[closestIndex];
    if (newDate && newDate !== currentDate) {
        onDateChange(newDate);
    } else {
      // If snapping to the same date, still reset scrub position visually
      setScrubPosition(indexToPosition(dateToIndex(currentDate)));
    }
  }, [isScrubbing, scrubPosition, scanDates, onDateChange, currentDate, dateToIndex, indexToPosition]);
  
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Prevent scrubbing when in delete mode
    if (isDeleteMode) return;
    setIsScrubbing(true);
    handleScrub(e.clientX);
  };
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isScrubbing) {
      handleScrub(e.clientX);
    }
  }, [isScrubbing, handleScrub]);

  const handleMouseUp = useCallback(() => {
    if (isScrubbing) {
        handleScrubEnd();
    }
  }, [isScrubbing, handleScrubEnd]);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent keyboard navigation when in delete mode
        if (isDeleteMode) return;
        if (timelineRef.current && document.activeElement === timelineRef.current) {
            const currentIndex = dateToIndex(currentDate);
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                const nextIndex = Math.min(scanDates.length - 1, currentIndex + 1);
                if (currentIndex !== nextIndex) onDateChange(scanDates[nextIndex]);
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prevIndex = Math.max(0, currentIndex - 1);
                if (currentIndex !== prevIndex) onDateChange(scanDates[prevIndex]);
            }
        }
    };
    const ref = timelineRef.current;
    if (ref) {
      ref.addEventListener('keydown', handleKeyDown);
      return () => ref.removeEventListener('keydown', handleKeyDown);
    }
  }, [currentDate, dateToIndex, onDateChange, scanDates, isDeleteMode]);

  // Empty State
  if (!scanDates || scanDates.length === 0) {
    return (
        <div className="flex-1 max-w-lg flex items-center justify-center gap-4">
             <div 
                className="relative w-full h-1.5 bg-gray-700 rounded-full cursor-pointer"
                onClick={onAddScan}
            />
            <button
                onClick={onAddScan}
                className="flex-shrink-0 flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
            >
                <PlusIcon className="h-4 w-4" />
                Add First Scan
            </button>
        </div>
    );
  }

  // Single Scan State
  if (scanDates.length === 1) {
    const isSelected = isDeleteMode && selectedScanDates.includes(scanDates[0]);
    return (
      <div className="flex-1 max-w-lg flex items-center justify-center gap-4">
        {onToggleGlb && (
          <button
            onClick={onToggleGlb}
            className={`flex-shrink-0 flex items-center gap-2 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${
              isGlbActive
                ? 'bg-cyan-600 hover:bg-cyan-700'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
            aria-label="Toggle GLB"
          >
            GLB
          </button>
        )}
        {onToggleDeleteMode && (
          <button
            onClick={() => {
              if (isDeleteMode && selectedScanDates.length > 0 && onConfirmDelete) {
                onConfirmDelete();
              } else {
                onToggleDeleteMode();
              }
            }}
            className={`flex-shrink-0 flex items-center gap-2 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${
              isDeleteMode && selectedScanDates.length > 0
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-gray-700 hover:bg-gray-600'
            }`}
            aria-label="Delete scan"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
        <div className={`relative w-full h-10 ${isDeleteMode ? 'opacity-75' : ''}`}>
            <div className="absolute bottom-4 w-full h-1.5 bg-gray-700 rounded-full">
                <div className="absolute top-0 left-0 h-full bg-cyan-500 rounded-full" style={{ width: '50%' }} />
                <button
                  onClick={() => {
                    if (isDeleteMode && onToggleScanSelection) {
                      onToggleScanSelection(scanDates[0]);
                    } else if (!isDeleteMode) {
                      onDateChange(scanDates[0]);
                    }
                  }}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all duration-200 ${
                    isSelected
                      ? 'w-5 h-5 bg-red-500 border-2 border-red-300 ring-2 ring-red-500 ring-offset-2 ring-offset-gray-900'
                      : 'w-4 h-4 bg-cyan-400 border-2 border-gray-900'
                  }`}
                  style={{ left: '50%' }}
                  aria-label={isDeleteMode ? `Select scan from ${scanDates[0]} for deletion` : `Go to scan from ${scanDates[0]}`}
                />
            </div>
            <div
              className="absolute bottom-[26px] -translate-x-1/2 pointer-events-none"
              style={{ left: '50%' }}
            >
                <div 
                className="px-3 py-1 bg-gray-800 text-white text-sm font-semibold rounded-md shadow-lg whitespace-nowrap"
                >
                {currentDate}
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-800"></div>
                </div>
            </div>
        </div>
        <button
          onClick={onAddScan}
          className="flex-shrink-0 flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
          aria-label="Add scan"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  // Multiple Scans State
  const thumbPositionPercent = scrubPosition * 100;
  const currentIndex = dateToIndex(currentDate);

  return (
    <div className="flex-1 max-w-lg flex items-center justify-center gap-4">
      {onToggleGlb && (
        <button
          onClick={onToggleGlb}
          className={`flex-shrink-0 flex items-center gap-2 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${
            isGlbActive
              ? 'bg-cyan-600 hover:bg-cyan-700'
              : 'bg-gray-700 hover:bg-gray-600'
          }`}
          aria-label="Toggle GLB"
        >
          GLB
        </button>
      )}
      {onToggleDeleteMode && (
        <button
          onClick={() => {
            if (isDeleteMode && selectedScanDates.length > 0 && onConfirmDelete) {
              onConfirmDelete();
            } else {
              onToggleDeleteMode();
            }
          }}
          className={`flex-shrink-0 flex items-center gap-2 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors ${
            isDeleteMode && selectedScanDates.length > 0
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-gray-700 hover:bg-gray-600'
          }`}
          aria-label="Delete scan"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      )}
      <div 
        ref={timelineRef}
        onMouseDown={handleMouseDown}
        className={`relative w-full h-10 ${isDeleteMode ? 'opacity-75' : ''}`}
        role={isDeleteMode ? undefined : "slider"}
        aria-valuemin={isDeleteMode ? undefined : 0}
        aria-valuemax={isDeleteMode ? undefined : scanDates.length - 1}
        aria-valuenow={isDeleteMode ? undefined : dateToIndex(currentDate)}
        aria-valuetext={isDeleteMode ? undefined : currentDate}
        tabIndex={isDeleteMode ? -1 : 0}
      >
        <div className={`absolute bottom-4 w-full h-1.5 bg-gray-700 rounded-full ${isDeleteMode ? '' : 'cursor-pointer group'}`}>
            {!isDeleteMode && (
              <div 
                className="absolute top-0 left-0 h-full bg-cyan-500 rounded-full transition-all duration-200"
                style={{ width: `${indexToPosition(dateToIndex(currentDate)) * 100}%` }}
              />
            )}
            {scanDates.map((date, index) => {
                const isActive = date === currentDate;
                const isSelected = isDeleteMode && selectedScanDates.includes(date);
                return (
                    <button
                        key={date}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (isDeleteMode && onToggleScanSelection) {
                              onToggleScanSelection(date);
                            } else {
                              onDateChange(date);
                            }
                        }}
                        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                            isDeleteMode
                              ? isSelected
                                ? 'w-5 h-5 bg-red-500 border-2 border-red-300 ring-2 ring-red-500 ring-offset-2 ring-offset-gray-900 z-10'
                                : 'w-4 h-4 bg-gray-500 border-2 border-gray-700 hover:bg-gray-400'
                              : isActive 
                              ? 'w-4 h-4 bg-cyan-400 border-2 border-gray-900 z-10' 
                              : 'w-2.5 h-2.5 bg-white hover:scale-125'
                        }`}
                        style={{ left: `${indexToPosition(index) * 100}%` }}
                        aria-label={isDeleteMode ? `Select scan from ${date} for deletion` : `Go to scan from ${date}`}
                    />
                );
            })}
            {!isDeleteMode && (
              <div 
                className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-gray-900 shadow-lg pointer-events-none transition-opacity duration-150 ${isScrubbing ? 'opacity-100' : 'opacity-0'}`}
                style={{ left: `calc(${thumbPositionPercent}% - 8px)` }}
              />
            )}
        </div>
        
        {!isDeleteMode && currentIndex !== -1 && (
            <div
                className="absolute bottom-[26px] -translate-x-1/2 pointer-events-none"
                style={{ left: `${indexToPosition(currentIndex) * 100}%` }}
            >
              <div
                className="px-3 py-1 bg-gray-800 text-white text-sm font-semibold rounded-md shadow-lg whitespace-nowrap"
              >
                {currentDate}
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-800"></div>
              </div>
            </div>
        )}
      </div>
       <button
          onClick={onAddScan}
          className="flex-shrink-0 flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors"
          aria-label="Add scan"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
    </div>
  );
};

export default TimelineScrubber;