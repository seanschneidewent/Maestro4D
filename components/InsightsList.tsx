

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Insight, InsightType, Severity, InsightStatus, Note, Message } from '../types';
import { InsightTypeIcon, SeverityIcon, BarsArrowUpIcon, BarsArrowDownIcon, CheckIcon, FunnelIcon, ArrowDownTrayIcon, Squares2X2Icon, SparklesIcon, MarketIntelIcon, SpecSearchIcon, ChevronDownIcon, ArrowLeftIcon, ChatBubbleIcon } from './Icons';

interface InsightsListProps {
  insights: Insight[];
  onUploadInsights?: (insights: Insight[]) => void;
  onInsightStatusChange?: (insightId: string, newStatus: InsightStatus) => void;
  onAddNote?: (insightId: string, noteText: string) => void;
  onReassignTrade?: (insightId: string, newTrade: string) => void;
  onOpenInsightChat?: (insightId: string) => void;
  onCloseInsightChat?: () => void;
  activeInsightChatId?: string | null; // Sync with parent state
}

const TRADES = ['Unassigned', 'GC', 'Structural', 'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Drywall', 'Finishes'];

const parseCsv = (text: string): Record<string, string>[] => {
  const [header, ...lines] = text.trim().split(/\r?\n/).filter(Boolean);
  const cols = header.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
  return lines.map(line => {
    const cells = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    cols.forEach((c, idx) => row[c] = cells[idx] || "");
    return row;
  });
};

const deriveSeverity = (clearance?: string, approved?: string, group?: string): Severity => {
  const c = parseFloat(String(clearance || "").replace(/[^\d.]/g, ""));
  if (approved?.toLowerCase() === "yes") return Severity.Low;
  if (!isNaN(c)) {
      if (c < 0.5) return Severity.Critical;
      if (c < 1.0) return Severity.High;
      if (c < 2.0) return Severity.Medium;
      return Severity.Low;
  }
  const groupStr = (group || "").toLowerCase();
  if (groupStr.includes("critical") || groupStr.includes("high")) return Severity.High;
  return Severity.Medium;
}

const cryptoRandomId = () => { return Math.random().toString(36).slice(2, 10); }

const csvRowToInsight = (r: Record<string, string>, file: string, row: number): Insight => {
  const statusMap: Record<string, InsightStatus> = {
    "Active": InsightStatus.Open,
    "New": InsightStatus.Open,
    "Reviewed": InsightStatus.Acknowledged,
    "Resolved": InsightStatus.Resolved
  };
  
  return {
    id: cryptoRandomId(),
    type: InsightType.Clash,
    title: r["Clash Name"] || `Clash: ${r["Item A Name"]} vs ${r["Item B Name"]}`,
    summary: (r["Description"] || "").trim(),
    assignedTo: r["Assigned To"] || undefined,
    status: statusMap[r["Status"]] || InsightStatus.Open,
    severity: deriveSeverity(r["Clearance"], r["Approved"], r["Group"]),
    elementIds: [r["Item A GUID"], r["Item B GUID"]].filter(Boolean),
    detectedAt: new Date(r["Date Found"] || Date.now()).toISOString(),
    tags: [r["Group"]].filter(Boolean),
    source: {
      system: 'CSV Import',
      file: file,
      row: row,
      itemA: r["Item A Name"],
      itemB: r["Item B Name"],
      clearance: r["Clearance"],
      approved: r["Approved"],
      group: r["Group"]
    },
    notes: [],
  };
};

