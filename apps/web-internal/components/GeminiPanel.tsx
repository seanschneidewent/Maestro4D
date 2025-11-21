

import React, { useState, useRef, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CloseIcon, SendIcon, ArrowUpIcon, ArrowDownIcon, DocumentIcon, MarketIntelIcon, SpecSearchIcon } from './Icons';
import { AgentType, AgentState, Message, SerializableFile } from '../types';
import { saveFileToDB, deleteFileFromDB } from '../utils/db';

// --- TYPES ---
interface Material {
    name: string;
    price: number;
    unit: string;
    change: number;
    volatility: number;
    trend: 'up' | 'down';
}

// --- MOCK RESPONSE GENERATOR ---
const getMockResponse = (agent: AgentType, query: string, files: SerializableFile[]): string => {
    const lowerQuery = query.toLowerCase();
    if (agent === 'market') {
        if (lowerQuery.includes('steel')) {
            return "Steel prices have seen a 2.91% increase recently due to supply chain disruptions. Given the current volatility of 3.5, it would be prudent to lock in prices for the next quarter if your project schedule allows.";
        }
        if (lowerQuery.includes('concrete') || lowerQuery.includes('lumber')) {
            return "Concrete prices are relatively stable, showing a slight decrease. Lumber, however, is trending upwards. I'd recommend prioritizing lumber procurement.";
        }
        return "The market is showing mixed trends. Structural materials like steel and rebar are on an uptrend, while concrete and copper wire have seen slight dips. What material are you most interested in?";
    }
    
    if (agent === 'spec') {
        if (files.length === 0) {
            return "Please upload project documents first so I can answer your questions accurately. I can analyze DWG, PDF, and CSV files.";
        }

        const fileName = files[0]?.name || 'the document';

        if (lowerQuery.includes('fire rating') || lowerQuery.includes('stairwell')) {
            return `According to drawing A-101 in '${fileName}', the fire rating requirement for the stairwell walls is specified as 2-hours.`;
        }
        if (lowerQuery.includes('hvac') || lowerQuery.includes('system')) {
            return `The mechanical drawings (M-series) in '${fileName}' specify a Variable Refrigerant Flow (VRF) system. See sheet M-502 for detailed equipment schedules.`;
        }
        if (lowerQuery.includes('concrete') || lowerQuery.includes('psi')) {
            return `The structural specifications in '${fileName}' call for 4000 PSI concrete for all foundation slabs (see section 03 30 00 - Cast-in-Place Concrete).`;
        }
        return `I've reviewed the documents you've uploaded. What specific information are you looking for from '${fileName}'?`;
    }
    
    return "I am ready to assist you. Please ask a question related to my function.";
}


// --- ICONS ---
export const AgentsLogo: React.FC = () => (
    <h2 className="text-xl font-extrabold tracking-wider">
      <span className="bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text">
        AGENTS
      </span>
    </h2>
);

const FileIcon: React.FC<{ fileName: string }> = ({ fileName }) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    let color = 'text-gray-400';
    if (extension === 'pdf') color = 'text-red-400';
    else if (extension === 'csv') color = 'text-green-400';
    else if (extension === 'dwg') color = 'text-blue-400';
    
    return (
        <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
    );
};

// --- SUB-COMPONENTS ---
const LoadingIndicator: React.FC = () => (
    <div className="flex items-center space-x-2">
        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
    </div>
);

