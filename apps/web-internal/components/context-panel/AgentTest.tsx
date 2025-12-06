import React, { useState } from 'react';
import { SparklesIcon } from '../Icons';
import { RetrievalResultCard, RetrievalResultItem } from './RetrievalResult';
import { ContextNode } from './utils/db';

interface AgentTestProps {
    onSearch: (query: string) => Promise<void>;
    isSearching: boolean;
    results: RetrievalResultItem[];
    nodes: Map<string, ContextNode>;
    getMarkdown: (nodeId: string) => string | null;
}

export const AgentTest: React.FC<AgentTestProps> = ({ onSearch, isSearching, results, nodes, getMarkdown }) => {
    const [query, setQuery] = useState('');

    const handleSearch = () => {
        if (!query.trim()) return;
        onSearch(query);
    };

    const examples = [
        "Where are the structural columns located?",
        "Show me issues with deviation > 5mm",
        "What is the status of the mechanical room scan?"
    ];

    return (
        <div className="flex flex-col h-full bg-slate-900 p-4">
            <div className="mb-4">
                <div className="relative">
                    <input 
                        className="w-full bg-slate-800 text-white rounded p-3 pr-10 border border-slate-700 focus:border-blue-500 outline-none placeholder-slate-500"
                        placeholder="Ask a question to test retrieval..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    />
                    <button 
                        className="absolute right-2 top-2.5 text-slate-400 hover:text-white"
                        onClick={handleSearch}
                        disabled={isSearching}
                    >
                        {isSearching ? <div className="animate-spin h-5 w-5 border-2 border-blue-500 rounded-full border-t-transparent"/> : <SparklesIcon className="h-5 w-5" />}
                    </button>
                </div>
                
                {results.length === 0 && !isSearching && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {examples.map((ex, i) => (
                            <button 
                                key={i}
                                onClick={() => { setQuery(ex); onSearch(ex); }}
                                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 rounded-full px-3 py-1 transition-colors"
                            >
                                {ex}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {results.map((res, i) => {
                    const node = nodes.get(res.nodeId);
                    return (
                        <RetrievalResultCard 
                            key={i} 
                            result={res} 
                            nodeDetails={node ? {
                                name: node.name,
                                path: node.path,
                                markdown: getMarkdown(node.id) || undefined
                            } : undefined}
                        />
                    );
                })}
                {results.length === 0 && isSearching && (
                     <div className="text-center text-slate-500 mt-10">Searching context...</div>
                )}
                 {results.length === 0 && !isSearching && query && (
                     <div className="text-center text-slate-500 mt-10">No results found.</div>
                )}
            </div>
        </div>
    );
};

