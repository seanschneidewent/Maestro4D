import React, { useState, useMemo } from 'react';
import type { StreamingResult } from './hooks/useAIProcessing';
import { DocumentIcon, ChevronDownIcon, SpinnerIcon, CloseIcon, ExclamationCircleIcon, TrashIcon } from '../Icons';
import { clearProjectAIAnalysis } from '../../utils/api';

interface StreamingProcessedViewProps {
    isProcessing: boolean;
    progress: { current: number; total: number };
    processedPointers: StreamingResult[];
    error: string | null;
    onCancel: () => void;
    onReset: () => void;
    projectId: string;
}

export function StreamingProcessedView({
    isProcessing,
    progress,
    processedPointers,
    error,
    onCancel,
    onReset,
    projectId,
}: StreamingProcessedViewProps) {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [clearError, setClearError] = useState<string | null>(null);

    // Group pointers by sheet
    const pointersBySheet = useMemo(() => {
        const map = new Map<string, { fileName: string; pointers: StreamingResult[] }>();
        for (const result of processedPointers) {
            if (!map.has(result.sheetId)) {
                map.set(result.sheetId, { fileName: result.fileName, pointers: [] });
            }
            map.get(result.sheetId)!.pointers.push(result);
        }
        return map;
    }, [processedPointers]);

    const progressPercent = progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const toggleExpanded = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleConfirmClear = async () => {
        setShowClearConfirm(false);
        setIsClearing(true);
        setClearError(null);

        try {
            await clearProjectAIAnalysis(projectId);
            // Also reset local state
            onReset();
        } catch (err) {
            setClearError(err instanceof Error ? err.message : 'Failed to clear AI analysis');
        } finally {
            setIsClearing(false);
        }
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header with progress */}
            <div className="flex-none px-4 py-3 border-b border-gray-700">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-gray-200">
                        {isProcessing ? 'Processing...' : 'Processed Pointers'}
                    </h3>
                    {isProcessing ? (
                        <button
                            onClick={onCancel}
                            className="text-sm text-red-400 hover:text-red-300 transition-colors"
                        >
                            Cancel
                        </button>
                    ) : processedPointers.length > 0 ? (
                        <button
                            onClick={() => setShowClearConfirm(true)}
                            disabled={isClearing}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded transition-colors disabled:opacity-50"
                        >
                            <TrashIcon className="w-3.5 h-3.5" />
                            {isClearing ? 'Clearing...' : 'Clear All AI'}
                        </button>
                    ) : null}
                </div>

                {/* Progress bar */}
                {(isProcessing || progress.total > 0) && (
                    <div>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                            <span>{progress.current} of {progress.total} pointers</span>
                            <span>{progressPercent}%</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-cyan-500 transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Error display */}
                {error && (
                    <div className="mt-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex items-center gap-2">
                        <span className="flex-1">Error: {error}</span>
                        <button onClick={onReset} className="text-red-400 hover:text-red-300">
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {/* Clear AI Error */}
                {clearError && (
                    <div className="mt-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 flex items-center gap-2">
                        <span className="flex-1">{clearError}</span>
                        <button onClick={() => setClearError(null)} className="text-red-400 hover:text-red-300">
                            <CloseIcon className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {/* Pointer list */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {processedPointers.length === 0 && !isProcessing ? (
                    <div className="text-center py-12 text-gray-500">
                        <DocumentIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p>No processed pointers yet.</p>
                        <p className="text-sm mt-1 text-gray-600">
                            Add context pointers and click "Process with AI" to analyze them.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {Array.from(pointersBySheet.entries()).map(([sheetId, { fileName, pointers }]) => (
                            <div key={sheetId} className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/30">
                                {/* Sheet header */}
                                <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 flex items-center gap-2">
                                    <DocumentIcon className="w-4 h-4 text-cyan-400" />
                                    <h4 className="font-medium text-sm text-gray-200 flex-1">{fileName}</h4>
                                    <span className="text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">
                                        {pointers.length} pointer{pointers.length !== 1 ? 's' : ''}
                                    </span>
                                </div>

                                {/* Pointers */}
                                <div className="divide-y divide-gray-700/50">
                                    {pointers.map((result) => (
                                        <ProcessedPointerItem
                                            key={result.pointer.id}
                                            result={result}
                                            isExpanded={expandedIds.has(result.pointer.id)}
                                            onToggle={() => toggleExpanded(result.pointer.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Processing indicator for remaining items */}
                        {isProcessing && progress.current < progress.total && (
                            <div className="flex items-center gap-2 text-gray-400 px-4 py-2">
                                <SpinnerIcon className="w-4 h-4 text-cyan-400" />
                                <span className="text-sm">
                                    Processing {progress.total - progress.current} more...
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Clear AI Confirmation Dialog */}
            {showClearConfirm && (
                <div 
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setShowClearConfirm(false)}
                >
                    <div 
                        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md mx-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                                <ExclamationCircleIcon className="w-5 h-5 text-red-400" />
                            </div>
                            <h3 className="text-lg font-semibold text-gray-200">Clear All AI Analysis</h3>
                        </div>
                        <p className="text-gray-400 mb-4">
                            This will permanently delete AI analysis from <strong className="text-white">{processedPointers.length} pointers</strong> in the database.
                        </p>
                        <p className="text-sm text-red-400/80 mb-6">
                            You will need to re-process them with AI to restore the analysis.
                        </p>
                        <div className="flex items-center justify-end gap-3">
                            <button
                                onClick={() => setShowClearConfirm(false)}
                                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmClear}
                                className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                            >
                                Yes, Clear AI Analysis
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Simplified pointer item (based on ProcessedPointerCard pattern)
function ProcessedPointerItem({
    result,
    isExpanded,
    onToggle,
}: {
    result: StreamingResult;
    isExpanded: boolean;
    onToggle: () => void;
}) {
    const { pointer } = result;
    const { originalMetadata, aiAnalysis } = pointer;

    return (
        <div className="bg-gray-900/30">
            <button
                onClick={onToggle}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800/50 text-left transition-colors"
            >
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-200 truncate">
                        {originalMetadata.title || pointer.id}
                    </p>
                    <p className="text-xs text-gray-500">
                        Page {originalMetadata.pageNumber}
                        {aiAnalysis && (
                            <span className="ml-2 text-cyan-400">
                                • {aiAnalysis.tradeCategory}
                            </span>
                        )}
                    </p>
                </div>
                <ChevronDownIcon
                    className={`w-5 h-5 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? '' : '-rotate-90'}`}
                />
            </button>

            {isExpanded && aiAnalysis && (
                <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-700/50 space-y-3">
                    {/* Technical Description */}
                    <div>
                        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                            AI Analysis
                        </p>
                        <p className="text-sm text-gray-300">{aiAnalysis.technicalDescription}</p>
                    </div>

                    {/* Trade Category */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase">Trade:</span>
                        <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs font-medium rounded">
                            {aiAnalysis.tradeCategory}
                        </span>
                    </div>

                    {/* Identified Elements */}
                    {aiAnalysis.identifiedElements && aiAnalysis.identifiedElements.length > 0 && (
                        <div>
                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Elements
                            </p>
                            <div className="flex flex-wrap gap-1">
                                {aiAnalysis.identifiedElements.map((el, i) => (
                                    <span key={i} className="px-2 py-0.5 bg-gray-700 border border-gray-600 rounded text-xs text-gray-300">
                                        {typeof el === 'string' ? el : el.name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recommendations */}
                    {aiAnalysis.recommendations && (
                        <div>
                            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                                Recommendations
                            </p>
                            <p className="text-sm text-gray-300">{aiAnalysis.recommendations}</p>
                        </div>
                    )}
                </div>
            )}

            {/* Show error state if analysis failed */}
            {isExpanded && !aiAnalysis && pointer.error && (
                <div className="px-4 py-3 bg-red-500/10 border-t border-red-500/30">
                    <p className="text-sm text-red-400">
                        Analysis failed: {pointer.error}
                    </p>
                </div>
            )}
        </div>
    );
}

export default StreamingProcessedView;