const PriceDashboard: React.FC<{ marketData: Material[] }> = ({ marketData }) => (
    <div className="p-4 bg-gray-900/50 rounded-lg h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
            <h4 className="font-bold text-white">Live Price Dashboard</h4>
            <div className="flex items-center gap-2">
                <div className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </div>
                <span className="text-sm font-semibold text-green-400">Live</span>
            </div>
        </div>
        <div className="space-y-3 flex-1 overflow-y-auto">
            {marketData.map(m => (
                <div key={m.name} className="flex justify-between items-center text-sm">
                    <span className="text-gray-300 w-2/5 truncate">{m.name}</span>
                    <div className="flex items-center gap-2 w-3/5 justify-end">
                        <div className={`flex items-center font-semibold w-20 ${m.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                            {m.trend === 'up' ? <ArrowUpIcon className="h-3 w-3" /> : <ArrowDownIcon className="h-3 w-3" />}
                            <span>{m.change.toFixed(2)}%</span>
                        </div>
                        <span className="text-white font-mono w-32 text-right">${m.price.toFixed(2)}/{m.unit}</span>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

const FileUpload: React.FC<{ 
    uploadedFiles: SerializableFile[], 
    onFilesAdded: (files: File[]) => void, 
    onFileRemoved: (index: number) => void,
    isDragging: boolean, 
    onDraggingChange: (isDragging: boolean) => void 
}> = ({ uploadedFiles, onFilesAdded, onFileRemoved, isDragging, onDraggingChange }) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropRef = useRef<HTMLDivElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            onFilesAdded(Array.from(e.target.files));
        }
    };
    
    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDragIn = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            onDraggingChange(true);
        }
    }, [onDraggingChange]);
    
    const handleDragOut = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onDraggingChange(false);
    }, [onDraggingChange]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onDraggingChange(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFilesAdded(Array.from(e.dataTransfer.files));
            e.dataTransfer.clearData();
        }
    }, [onDraggingChange, onFilesAdded]);

    const acceptedTypes = ".pdf,.dwg,.csv";

    return (
        <div className="p-4 bg-gray-900/50 rounded-lg h-full flex flex-col">
            <h4 className="font-bold text-white mb-4">Project Documents</h4>
            <div 
                ref={dropRef}
                onDragEnter={handleDragIn}
                onDragLeave={handleDragOut}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                    isDragging ? 'border-cyan-500 bg-cyan-900/20' : 'border-gray-600 hover:border-cyan-600'
                }`}
            >
                <input type="file" ref={fileInputRef} onChange={handleFileChange} multiple className="hidden" accept={acceptedTypes} />
                <p className="text-gray-400">Drag & drop files here</p>
                <p className="text-xs text-gray-500 mt-1">or click to browse (PDF, DWG, CSV)</p>
            </div>
            <div className="mt-4 h-24 overflow-y-auto pr-2">
                <ul className="space-y-2">
                    {uploadedFiles.map((file, i) => (
                        <li key={i} className="flex items-center gap-3 bg-gray-800/50 p-2 rounded-md text-sm">
                            <FileIcon fileName={file.name} />
                            <span className="text-gray-300 truncate flex-1">{file.name}</span>
                            <span className="text-gray-500 font-mono text-xs">{(file.size / 1024).toFixed(1)} KB</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onFileRemoved(i);
                                }}
                                className="p-1 rounded-full text-gray-500 hover:bg-gray-700 hover:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                                aria-label={`Remove ${file.name}`}
                            >
                                <CloseIcon className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

interface ChatInterfaceProps {
    chatHistory: Message[];
    isLoading: boolean;
    inputValue: string;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSendMessage: (e: React.FormEvent) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ chatHistory, isLoading, inputValue, onInputChange, onSendMessage }) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatHistory, isLoading]);

    return (
        <div className="flex flex-col h-full bg-gray-900/50 rounded-lg p-4">
            <div className="flex-1 overflow-y-auto mb-4 pr-2 space-y-4">
                {chatHistory.map((msg, index) => (
                    <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-xs md:max-w-md lg:max-w-lg rounded-lg px-4 py-2 ${msg.role === 'user' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                           <p className="whitespace-pre-wrap text-sm">{msg.parts[0].text}</p>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-gray-700 rounded-lg px-4 py-3"> <LoadingIndicator /> </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>
            <form onSubmit={onSendMessage} className="flex items-center space-x-2 border-t border-gray-700 pt-4">
                <input
                    type="text" value={inputValue} onChange={onInputChange}
                    placeholder="Ask a question..."
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-full py-2 px-4 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    aria-label="Chat input"
                />
                <button
                    type="submit"
                    className="bg-cyan-600 text-white p-2.5 rounded-full hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500"
                    aria-label="Send message"
                    disabled={!inputValue.trim() || isLoading}
                >
                    <SendIcon className="h-5 w-5" />
                </button>
            </form>
        </div>
    );
};

// --- MAIN COMPONENT ---

interface GeminiPanelProps {
    agentStates: Record<AgentType, AgentState>;
    onAgentStatesChange: React.Dispatch<React.SetStateAction<Record<AgentType, AgentState>>>;
    isLauncherOpen: boolean;
    onLauncherOpenChange: (isOpen: boolean) => void;
}


const GeminiPanel: React.FC<GeminiPanelProps> = ({ agentStates, onAgentStatesChange, isLauncherOpen, onLauncherOpenChange }) => {
    const [selectedAgent, setSelectedAgent] = useState<AgentType | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [ai, setAi] = useState<any | null>(null);

    const [marketData, setMarketData] = useState<Material[]>([
        { name: 'Structural Steel', price: 4250, unit: 'ton', change: 2.91, volatility: 3.5, trend: 'up' },
        { name: 'Concrete', price: 135, unit: 'cubic yard', change: -0.5, volatility: 0.8, trend: 'down' },
        { name: 'Lumber', price: 480, unit: '1000 board ft', change: 1.2, volatility: 4.1, trend: 'up' },
        { name: 'Rebar', price: 950, unit: 'ton', change: 3.5, volatility: 2.9, trend: 'up' },
        { name: 'Copper Wire', price: 4.50, unit: 'lb', change: -1.8, volatility: 3.2, trend: 'down' },
        { name: 'Drywall', price: 15, unit: 'sheet', change: 0.75, volatility: 1.1, trend: 'up' },
    ]);
    const [isDragging, setIsDragging] = useState(false);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    
    // Simulate AI Agent availability for demo purposes
    useEffect(() => {
        setAi({});
    }, []);

    useEffect(() => {
        if (selectedAgent !== 'market') return;
        const interval = setInterval(() => {
            setMarketData(prevData => prevData.map(material => {
                const changePercent = (Math.random() - 0.49) * 0.05; // -2.5% to +2.5%
                const newPrice = Math.max(0, material.price * (1 + changePercent));
                return {
                    ...material,
                    price: newPrice,
                    change: changePercent * 100,
                    trend: changePercent >= 0 ? 'up' : 'down',
                    volatility: Math.random() * 5,
                };
            }));
        }, 5000);
        return () => clearInterval(interval);
    }, [selectedAgent]);
    
    const handleSelectAgent = (agent: AgentType) => {
        setSelectedAgent(agent);
        onLauncherOpenChange(false);
    };

    const handleCloseAgent = () => {
        setSelectedAgent(null);
    };
    
    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim() || !ai || !selectedAgent) return;

        const userMessageText = inputValue;
        const agent = selectedAgent;
        setInputValue('');
        
        const currentAgentState = agentStates[agent];
        const newChatHistory: Message[] = [...currentAgentState.chatHistory, { role: 'user', parts: [{ text: userMessageText }] }];
        
        onAgentStatesChange(prev => ({
            ...prev,
            [agent]: { ...prev[agent], chatHistory: newChatHistory }
        }));
        setIsLoading(true);

        if (agent === 'spec' && currentAgentState.uploadedFiles.length === 0) {
            setTimeout(() => {
                const warningMessage: Message = { role: 'model', parts: [{ text: "Please upload project documents first. I can analyze DWG, PDF, and CSV files." }] };
                onAgentStatesChange(prev => ({
                    ...prev,
                    [agent]: { ...prev[agent], chatHistory: [...prev[agent].chatHistory, warningMessage] }
                }));
                setIsLoading(false);
            }, 500);
            return;
        }

        // Simulate API call with mock response
        setTimeout(() => {
            const mockResponseText = getMockResponse(agent, userMessageText, currentAgentState.uploadedFiles);
            const assistantMessage: Message = { role: 'model', parts: [{ text: mockResponseText }] };
            onAgentStatesChange(prev => ({
                ...prev,
                [agent]: { ...prev[agent], chatHistory: [...prev[agent].chatHistory, assistantMessage] }
            }));
            setIsLoading(false);
        }, 1000 + Math.random() * 800);
    };

    const handleGenerateReport = async () => {
        if (!ai) return;
        setIsGeneratingReport(true);
    
        // Using a timeout to ensure UI updates before blocking the thread for PDF generation
        setTimeout(() => {
            const doc = new jsPDF();
            const pageHeight = doc.internal.pageSize.height;
            const pageWidth = doc.internal.pageSize.width;
            let currentY = 0;
    
            // Helper functions
            const addFooter = () => {
                // Fix: Correctly call `doc.getNumberOfPages()` instead of `doc.internal.getNumberOfPages()`
                const pageCount = doc.getNumberOfPages();
                const timestamp = new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ' ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                
                for (let i = 1; i <= pageCount; i++) {
                    doc.setPage(i);
                    doc.setFontSize(8);
                    doc.setTextColor(107, 114, 128); // gray-500
                    doc.text('Maestro 4D - Construction Intelligence Platform', 14, pageHeight - 10);
                    doc.text(`Report generated: ${timestamp}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
                    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
                }
            };
    
            const addHeader = (title: string, date: string) => {
                doc.setFillColor(45, 55, 71); // gray-700
                doc.rect(0, 0, pageWidth, 28, 'F');
                doc.setFontSize(18);
                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold');
                doc.text(title, pageWidth / 2, 16, { align: 'center' });
                
                doc.setFontSize(10);
                doc.setTextColor(156, 163, 175); // gray-400
                doc.setFont('helvetica', 'normal');
                doc.text(`Report Date: ${date}`, pageWidth / 2, 23, { align: 'center' });
                currentY = 40;
            };
    
            const addSectionTitle = (title: string) => {
                doc.setFontSize(14);
                doc.setTextColor(15, 20, 25);
                doc.setFont('helvetica', 'bold');
                doc.text(title, 14, currentY);
                doc.setDrawColor(229, 231, 235); // gray-200
                doc.line(14, currentY + 2, pageWidth - 14, currentY + 2);
                currentY += 10;
            };
    
            const addSubTitle = (title: string) => {
                doc.setFontSize(11);
                doc.setTextColor(15, 20, 25);
                doc.setFont('helvetica', 'bold');
                doc.text(title, 14, currentY);
                currentY += 6;
            };
    
            const addParagraph = (text: string, indent = 0) => {
                doc.setFontSize(10);
                doc.setTextColor(55, 65, 81); // gray-700
                doc.setFont('helvetica', 'normal');
                const lines = doc.splitTextToSize(text, pageWidth - 28 - indent);
                doc.text(lines, 14 + indent, currentY);
                currentY += lines.length * 4.5;
                currentY += 4; // Spacing after paragraph
            };
    
            const checkPageBreak = (spaceNeeded: number) => {
                if (currentY + spaceNeeded > pageHeight - 20) {
                    doc.addPage();
                    currentY = 20;
                }
            };
    
            // --- PAGE 1: EXECUTIVE SUMMARY ---
            addHeader("CONSTRUCTION MATERIAL MARKET ANALYSIS REPORT", new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
            
            addSectionTitle("EXECUTIVE SUMMARY");
            addParagraph("The construction materials market in late 2025 continues to experience moderate volatility driven by persistent supply chain challenges, geopolitical tensions, and domestic policy shifts including potential tariff implementations. While the extreme price spikes of 2021-2022 have stabilized, material costs remain 29-43% above pre-pandemic levels, establishing a new baseline for project budgeting.");
            addParagraph("Key market drivers include ongoing labor shortages in manufacturing and logistics, regional supply constraints, currency fluctuations, and elevated energy costs. Steel prices have shown an 11.2% year-over-year increase through 2024, while lumber prices remain above historical norms despite recent stabilization. Concrete and cement face steady upward pressure from transportation bottlenecks and regional shortages.");
            addParagraph("This report analyzes current pricing trends across six critical construction materials, assesses market volatility metrics, and provides strategic procurement recommendations to mitigate budget risk in the current market environment.");
            currentY += 5;
    
            addSectionTitle("CURRENT MARKET SNAPSHOT");
    
            autoTable(doc, {
                startY: currentY,
                head: [['Material', 'Current Price', '30-Day Change', 'Volatility Index', 'Market Signal']],
                body: marketData.map(m => ([
                    m.name,
                    `$${m.price.toFixed(2)} / ${m.unit}`,
                    `${m.change.toFixed(2)}%`,
                    m.volatility.toFixed(1),
                    m.trend === 'up' ? `▲ Bullish` : `▼ Bearish`,
                ])),
                theme: 'grid',
                headStyles: { fillColor: [45, 55, 71] },
                didDrawCell: (data) => {
                    if (data.section === 'body') {
                        // Color 30-Day Change
                        if (data.column.index === 2) {
                            const value = parseFloat((data.cell.text as string[])[0]);
                            if (value > 0) doc.setTextColor(34, 197, 94); // green
                            else if (value < 0) doc.setTextColor(239, 68, 68); // red
                        }
                        // Color Market Signal
                        if (data.column.index === 4) {
                            if ((data.cell.text as string[])[0].includes('Bullish')) {
                                doc.setTextColor(34, 197, 94); // green
                            } else {
                                doc.setTextColor(239, 68, 68); // red
                            }
                        }
                    }
                }
            });
            currentY = (doc as any).lastAutoTable.finalY + 10;
    
            // --- PAGE 2-3: MATERIAL ANALYSIS ---
            doc.addPage();
            currentY = 20;
            addSectionTitle("MARKET ANALYSIS BY MATERIAL CATEGORY");
    
            const materialsToDetail = ['Structural Steel', 'Concrete', 'Lumber'];
            const materialDetails: Record<string, any> = {
                'Structural Steel': {
                    overview: "Steel prices have increased 11.2% year-over-year through 2024 due to supply chain disruptions and potential tariff implementations. Current volatility indicates moderate market uncertainty driven by domestic production constraints and international trade policies.",
                    drivers: "Import tariffs on steel and aluminum have created upward pressure on domestic pricing. Transportation bottlenecks and energy costs continue to impact mill production. Post-disaster rebuilding efforts and infrastructure spending maintain elevated demand.",
                    strategy_bullish: "Given the upward trend and volatility, contractors should consider locking in prices for near-term projects. Diversify supplier base to mitigate regional supply chain risks. For projects extending beyond Q2 2026, include escalation clauses in contracts.",
                    strategy_bearish: "The recent price dip offers a short-term buying opportunity. However, with underlying volatility, long-term contracts should still include price escalation clauses. Maintain a diverse supplier base to hedge against regional price spikes."
                },
                'Concrete': {
                    overview: "Concrete prices have seen steady increases driven by cement shortages and transportation costs. The relatively low volatility suggests more predictable pricing compared to metals and lumber, though regional variations persist.",
                    drivers: "Cement production capacity constraints and elevated diesel costs impact delivered pricing. Commercial and residential construction demand maintains baseline pressure. Regional shortages in aggregates create localized price spikes.",
                    strategy_bullish: "While the price increase is modest, the consistent upward pressure suggests early procurement for foundation work is wise. Consider bulk pre-purchase agreements for large pours and factor in a 1.2% projected annual increase for budget planning.",
                    strategy_bearish: "The current price decline presents a procurement opportunity for foundation work. Consider bulk pre-purchase agreements for large pours. Factor in a 1.2% projected annual increase for 2026 budget planning as the long-term trend remains upward."
                },
                'Lumber': {
                    overview: "Lumber prices have stabilized from pandemic-era peaks but remain above historical averages. High volatility reflects ongoing timber shortages, mill labor constraints, and Canadian trade dynamics including 40% tariff rates on softwood lumber.",
                    drivers: "Timber supply constraints from reduced harvesting. Mill production limitations from labor shortages. Canadian import tariffs creating domestic supply pressure. Wildfire recovery demands in affected regions.",
                    strategy_bullish: "Rising prices suggest early procurement for framing packages. Explore engineered wood alternatives where specifications allow. Establish relationships with multiple suppliers across different regions to hedge supply risk.",
                    strategy_bearish: "This price stabilization may be temporary given the high volatility. It is a good time to secure framing packages for immediate needs. Continue to explore engineered wood alternatives and diversify suppliers to mitigate risks from tariffs and wildfires."
                }
            };
    
            materialsToDetail.forEach(name => {
                const material = marketData.find(m => m.name === name);
                if (!material) return;
    
                const details = materialDetails[name];
                checkPageBreak(90); // Estimate space needed
                addSubTitle(name === 'Concrete' ? 'Ready-Mix Concrete' : name === 'Lumber' ? 'Softwood Lumber' : name);
                
                doc.setFontSize(10);
                doc.setTextColor(55, 65, 81);
                doc.setFont('helvetica', 'bold');
                doc.text(`Current Price: $${material.price.toFixed(2)} / ${material.unit} | Change: ${material.change.toFixed(2)}% | Volatility: ${material.volatility.toFixed(1)}`, 14, currentY);
                currentY += 8;
    
                doc.setFont('helvetica', 'bold');
                doc.text('Market Overview:', 14, currentY);
                currentY += 4;
                addParagraph(details.overview, 0);
    
                doc.setFont('helvetica', 'bold');
                doc.text('Price Drivers:', 14, currentY);
                currentY += 4;
                addParagraph(details.drivers, 0);
    
                doc.setFont('helvetica', 'bold');
                doc.text('Procurement Strategy:', 14, currentY);
                currentY += 4;
                addParagraph(material.trend === 'up' ? details.strategy_bullish : details.strategy_bearish, 0);
                currentY += 5;
            });
    
            // --- PAGE 4: RISK ASSESSMENT ---
            doc.addPage();
            currentY = 20;
            addSectionTitle("VOLATILITY RISK ASSESSMENT");
    
            addParagraph("Material price volatility in Q4 2025 is characterized by moderate to high uncertainty across multiple categories. Our volatility index measures price fluctuation intensity on a 0-10 scale, with values above 3.0 indicating elevated procurement risk.");
            
            const highRisk = marketData.filter(m => m.volatility > 3.0).map(m => m.name).join(', ');
            const moderateRisk = marketData.filter(m => m.volatility >= 1.5 && m.volatility <= 3.0).map(m => m.name).join(', ');
            const lowRisk = marketData.filter(m => m.volatility < 1.5).map(m => m.name).join(', ');
    
            addSubTitle(`High Risk Materials (Volatility > 3.0): ${highRisk || 'None'}`);
            addParagraph("These materials require active price monitoring, supplier diversification, and contract escalation clauses.");
    
            addSubTitle(`Moderate Risk Materials (Volatility 1.5-3.0): ${moderateRisk || 'None'}`);
            addParagraph("Standard procurement practices with quarterly price reviews are appropriate.");
            
            addSubTitle(`Low Risk Materials (Volatility < 1.5): ${lowRisk || 'None'}`);
            addParagraph("These materials demonstrate relative price stability suitable for longer-term fixed pricing.");
            
            currentY += 5;
            addSubTitle("Primary Risk Factors");
            addParagraph("(1) Tariff policy implementation and trade agreement changes, (2) Diesel fuel price fluctuations affecting transportation costs, (3) Regional supply chain disruptions from weather events or labor actions, (4) Currency exchange rate volatility for imported materials, (5) Demand surges from infrastructure spending and disaster recovery.");
    
            // --- PAGE 5-6: STRATEGIC RECOMMENDATIONS ---
            doc.addPage();
            currentY = 20;
            addSectionTitle("STRATEGIC PROCUREMENT RECOMMENDATIONS");
            addParagraph("Based on current market conditions and volatility analysis, we recommend the following strategies:");
    
            const highVolMaterials = marketData.filter(m => m.volatility > 3.0).map(m => m.name).join(', ');
            const upwardTrendMaterials = marketData.filter(m => m.change > 1.5).map(m => m.name).join(', ');
            
            addSubTitle("1. CONTRACT STRUCTURE & RISK ALLOCATION");
            addParagraph(`• Include material price escalation clauses tied to recognized indices (ENR, PPI)\n• Implement allowance provisions for high-volatility materials (${highVolMaterials || 'N/A'})\n• Consider two-stage procurement to enable early supply chain engagement\n• Define force majeure language addressing tariffs and policy changes`);
            
            checkPageBreak(40);
            addSubTitle("2. PROCUREMENT TIMING & INVENTORY STRATEGY");
            addParagraph(`• Accelerate procurement for materials showing upward trends: ${upwardTrendMaterials || 'None'}\n• Establish early procurement agreements for critical path materials\n• Balance just-in-time delivery with strategic inventory for volatile items\n• Coordinate with project schedules to align material drawdown with price stability windows`);
            
            checkPageBreak(40);
            addSubTitle("3. SUPPLIER RELATIONSHIP & DIVERSIFICATION");
            addParagraph("• Develop relationships with minimum three suppliers per material category\n• Diversify geographic sourcing to mitigate regional disruption risk\n• Negotiate volume purchase agreements for predictable demand\n• Establish preferred vendor programs with price visibility commitments");
    
            checkPageBreak(40);
            addSubTitle("4. COST MONITORING & FINANCIAL CONTROLS");
            addParagraph("• Implement weekly price tracking for high-volatility materials\n• Monitor leading indicators: diesel prices, steel futures, timber supply reports\n• Integrate material cost forecasting into project controls and risk registers\n• Maintain cash flow buffers of 8-12% for material cost escalation");
            
            checkPageBreak(40);
            addSubTitle("5. MARKET INTELLIGENCE & ADAPTIVE PLANNING");
            addParagraph("• Subscribe to industry cost indices (ENR, Rider Levett Bucknall, JLL TPI)\n• Monitor federal policy developments affecting tariffs and infrastructure spending\n• Participate in regional procurement consortiums for market intelligence sharing\n• Conduct quarterly market reviews to adjust procurement strategies");
            
            checkPageBreak(40);
            addSubTitle("6. CONTRACTUAL AND LEGAL PROTECTIONS");
            addParagraph("• Ensure subcontracts contain clear language regarding material price volatility.\n• Review insurance policies for coverage related to supply chain disruptions.\n• Consult legal counsel to understand liabilities and remedies under force majeure events related to trade policy.");
    
            // --- PAGE 7: MARKET OUTLOOK ---
            doc.addPage();
            currentY = 20;
            addSectionTitle("Q1-Q2 2025 MARKET OUTLOOK");
            addParagraph("Industry forecasts suggest continued moderate cost growth through mid-2025. JLL projects 5-7% construction cost increases, with the Tender Price Index (TPI) expected to rise 2.5% in 2025 and 3.0% in 2026. Material-specific trends:");
            addSubTitle("Steel & Metals");
            addParagraph("Elevated prices likely to persist through Q2 2025 due to tariff uncertainty and infrastructure demand. Volatility expected to remain above 3.0. Potential for 3-5% additional increases if new tariff policies are implemented.");
            addSubTitle("Concrete & Cement");
            addParagraph("Steady 1-2% growth trajectory with regional variations. Transportation costs remain the primary driver. Relatively low volatility supports planning confidence.");
            addSubTitle("Lumber");
            addParagraph("Prices expected to stabilize mid-2025 but remain above pre-pandemic levels. High volatility will continue due to trade policy uncertainty. Monitor Canadian mill production and wildfire impacts.");
            addSubTitle("Electrical & MEP");
            addParagraph("Copper and aluminum prices remain elevated. Supply constraints for transformers and electrical equipment may impact project schedules. Factor 6-8% annual growth for electrical components.");
            addSubTitle("Finishes & Specialties");
            addParagraph("Drywall and interior materials seeing moderate 3-4% annual increases. Gypsum supply and trucking costs are primary drivers. Lower volatility enables standard procurement.");
            addParagraph("The construction market in 2025 requires proactive cost management, strong supplier relationships, and flexible contract structures. Firms that implement comprehensive procurement strategies and maintain market intelligence will be best positioned to navigate volatility and protect project margins.");
            
            // --- PAGE 8: DISCLAIMER ---
            doc.addPage();
            currentY = 20;
            addSectionTitle("DISCLAIMER AND METHODOLOGY");
            addSubTitle("Data Sources");
            addParagraph("This report is compiled using a combination of public and proprietary data sources, including but not limited to the Engineering News-Record (ENR) Construction Cost Index, Producer Price Index (PPI), JLL, and Rider Levett Bucknall market reports. Pricing data reflects national averages and may not represent specific regional market conditions.");
            addSubTitle("Forward-Looking Statements");
            addParagraph("This document contains forward-looking statements based on current market conditions and economic forecasts. Actual results may differ materially from those projected. Maestro 4D assumes no obligation to update these statements.");
            addSubTitle("Limitations and Recommendations");
            addParagraph("The information provided is for informational purposes only and should not be construed as financial or legal advice. All procurement decisions should be made in consultation with project stakeholders, financial advisors, and legal counsel. This analysis is not a substitute for project-specific cost estimating and scheduling.");
    
            currentY = pageHeight - 40;
            doc.setDrawColor(156, 163, 175);
            doc.line(14, currentY, pageWidth - 14, currentY);
            currentY += 5;
            doc.setFont('helvetica', 'bold');
            doc.text("About Maestro 4D", 14, currentY);
            currentY += 4;
            addParagraph("Maestro 4D provides a construction intelligence platform designed to mitigate risk and enhance project certainty. © 2025 Maestro 4D. All rights reserved.");
    
            // --- FINALIZATION ---
            addFooter();
            doc.save(`Maestro4D_Market_Report_${new Date().toISOString().split('T')[0]}.pdf`);
            setIsGeneratingReport(false);
        }, 100); // Small timeout to let state update
    };
    
    const fileToSerializable = async (file: File): Promise<SerializableFile> => {
        try {
            const id = await saveFileToDB(file, file.name, file.type);
            return {
                name: file.name,
                type: file.type,
                size: file.size,
                storageId: id
            };
        } catch (error) {
            console.error("Failed to save file to DB, falling back to base64", error);
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => resolve({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    content: reader.result as string,
                });
                reader.onerror = error => reject(error);
            });
        }
    };

    const handleFilesAdded = async (newFiles: File[]) => {
        if (!selectedAgent) return;
        const validFiles = newFiles.filter(file => /\.(pdf|dwg|csv)$/i.test(file.name));

        const serializableFiles = await Promise.all(validFiles.map(fileToSerializable));
        
        if (serializableFiles.length > 0) {
            const successMessage: Message = { role: 'model', parts: [{ text: `Successfully uploaded ${serializableFiles.length} document(s). I am ready to answer your questions.` }] };
            onAgentStatesChange(prev => {
                const currentAgent = prev[selectedAgent!];
                return {
                    ...prev,
                    [selectedAgent!]: {
                        ...currentAgent,
                        uploadedFiles: [...currentAgent.uploadedFiles, ...serializableFiles],
                        chatHistory: [...currentAgent.chatHistory, successMessage]
                    }
                }
            });
        }
    };

    const handleFileRemoved = (indexToRemove: number) => {
        if (!selectedAgent) return;
        
        const fileToDelete = agentStates[selectedAgent].uploadedFiles[indexToRemove];
        if (fileToDelete?.storageId) {
             deleteFileFromDB(fileToDelete.storageId).catch(console.error);
        }

        onAgentStatesChange(prev => ({
            ...prev,
            [selectedAgent]: {
                ...prev[selectedAgent],
                uploadedFiles: prev[selectedAgent].uploadedFiles.filter((_, index) => index !== indexToRemove)
            }
        }));
    };

    const renderAgentUI = () => {
        const baseClasses = "w-full rounded-2xl bg-gradient-to-r from-blue-500 to-cyan-400 p-px shadow-lg transition-all duration-300 ease-in-out transform-gpu animate-fade-in-up pointer-events-auto max-w-4xl h-[400px]";
        const innerBaseClasses = "w-full h-full bg-gray-900/80 backdrop-blur-sm rounded-[15px] p-4 flex flex-col gap-3";

        if (!ai) {
            // This will briefly show while the mock AI is "initializing"
            return (
                <div className={baseClasses}>
                    <div className="w-full h-full rounded-[15px] bg-gray-900 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400"></div>
                    </div>
                </div>
            );
        }

        if (!selectedAgent) {
            return null;
        }

        const currentAgentState = agentStates[selectedAgent];

        const chatProps = { 
            chatHistory: currentAgentState.chatHistory, 
            isLoading, 
            inputValue, 
            onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => setInputValue(e.target.value), 
            onSendMessage: handleSendMessage 
        };
        
        if (selectedAgent === 'market') {
            return (
                <div className={baseClasses}>
                    <div className={innerBaseClasses}>
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-bold text-white">Market Intelligence Agent</h3>
                            <div className="flex items-center gap-4">
                                <button onClick={handleGenerateReport} disabled={isGeneratingReport} className="flex items-center gap-2 text-xs font-semibold text-white bg-cyan-600/50 hover:bg-cyan-600/80 px-3 py-1.5 rounded-md transition-colors disabled:bg-gray-600">
                                    <DocumentIcon className="h-4 w-4" /> {isGeneratingReport ? 'Generating...' : 'Generate Report'}
                                </button>
                                <button onClick={handleCloseAgent} className="text-gray-400 hover:text-white"><CloseIcon /></button>
                            </div>
                        </div>
                        <div className="flex-1 flex gap-4 overflow-hidden">
                            <div className="w-2/5"><PriceDashboard marketData={marketData} /></div>
                            <div className="w-3/5"><ChatInterface {...chatProps} /></div>
                        </div>
                    </div>
                </div>
            );
        }

        if (selectedAgent === 'spec') {
            return (
                <div className={baseClasses}>
                    <div className={innerBaseClasses}>
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="font-bold text-white">Spec Search Agent</h3>
                            <button onClick={handleCloseAgent} className="text-gray-400 hover:text-white"><CloseIcon /></button>
                        </div>
                        <div className="flex-1 flex gap-4 overflow-hidden">
                            <div className="w-2/5"><FileUpload uploadedFiles={currentAgentState.uploadedFiles} onFilesAdded={handleFilesAdded} onFileRemoved={handleFileRemoved} isDragging={isDragging} onDraggingChange={setIsDragging} /></div>
                            <div className="w-3/5"><ChatInterface {...chatProps} /></div>
                        </div>
                    </div>
                </div>
            );
        }
        return null;
    };


    return (
        <div className="absolute bottom-4 inset-x-4 z-10 flex flex-col items-center gap-4 pointer-events-none">
            {selectedAgent ? renderAgentUI() : (
                <>
                    {isLauncherOpen && (
                        <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-2xl p-4 w-96 shadow-lg flex flex-col gap-3 transition-all duration-300 ease-in-out transform-gpu animate-fade-in-up pointer-events-auto">
                            <h3 className="text-sm font-bold text-center text-gray-300 mb-2">Select an Agent</h3>
                            <button onClick={(e) => { e.currentTarget.blur(); handleSelectAgent('market'); }} className="flex items-center gap-4 p-4 bg-white/5 rounded-lg hover:bg-white/10 border border-transparent hover:border-cyan-500 transition-all text-left">
                                <div className="flex-shrink-0"><MarketIntelIcon className="text-cyan-400 h-6 w-6"/></div>
                                <div>
                                    <p className="font-semibold text-white">Market Intelligence Agent</p>
                                    <p className="text-sm text-gray-400">Monitor and analyze construction material pricing in real-time</p>
                                </div>
                            </button>
                            <button onClick={(e) => { e.currentTarget.blur(); handleSelectAgent('spec'); }} className="flex items-center gap-4 p-4 bg-white/5 rounded-lg hover:bg-white/10 border border-transparent hover:border-cyan-500 transition-all text-left">
                                <div className="flex-shrink-0"><SpecSearchIcon className="text-cyan-400 h-6 w-6" /></div>
                                <div>
                                    <p className="font-semibold text-white">Spec Search Agent</p>
                                    <p className="text-sm text-gray-400">Index and understand all project specifications, drawings, and contracts</p>
                                </div>
                            </button>
                        </div>
                    )}
                </>
            )}
            
            <style>{`
                @keyframes fade-in-up { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
                .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
                .animate-bounce { animation: bounce 1s infinite; }
                @keyframes bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); } 50% { transform: none; animation-timing-function: cubic-bezier(0,0,0.2,1); } }
            `}</style>
        </div>
    );
};

export default GeminiPanel;