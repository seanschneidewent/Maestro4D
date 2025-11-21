import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PlusIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';

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
  isBimActive?: boolean;
  onToggleBim?: () => void;
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
  onToggleGlb,
  isBimActive = false,
  onToggleBim
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
  
  // Prev/Next Handlers
  const handlePrevScan = () => {
    const currentIndex = dateToIndex(currentDate);
    if (currentIndex > 0) {
        onDateChange(scanDates[currentIndex - 1]);
    }
  };

  const handleNextScan = () => {
    const currentIndex = dateToIndex(currentDate);
    if (currentIndex < scanDates.length - 1) {
        onDateChange(scanDates[currentIndex + 1]);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Prevent keyboard navigation when in delete mode
        if (isDeleteMode) return;
        if (document.activeElement === document.body || (timelineRef.current && document.activeElement === timelineRef.current)) {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                handleNextScan();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                handlePrevScan();
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDate, dateToIndex, onDateChange, scanDates, isDeleteMode]);

  // Common button style class
  const buttonClass = "bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg h-[52px] px-4 flex items-center justify-center shadow-lg hover:border-cyan-500 transition-colors ring-2 ring-offset-2 ring-offset-gray-900 focus:outline-none focus:ring-cyan-400 text-gray-300 hover:text-white";
  const activeClass = "border-cyan-500 text-white bg-gray-800/80 ring-cyan-500";

  // Empty State
  if (!scanDates || scanDates.length === 0) {
    return (
        <div className="flex-1 flex items-center justify-center gap-4">
             <div 
                className="relative w-full max-w-lg h-1.5 bg-gray-700 rounded-full cursor-pointer opacity-50"
            />
            <button
                onClick={onAddScan}
                className={buttonClass}
            >
                <PlusIcon className="h-6 w-6 mr-2" />
                Add First Scan
            </button>
        </div>
    );
  }

  const thumbPositionPercent = scrubPosition * 100;
  const currentIndex = dateToIndex(currentDate);

  return (
    <div className="flex-1 flex items-center justify-center gap-3">
      {/* Left Controls Group */}
      {onToggleGlb && (
        <button
          onClick={onToggleGlb}
          className={`${buttonClass} ${isGlbActive ? activeClass : ''}`}
          aria-label="Toggle 3D"
        >
          <span className="font-bold">3D</span>
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
          className={`${buttonClass} ${isDeleteMode ? 'border-red-500 text-red-400 hover:border-red-400' : ''} ${isDeleteMode && selectedScanDates.length > 0 ? 'bg-red-900/50 text-white border-red-500 hover:bg-red-800' : ''}`}
          aria-label="Delete scan"
        >
          <TrashIcon className="h-5 w-5" />
        </button>
      )}

      <button 
        onClick={handlePrevScan} 
        disabled={currentIndex <= 0}
        className={`${buttonClass} ${currentIndex <= 0 ? 'opacity-50 cursor-not-allowed hover:border-gray-700' : ''}`}
        aria-label="Previous Scan"
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </button>

      {/* Scrubber */}
      <div className="flex-1 max-w-xl relative h-[52px] flex items-center px-4 bg-gray-900/40 backdrop-blur-sm border border-gray-700/50 rounded-lg mx-2">
        <div 
            ref={timelineRef}
            onMouseDown={handleMouseDown}
            className={`relative w-full h-8 flex items-center ${isDeleteMode ? 'opacity-75' : 'cursor-pointer'}`}
            role={isDeleteMode ? undefined : "slider"}
            aria-valuemin={isDeleteMode ? undefined : 0}
            aria-valuemax={isDeleteMode ? undefined : scanDates.length - 1}
            aria-valuenow={isDeleteMode ? undefined : dateToIndex(currentDate)}
            aria-valuetext={isDeleteMode ? undefined : currentDate}
            tabIndex={isDeleteMode ? -1 : 0}
        >
            <div className="absolute w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                {!isDeleteMode && (
                <div 
                    className="absolute top-0 left-0 h-full bg-cyan-500 rounded-full transition-all duration-200"
                    style={{ width: `${indexToPosition(dateToIndex(currentDate)) * 100}%` }}
                />
                )}
            </div>

            {/* Date Dots */}
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
                              ? 'w-4 h-4 bg-cyan-400 border-2 border-gray-900 z-10 shadow-[0_0_10px_rgba(34,211,238,0.5)]' 
                              : 'w-2.5 h-2.5 bg-white hover:scale-125 hover:bg-cyan-100'
                        }`}
                        style={{ left: `${indexToPosition(index) * 100}%` }}
                        aria-label={isDeleteMode ? `Select scan from ${date} for deletion` : `Go to scan from ${date}`}
                    />
                );
            })}
            
            {/* Scrub Thumb */}
            {!isDeleteMode && (
              <div 
                className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white border-2 border-cyan-500 shadow-lg pointer-events-none transition-opacity duration-150 z-20 ${isScrubbing ? 'opacity-100' : 'opacity-0'}`}
                style={{ left: `calc(${thumbPositionPercent}% - 10px)` }}
              />
            )}
        </div>

        {/* Date Label */}
        {!isDeleteMode && currentIndex !== -1 && (
            <div
                className="absolute bottom-10 pointer-events-none transition-all duration-300 transform"
                style={{ left: `${indexToPosition(currentIndex) * 100}%`, transform: `translateX(-50%)` }}
            >
              <div
                className="px-3 py-1 bg-gray-800 text-white text-sm font-semibold rounded-md shadow-lg whitespace-nowrap border border-gray-700"
              >
                {currentDate}
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-800"></div>
              </div>
            </div>
        )}
      </div>

      {/* Right Controls Group */}
      <button 
        onClick={handleNextScan}
        disabled={currentIndex >= scanDates.length - 1}
        className={`${buttonClass} ${currentIndex >= scanDates.length - 1 ? 'opacity-50 cursor-not-allowed hover:border-gray-700' : ''}`}
        aria-label="Next Scan"
      >
        <ChevronRightIcon className="h-6 w-6" />
      </button>

      <button
          onClick={onAddScan}
          className={buttonClass}
          aria-label="Add scan"
        >
          <PlusIcon className="h-6 w-6" />
      </button>

      {onToggleBim && (
        <button
          onClick={onToggleBim}
          className={`${buttonClass} ${isBimActive ? activeClass : ''}`}
          aria-label="Toggle BIM"
        >
          <span className="font-bold">BIM</span>
        </button>
      )}
    </div>
  );
};

export default TimelineScrubber;