// Add this function after csvRowToInsight (around line 85):
const generateTailoredAnalysis = (insight: Insight): string => {
  const taskDescription = insight.summary || '';
  const itemA = insight.source?.itemA || 'System A';
  const itemB = insight.source?.itemB || 'System B';
  const group = insight.tags?.[0] || insight.source?.group || 'General';
  const clearanceValue = parseFloat(insight.source?.clearance || '1.0');
  const isApproved = insight.source?.approved?.toLowerCase() === 'yes';
  
  // Determine severity context based on clearance
  let clearanceText = `${clearanceValue.toFixed(1)}"`;
  let severityReason = '';
  let requiredClearance = '2.0"';
  
  if (clearanceValue < 0.5) {
    requiredClearance = '6.0"';
    severityReason = 'Hard clash requiring immediate resolution';
  } else if (clearanceValue < 1.0) {
    requiredClearance = '4.0"';
    severityReason = 'Below code minimum - will fail inspection';
  } else if (clearanceValue < 2.0) {
    requiredClearance = '3.0"';
    severityReason = 'Marginal clearance affecting constructability';
  } else {
    severityReason = 'Acceptable clearance - verify in field';
  }
  
  if (isApproved) {
    severityReason = 'Approved deviation - proceed as documented';
  }
  
  // Determine task category
  let category = 'Installation Task';
  let urgency = 'Standard priority';
  
  if (group.toLowerCase().includes('life safety')) {
    category = 'Life Safety System';
    urgency = 'CRITICAL - Required for occupancy';
  } else if (group.toLowerCase().includes('schedule critical')) {
    category = 'Critical Path Activity';
    urgency = 'HIGH - Impacts project completion';
  } else if (group.toLowerCase().includes('qaqc')) {
    category = 'Quality Assurance';
    urgency = 'Required before next phase';
  } else if (group.toLowerCase().includes('closeout')) {
    category = 'Project Closeout';
    urgency = 'Required for turnover';
  }
  
  // Calculate schedule impact
  let scheduleImpact = '1 day';
  let criticalPath = false;
  
  if (group.toLowerCase().includes('schedule critical') || insight.severity === Severity.Critical) {
    scheduleImpact = '3-5 days';
    criticalPath = true;
  } else if (insight.severity === Severity.High) {
    scheduleImpact = '2-3 days';
  }
  
  // Calculate cost range based on task type
  let costMin = 500;
  let costMax = 2000;
  
  if (taskDescription.toLowerCase().includes('install')) {
    costMin = 1000;
    costMax = 4000;
  } else if (taskDescription.toLowerCase().includes('test')) {
    costMin = 800;
    costMax = 2500;
  }
  
  // Apply severity multiplier
  const severityMultiplier = {
    [Severity.Critical]: 3,
    [Severity.High]: 2,
    [Severity.Medium]: 1.5,
    [Severity.Low]: 1
  }[insight.severity] || 1;
  
  costMin = Math.floor(costMin * severityMultiplier);
  costMax = Math.floor(costMax * severityMultiplier);
  
  // Build the analysis
  let analysis = `# ${insight.title}\n\n`;
  
  analysis += `## ${category}\n`;
  analysis += `**Priority:** ${urgency}\n`;
  analysis += `**Trade:** ${insight.assignedTo || 'Unassigned'}\n`;
  analysis += `**Status:** ${insight.status}\n\n`;
  
  analysis += `## Task Details\n`;
  analysis += `**Required Action:** ${taskDescription}\n`;
  analysis += `**Components:** ${itemA} interfacing with ${itemB}\n\n`;
  
  analysis += `## Clearance Analysis\n`;
  if (isApproved) {
    analysis += `✅ **APPROVED DEVIATION**\n`;
    analysis += `Current clearance: ${clearanceText} (Approved per RFI)\n\n`;
  } else {
    analysis += `**${severityReason}**\n`;
    analysis += `- Current: ${clearanceText}\n`;
    analysis += `- Required: ${requiredClearance}\n`;
    if (clearanceValue < 1.0) {
      analysis += `- ⚠️ **VIOLATION** - Must correct before inspection\n`;
    }
    analysis += `\n`;
  }
  
  analysis += `## Impact Assessment\n\n`;
  
  analysis += `**Schedule Impact:** ${scheduleImpact}`;
  if (criticalPath) {
    analysis += ` **[ON CRITICAL PATH]**`;
  }
  analysis += `\n\n`;
  
  analysis += `**Cost Estimate:** $${costMin.toLocaleString()} - $${costMax.toLocaleString()}\n\n`;
  
  analysis += `## Required Actions\n`;
  
  // Parse specific actions from description
  const actions = [];
  const descLower = taskDescription.toLowerCase();
  
  if (descLower.includes('verify')) {
    actions.push(`1. Field verify: ${taskDescription}`);
  } else if (descLower.includes('install')) {
    actions.push(`1. Install per plans: ${taskDescription}`);
  } else if (descLower.includes('test')) {
    actions.push(`1. Complete testing: ${taskDescription}`);
  } else {
    actions.push(`1. Execute: ${taskDescription}`);
  }
  
  actions.push(`2. ${insight.assignedTo || 'Responsible trade'} foreman to review and sign off`);
  
  if (group.toLowerCase().includes('life safety')) {
    actions.push(`3. Document with photos for AHJ inspection`);
  } else if (group.toLowerCase().includes('qaqc')) {
    actions.push(`3. Complete quality checklist`);
  } else {
    actions.push(`3. Update daily report upon completion`);
  }
  
  actions.push(`4. Notify downstream trades when complete`);
  
  analysis += actions.join('\n') + '\n\n';
  
  // Add spec references if found in description
  const specPattern = /\d{2}\s?\d{2}\s?\d{2}/g;
  const specMatches = taskDescription.match(specPattern);
  if (specMatches) {
    analysis += `## Reference Documents\n`;
    specMatches.forEach(spec => {
      analysis += `- Section ${spec}\n`;
    });
  }
  
  // Add RFI tracking for high priority items
  if (insight.severity === Severity.Critical || insight.severity === Severity.High) {
    const rfiNumber = Math.floor(Math.random() * 200) + 100;
    analysis += `\n## Documentation\n`;
    analysis += `- RFI #${rfiNumber} - ${itemA}/${itemB} coordination\n`;
    analysis += `- Photo documentation required\n`;
  }
  
  // Status-specific footer
  if (insight.status === InsightStatus.Resolved) {
    analysis += `\n✅ **RESOLVED** - Verify field implementation and close out.`;
  } else if (insight.status === InsightStatus.Acknowledged) {
    analysis += `\n🔄 **IN PROGRESS** - Target completion: ${scheduleImpact}`;
  }
  
  return analysis;
};

