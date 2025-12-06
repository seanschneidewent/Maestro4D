import React, { useState } from 'react';
import { DocumentIcon, ChevronDownIcon, ChevronRightIcon } from '../Icons';

export interface RetrievalResultItem {
    nodeId: string;
    relevance: 'high' | 'medium' | 'low' | 'summary';
    reason: string;
    score: number;
}

interface RetrievalResultProps {
  result: RetrievalResultItem;
  nodeDetails?: { name: string; path: string; summary?: string; markdown?: string };
}

export const RetrievalResultCard: React.FC<RetrievalResultProps> = ({ result, nodeDetails }) => {
    const [expanded, setExpanded] = useState(false);
    
    const color = {
        high: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50',
        medium: 'bg-amber-500/20 text-amber-400 border-amber-500/50',
        low: 'bg-slate-500/20 text-slate-400 border-slate-500/50',
        summary: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    }[result.relevance] || 'bg-slate-500/20 text-slate-400 border-slate-500/50';

    return (
        <div className="border border-slate-700 rounded bg-slate-800 mb-2 overflow-hidden">
            <div 
                className="p-3 flex items-start cursor-pointer hover:bg-slate-700/50"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="mr-2 mt-1">
                    {expanded ? <ChevronDownIcon className="h-4 w-4 text-slate-400"/> : <ChevronRightIcon className="h-4 w-4 text-slate-400"/>}
                </div>
                <div className="flex-1">
                    <div className="flex justify-between items-start">
                        <h4 className="font-medium text-slate-200 text-sm">
                            {nodeDetails?.name || result.nodeId}
                        </h4>
                        <span className={`text-xs px-2 py-0.5 rounded border ${color} capitalize`}>
                            {result.relevance}
                        </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mt-0.5">{nodeDetails?.path}</p>
                    <p className="text-sm text-slate-400 mt-2">{result.reason}</p>
                </div>
            </div>
            
            {expanded && (
                <div className="border-t border-slate-700 p-3 bg-slate-900/50">
                    <div className="prose prose-invert prose-sm max-w-none">
                        <pre className="whitespace-pre-wrap text-xs text-slate-400 font-mono overflow-auto max-h-60">
                            {nodeDetails?.markdown || "No content available"}
                        </pre>
                    </div>
                </div>
            )}
        </div>
    );
};