type InsightAgent = 'insight' | 'spec' | 'market';

const getInsightAgentResponse = (
  message: string, 
  insight: Insight, 
  agent: InsightAgent,
  onStatusChange: (insightId: string, newStatus: InsightStatus) => void,
  onReassignTrade: (insightId: string, newTrade: string) => void
): string => {
  const lowerMessage = message.toLowerCase();

  if (agent === 'spec') {
    return `Checking against project specs... According to drawing M-201, the specified clearance for this type of ductwork is 3 inches. This installation appears to violate that requirement. Please verify on-site measurements.`;
  }
  if (agent === 'market') {
    return `Analyzing market data... The primary material involved is galvanized steel ductwork. Prices have risen 4% this quarter. Rework for this issue could cost an estimated $1,200 in materials and 8 hours of labor. Delaying resolution could expose the project to further price increases.`;
  }

  // Insight Agent (default)
  if (lowerMessage.includes('acknowledge')) {
    onStatusChange(insight.id, InsightStatus.Acknowledged);
    return `Understood. The issue is now marked as **Acknowledged**. Please ensure this is logged in the project's official issue tracker for formal record-keeping.`;
  }
  if (lowerMessage.includes('resolve') || lowerMessage.includes('fixed') || lowerMessage.includes('complete')) {
    onStatusChange(insight.id, InsightStatus.Resolved);
    return `Excellent. To formally mark this as **Resolved**, please confirm the following checklist is complete:
- [ ] Corrective work has been completed on-site.
- [ ] A photo of the corrected work is attached to the issue log.
- [ ] The resolution has been approved by the project superintendent.`;
  }
  const assignMatch = lowerMessage.match(/assign to (.+)/);
  if (assignMatch && assignMatch[1]) {
    const trade = assignMatch[1].trim();
    const foundTrade = TRADES.find(t => t.toLowerCase() === trade) || trade.charAt(0).toUpperCase() + trade.slice(1);
    onReassignTrade(insight.id, foundTrade);
    return `Assignment updated. I've logged that the **${foundTrade}** team is now responsible for this issue. They will be notified.`;
  }

  return `I am analyzing your request regarding "${insight.title}". How else can I assist? You can ask me to change the status, reassign the trade, or check specs and market data.`;
};



interface FullPanelChatViewProps {
    insight: Insight;
    chatState: { descriptions: Record<InsightAgent, string>, activeAgent: InsightAgent };
    onBack: () => void;
    onAgentChange: (agent: InsightAgent) => void;
    onDescriptionChange: (agent: InsightAgent, description: string) => void;
}

const FullPanelChatView: React.FC<FullPanelChatViewProps> = ({ insight, chatState, onBack, onAgentChange, onDescriptionChange }) => {
    const { descriptions, activeAgent } = chatState;

    const severityColorClasses = {
        [Severity.Critical]: { gradient: 'from-red-600 via-red-500 to-red-400' },
        [Severity.High]: { gradient: 'from-orange-600 via-orange-500 to-orange-400' },
        [Severity.Medium]: { gradient: 'from-yellow-600 via-yellow-500 to-yellow-400' },
        [Severity.Low]: { gradient: 'from-green-600 via-green-500 to-green-400' },
    };
    const severityClasses = severityColorClasses[insight.severity] || { gradient: 'from-cyan-600 via-cyan-500 to-cyan-400' };

    const AGENT_CONFIG = {
        insight: { icon: SparklesIcon, name: 'Task' },
        spec: { icon: SpecSearchIcon, name: 'Specs' },
        market: { icon: MarketIntelIcon, name: 'Items' },
    };


    return (
        <div className="h-full flex flex-col bg-gray-900">
             <div className="flex-shrink-0 p-3 border-b border-gray-700/80">
                <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-cyan-400 transition-colors">
                    <ArrowLeftIcon />
                    Back to Insights
                </button>
            </div>
            <div className="flex-shrink-0 p-4 border-b border-gray-700/80 space-y-4">
                <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-400 tracking-wider uppercase truncate">{insight.title}</p>
                        <h3 className="text-md font-semibold text-white mt-1 break-words">{insight.summary}</h3>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                        <div className={`h-0.5 w-12 rounded-tl-lg bg-gradient-to-l ${severityClasses.gradient}`}></div>
                        <div className="flex items-start">
                            <div className={`mt-2 mr-2.5 text-xs font-bold whitespace-nowrap bg-gradient-to-r text-transparent bg-clip-text ${severityClasses.gradient}`}>
                                {insight.severity.toUpperCase()}
                            </div>
                            <div className={`-mt-px h-6 w-0.5 rounded-tl-lg bg-gradient-to-b ${severityClasses.gradient}`}></div>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-800 p-1">
                    {(['insight', 'spec', 'market'] as InsightAgent[]).map(agent => {
                        const AgentIcon = AGENT_CONFIG[agent].icon;
                        const isActive = activeAgent === agent;
                        return (
                            <button
                                key={agent}
                                onClick={() => onAgentChange(agent)}
                                className={`flex-1 rounded-md p-px transition-colors group ${
                                    isActive
                                    ? 'bg-gradient-to-r from-blue-500 to-cyan-400 shadow-md'
                                    : 'bg-transparent hover:bg-gradient-to-r from-blue-500 to-cyan-400'
                                }`}
                                aria-label={`Switch to ${AGENT_CONFIG[agent].name} Agent`}
                            >
                                <div className="bg-gray-800 rounded-[5px] px-3 py-2 flex items-center justify-center gap-2 h-full">
                                    <AgentIcon className={`h-5 w-5 transition-colors ${
                                        isActive ? 'text-cyan-400' : 'text-gray-400 group-hover:text-gray-200'
                                    }`} />
                                    <span className={`text-sm font-semibold transition-colors ${
                                        isActive 
                                        ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text' 
                                        : 'text-gray-400 group-hover:text-gray-200'
                                    }`}>
                                        {AGENT_CONFIG[agent].name}
                                    </span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
                <div className="w-full rounded-lg p-px bg-gradient-to-r from-blue-500 to-cyan-400 h-full flex flex-col">
                    <div className="bg-gray-800 rounded-[7px] p-3 space-y-3 flex-1 flex flex-col min-h-0">
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {(() => {
                                const AgentIcon = AGENT_CONFIG[activeAgent].icon;
                                const agentName = AGENT_CONFIG[activeAgent].name;
                                return (
                                    <>
                                        <AgentIcon className="h-5 w-5 text-cyan-400" />
                                        <span className="text-sm font-semibold bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text">
                                            {agentName}
                                        </span>
                                    </>
                                );
                            })()}
                        </div>
                        <textarea
                            value={descriptions[activeAgent] || ''}
                            onChange={(e) => onDescriptionChange(activeAgent, e.target.value)}
                            placeholder={`Enter ${AGENT_CONFIG[activeAgent].name} description...`}
                            className="w-full bg-transparent text-gray-200 text-sm resize-none focus:outline-none placeholder-gray-500 flex-1 min-h-0"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

interface InsightCardProps {
  insight: Insight;
  onOpenChat: (insightId: string) => void;
  isBulkSelectMode: boolean;
  isBulkSelected: boolean;
  onBulkSelectToggle: (insightId: string) => void;
}

const InsightCard: React.FC<InsightCardProps> = ({ insight, onOpenChat, isBulkSelectMode, isBulkSelected, onBulkSelectToggle }) => {
    const severityColorClasses = {
        [Severity.Critical]: { select: 'bg-[#f56565]', gradient: 'from-red-600 via-red-500 to-red-400' },
        [Severity.High]: { select: 'bg-[#ed8936]', gradient: 'from-orange-600 via-orange-500 to-orange-400' },
        [Severity.Medium]: { select: 'bg-yellow-400', gradient: 'from-yellow-600 via-yellow-500 to-yellow-400' },
        [Severity.Low]: { select: 'bg-green-500', gradient: 'from-green-600 via-green-500 to-green-400' },
    };
    
    const severityClasses = severityColorClasses[insight.severity] || { select: 'bg-cyan-500', gradient: 'from-cyan-600 via-cyan-500 to-cyan-400' };
  
    const wrapperClasses = `flex-1 rounded-lg p-px transition-all duration-200 group/card ${isBulkSelected ? severityClasses.select : 'bg-gradient-to-r from-blue-500 to-cyan-400 hover:p-[2px]'}`;

    const handleCardClick = () => {
        if (isBulkSelectMode) {
        onBulkSelectToggle(insight.id);
        }
    };

    return (
        <div className="flex items-start gap-3">
            {isBulkSelectMode && (
                <div className="pt-5 flex-shrink-0">
                    <input
                        type="checkbox"
                        checked={isBulkSelected}
                        onChange={(e) => {
                            e.stopPropagation();
                            onBulkSelectToggle(insight.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 rounded bg-gray-700 border-gray-600 text-cyan-600 focus:ring-cyan-500 cursor-pointer"
                        aria-label={`Select insight ${insight.title}`}
                    />
                </div>
            )}
            <div
                className={wrapperClasses}
                onClick={handleCardClick}
            >
                <div className="bg-gray-800 rounded-[7px] p-4 h-full w-full relative">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center space-x-3 pr-20">
                            <InsightTypeIcon type={insight.type} />
                            <h3 className="text-sm text-gray-400 flex-1">{insight.title}</h3>
                        </div>
                    </div>

                    {insight.severity && (
                        <div className="absolute top-3 right-3">
                            <div className="flex flex-col items-end">
                                <div className={`h-0.5 w-12 rounded-tl-lg bg-gradient-to-l ${severityClasses.gradient}`}></div>
                                <div className="flex items-start">
                                    <div className={`mt-2 mr-2.5 text-xs font-bold whitespace-nowrap bg-gradient-to-r text-transparent bg-clip-text ${severityClasses.gradient}`}>
                                        {insight.severity.toUpperCase()}
                                    </div>
                                    <div className={`-mt-px h-6 w-0.5 rounded-tl-lg bg-gradient-to-b ${severityClasses.gradient}`}></div>
                                </div>
                            </div>
                        </div>
                    )}

                    <p className="text-md font-bold text-white my-3 leading-relaxed line-clamp-2">{insight.summary}</p>
                    <div className="mt-4 flex justify-start">
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpenChat(insight.id); }}
                            className="rounded-lg shadow-lg group transition-shadow duration-200 hover:shadow-cyan-500/20 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-400 group-hover/card:p-px group-hover/card:bg-gradient-to-r group-hover/card:from-blue-500 group-hover/card:to-cyan-400"
                        >
                            <div className="bg-gray-900 rounded-[7px] px-3 py-1.5 transition-colors">
                                <span className="text-xs font-semibold tracking-wider">
                                    <span className="bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text">
                                        DIVE DEEPER
                                    </span>
                                </span>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


const InsightsList: React.FC<InsightsListProps> = ({ insights, onUploadInsights, onInsightStatusChange, onAddNote, onReassignTrade, onOpenInsightChat, onCloseInsightChat, activeInsightChatId: parentActiveInsightChatId }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // View state - sync with parent if provided
  const [activeChatInsightId, setActiveChatInsightId] = useState<string | null>(null);
  
  // Sync with parent state
  useEffect(() => {
    if (parentActiveInsightChatId !== undefined) {
      setActiveChatInsightId(parentActiveInsightChatId);
    }
  }, [parentActiveInsightChatId]);
  
  // Chat state - now stores descriptions instead of messages
  const [chatHistories, setChatHistories] = useState<Record<string, { descriptions: Record<InsightAgent, string>, activeAgent: InsightAgent }>>({});

  // Sorting state
  type SortOption = 'severity' | 'status' | 'title';
  const [sortOption, setSortOption] = useState<SortOption>('severity');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  
  // Filtering state
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<InsightStatus | 'all'>('all');
  const [filterTrade, setFilterTrade] = useState<string>('all');

  // Bulk select state
  const [isBulkSelectMode, setIsBulkSelectMode] = useState<boolean>(false);
  const [selectedInsightIds, setSelectedInsightIds] = useState<Set<string>>(new Set());

  // AI state
  const [isAIAnalyzing, setIsAIAnalyzing] = useState<boolean>(false);

  // Dropdown states
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);
  
  // Dropdown refs
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  
  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) setIsSortDropdownOpen(false);
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) setIsFilterDropdownOpen(false);
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) setIsExportDropdownOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredInsights = useMemo(() => {
    return insights.filter(insight => {
        const severityMatch = filterSeverity === 'all' || insight.severity === filterSeverity;
        const statusMatch = filterStatus === 'all' || insight.status === filterStatus;
        const tradeMatch = filterTrade === 'all' || (filterTrade === 'Unassigned' ? !insight.assignedTo : insight.assignedTo === filterTrade);
        return severityMatch && statusMatch && tradeMatch;
    });
  }, [insights, filterSeverity, filterStatus, filterTrade]);

  const sortedInsights = useMemo(() => {
    const sorted = [...filteredInsights];
    const severityOrder: Record<Severity, number> = { [Severity.Critical]: 4, [Severity.High]: 3, [Severity.Medium]: 2, [Severity.Low]: 1 };
    const statusOrder: Record<InsightStatus, number> = { [InsightStatus.Open]: 4, [InsightStatus.Acknowledged]: 3, [InsightStatus.Resolved]: 2, [InsightStatus.Muted]: 1 };

    sorted.sort((a, b) => {
        let comparison = 0;
        if (sortOption === 'severity') comparison = (severityOrder[a.severity] || 0) - (severityOrder[b.severity] || 0);
        else if (sortOption === 'status') comparison = (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
        else comparison = a.title.localeCompare(b.title);
        
        if (sortOption !== 'severity' && comparison === 0) comparison = (severityOrder[a.severity] || 0) - (severityOrder[b.severity] || 0);
        return sortDirection === 'desc' ? -comparison : comparison;
    });
    return sorted;
  }, [filteredInsights, sortOption, sortDirection]);

  // Event Handlers for chat
  const handleOpenChat = (insightId: string) => {
    const insight = insights.find(i => i.id === insightId);
    if (!insight) return;

    if (!chatHistories[insightId]) {
      setChatHistories(prev => ({
        ...prev,
        [insightId]: {
          descriptions: {
            insight: '',
            spec: '',
            market: '',
          },
          activeAgent: 'insight',
        }
      }));
    }
    setActiveChatInsightId(insightId);
    // Notify parent to open chat in right panel
    onOpenInsightChat?.(insightId);
  };
  
  const handleBackToList = () => {
    setActiveChatInsightId(null);
    // Notify parent to close chat in right panel
    onCloseInsightChat?.();
  };
  
  const handleAgentChange = (agent: InsightAgent) => {
      if (!activeChatInsightId) return;
      setChatHistories(prev => ({
          ...prev,
          [activeChatInsightId]: {
              ...prev[activeChatInsightId],
              activeAgent: agent
          }
      }));
  };

  const handleDescriptionChange = (insightId: string, agent: InsightAgent, description: string) => {
      setChatHistories(prev => ({
          ...prev,
          [insightId]: {
              ...prev[insightId],
              descriptions: {
                  ...prev[insightId].descriptions,
                  [agent]: description
              }
          }
      }));
  };

  // Other handlers
  const handleUploadClick = () => fileInputRef.current?.click();
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      const newInsights = rows.map((r, i) => csvRowToInsight(r, file.name, i + 1));
      onUploadInsights?.(newInsights);
    } catch (error) { console.error("Failed to parse CSV file:", error); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleToggleBulkSelection = (insightId: string) => {
    setSelectedInsightIds(prev => {
        const newSet = new Set(prev);
        if (newSet.has(insightId)) newSet.delete(insightId);
        else newSet.add(insightId);
        return newSet;
    });
  };
  
  const handleToggleBulkSelectMode = () => {
    setIsBulkSelectMode(prev => !prev);
    setSelectedInsightIds(new Set());
  };
  
  const handleBulkAction = (action: 'Acknowledge' | 'Resolve' | 'Unassign') => {
      selectedInsightIds.forEach(id => {
          if (action === 'Acknowledge' && onInsightStatusChange) onInsightStatusChange(id, InsightStatus.Acknowledged);
          else if (action === 'Resolve' && onInsightStatusChange) onInsightStatusChange(id, InsightStatus.Resolved);
          else if (action === 'Unassign' && onReassignTrade) onReassignTrade(id, '');
      });
      setSelectedInsightIds(new Set());
      setIsBulkSelectMode(false);
  };
  
  const downloadFile = (content: string, fileName: string, contentType: string) => {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  };

  const handleExport = (format: 'csv' | 'json') => {
    const dataToExport = isBulkSelectMode && selectedInsightIds.size > 0
        ? sortedInsights.filter(i => selectedInsightIds.has(i.id))
        : sortedInsights;
    if (dataToExport.length === 0) {
      alert("No insights to export.");
      return;
    }
    const date = new Date().toISOString().split('T')[0];
    if (format === 'csv') {
      const header = "Title,Summary,Severity,Status,Assigned To,Notes\n";
      const rows = dataToExport.map(i => {
        const notes = (i.notes || []).map(n => `"${n.text.replace(/"/g, '""')}"`).join('; ');
        return `"${i.title.replace(/"/g, '""')}","${i.summary.replace(/"/g, '""')}","${i.severity}","${i.status}","${i.assignedTo || ''}","${notes}"`;
      }).join('\n');
      downloadFile(header + rows, `insights_${date}.csv`, 'text/csv;charset=utf-8;');
    } else {
      const jsonContent = JSON.stringify(dataToExport, null, 2);
      downloadFile(jsonContent, `insights_${date}.json`, 'application/json');
    }
    setIsExportDropdownOpen(false);
  };

  const handleAIAnalysis = async () => {
    setIsAIAnalyzing(true);
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Analyzing insights:", sortedInsights);
    alert("AI analysis complete! (Placeholder)");
    setIsAIAnalyzing(false);
  };
  
  const activeInsightForChat = useMemo(() => {
    return insights.find(i => i.id === activeChatInsightId);
  }, [insights, activeChatInsightId]);

  const activeFilterCount = [filterSeverity, filterStatus, filterTrade].filter(f => f !== 'all').length;

  return (
    <div className="w-full bg-gray-900/80 backdrop-blur-sm flex flex-col h-full overflow-hidden relative">
      <div className={`w-full h-full flex flex-col transition-all duration-300 ${activeChatInsightId ? 'opacity-0 -translate-x-4 pointer-events-none' : 'opacity-100 translate-x-0'}`}>
          <h2 className="text-xl font-bold text-white tracking-wide mb-2 p-4 flex-shrink-0">M4D Insights</h2>
          <div className="mb-4 px-4 flex-shrink-0">
            <div className="flex items-center gap-1 rounded-md bg-gray-700/50 border border-gray-600/80 px-1 py-1">
              <button onClick={handleUploadClick} className="px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors" aria-label="Upload insights data">Upload</button>
              <div className="w-px h-6 bg-gray-600" />
              <div ref={filterDropdownRef} className="relative">
                <button onClick={() => setIsFilterDropdownOpen(prev => !prev)} className="p-1.5 text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors relative" aria-label="Filter insights" aria-haspopup="true" aria-expanded={isFilterDropdownOpen}>
                    <FunnelIcon className="h-4 w-4" />
                    {activeFilterCount > 0 && <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-500 text-xs font-bold text-white">{activeFilterCount}</span>}
                </button>
                {isFilterDropdownOpen && (
                    <div className="absolute left-0 mt-2 w-64 origin-top-left bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 p-3" onClick={e => e.stopPropagation()}>
                        <div className="space-y-3">
                            <div>
                                <label className="text-xs font-semibold text-gray-400">Severity</label>
                                <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value as Severity | 'all')} className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-1 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500">
                                    <option value="all">All Severities</option>
                                    {Object.values(Severity).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-400">Status</label>
                                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as InsightStatus | 'all')} className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-1 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500">
                                    <option value="all">All Statuses</option>
                                    {Object.values(InsightStatus).map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-semibold text-gray-400">Trade</label>
                                <select value={filterTrade} onChange={e => setFilterTrade(e.target.value)} className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md py-1 px-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500">
                                    <option value="all">All Trades</option>
                                    {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-700"><button onClick={() => { setFilterSeverity('all'); setFilterStatus('all'); setFilterTrade('all'); }} className="w-full text-center px-2 py-1 text-xs font-semibold text-cyan-400 hover:bg-gray-700 rounded-md">Clear Filters</button></div>
                    </div>
                )}
              </div>
              <div ref={exportDropdownRef} className="relative">
                <button onClick={() => setIsExportDropdownOpen(prev => !prev)} className="p-1.5 text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors" aria-label="Export insights" aria-haspopup="true" aria-expanded={isExportDropdownOpen}>
                    <ArrowDownTrayIcon className="h-4 w-4" />
                </button>
                {isExportDropdownOpen && (
                    <div className="absolute left-0 mt-2 w-40 origin-top-left bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 focus:outline-none">
                        <div className="py-1">
                            <button onClick={() => handleExport('csv')} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">Export as CSV</button>
                            <button onClick={() => handleExport('json')} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">Export as JSON</button>
                        </div>
                    </div>
                )}
              </div>
              <button onClick={handleToggleBulkSelectMode} className={`p-1.5 text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors ${isBulkSelectMode ? 'bg-cyan-600/50' : ''}`} aria-label="Toggle bulk selection mode"><Squares2X2Icon className="h-4 w-4" /></button>
              <button onClick={handleAIAnalysis} disabled={isAIAnalyzing} className="p-1.5 text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed" aria-label="Run AI Analysis"><SparklesIcon className={`h-4 w-4 ${isAIAnalyzing ? 'animate-pulse text-cyan-400' : ''}`} /></button>
              <div className="w-px h-6 bg-gray-600" />
              <button onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')} className="p-1.5 text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors" aria-label={`Sort direction: ${sortDirection === 'asc' ? 'ascending' : 'descending'}`}>{sortDirection === 'asc' ? <BarsArrowUpIcon className="h-4 w-4" /> : <BarsArrowDownIcon className="h-4 w-4" />}</button>
              <div ref={sortDropdownRef} className="relative">
                <button onClick={() => setIsSortDropdownOpen(prev => !prev)} className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-600/70 rounded-md transition-colors" aria-haspopup="true" aria-expanded={isSortDropdownOpen}>
                  <span>Sort: <span className="font-bold text-white">{sortOption.charAt(0).toUpperCase() + sortOption.slice(1)}</span></span>
                  <ChevronDownIcon className={`h-3 w-3 transition-transform ${isSortDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {isSortDropdownOpen && (
                    <div className="absolute left-0 mt-2 w-40 origin-top-left bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 focus:outline-none">
                    <div className="py-1">
                        {(['severity', 'status', 'title'] as SortOption[]).map(option => (
                        <button key={option} onClick={() => { setSortOption(option); setIsSortDropdownOpen(false); }} className="w-full text-left flex justify-between items-center px-4 py-2 text-sm text-gray-300 hover:bg-gray-700">
                            <span>{option.charAt(0).toUpperCase() + option.slice(1)}</span>
                            {sortOption === option && <CheckIcon className="h-4 w-4 text-cyan-400" />}
                        </button>
                        ))}
                    </div>
                    </div>
                )}
              </div>
            </div>
          </div>
          <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleFileChange} />
          {isBulkSelectMode && selectedInsightIds.size > 0 && (
              <div className="mx-4 mb-3 p-2 bg-gray-800/80 rounded-md flex items-center justify-between animate-fade-in-up-slow flex-shrink-0">
                  <span className="text-sm font-semibold text-gray-300">{selectedInsightIds.size} item(s) selected</span>
                  <div className="flex items-center gap-2">
                      <button onClick={() => handleBulkAction('Acknowledge')} className="px-2.5 py-1 text-xs font-semibold text-yellow-300 bg-yellow-800/60 rounded hover:bg-yellow-800/90">Acknowledge</button>
                      <button onClick={() => handleBulkAction('Resolve')} className="px-2.5 py-1 text-xs font-semibold text-green-300 bg-green-800/60 rounded hover:bg-green-800/90">Resolve</button>
                      <button onClick={() => handleBulkAction('Unassign')} className="px-2.5 py-1 text-xs font-semibold text-gray-300 bg-gray-700/80 rounded hover:bg-gray-700">Unassign</button>
                  </div>
              </div>
          )}
          {sortedInsights.length > 0 ? (
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
              {sortedInsights.map((insight) => (
                <InsightCard 
                  key={insight.id} 
                  insight={insight}
                  onOpenChat={handleOpenChat}
                  isBulkSelectMode={isBulkSelectMode}
                  isBulkSelected={selectedInsightIds.has(insight.id)}
                  onBulkSelectToggle={handleToggleBulkSelection}
                />
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center text-gray-500">
              <div>
                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                <h3 className="mt-2 text-md font-semibold text-gray-400">{insights.length > 0 ? 'No Matching Insights' : 'No Insights'}</h3>
                <p className="mt-1 text-sm">{insights.length > 0 ? 'Adjust your filters or upload new data.' : 'Upload data to see insights.'}</p>
              </div>
            </div>
          )}
      </div>

      <div className={`absolute inset-0 transition-all duration-300 ${activeChatInsightId ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'}`}>
        {activeInsightForChat && activeChatInsightId && chatHistories[activeChatInsightId] && (
          <FullPanelChatView
            insight={activeInsightForChat}
            chatState={chatHistories[activeChatInsightId]}
            onBack={handleBackToList}
            onAgentChange={handleAgentChange}
            onDescriptionChange={(agent, description) => handleDescriptionChange(activeChatInsightId, agent, description)}
          />
        )}
      </div>
       <style>{`
            @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
            .animate-fade-in { animation: fade-in 0.3s ease-out forwards; }
            @keyframes fade-in-up-slow { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            .animate-fade-in-up-slow { animation: fade-in-up-slow 0.5s ease-out forwards; }
            .animate-bounce { animation: bounce 1s infinite; }
            @keyframes bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); } 50% { transform: none; animation-timing-function: cubic-bezier(0,0,0.2,1); } }
            .line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
        `}</style>
    </div>
  );
};

export default InsightsList;