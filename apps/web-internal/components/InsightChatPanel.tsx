
import React, { useState, useRef, useEffect } from 'react';
import { Insight, InsightStatus, Severity, Message } from '../types';
import { ArrowLeftIcon, SendIcon } from './Icons';

interface InsightChatPanelProps {
  insight: Insight;
  onBack: () => void;
  onStatusChange?: (insightId: string, newStatus: InsightStatus) => void;
  onReassignTrade?: (insightId: string, newTrade: string) => void;
}

const TRADES = ['Unassigned', 'GC', 'Structural', 'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Drywall', 'Finishes'];

const getInsightAgentResponse = (
  message: string,
  insight: Insight,
  onStatusChange?: (insightId: string, newStatus: InsightStatus) => void,
  onReassignTrade?: (insightId: string, newTrade: string) => void
): string => {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('acknowledge')) {
    onStatusChange?.(insight.id, InsightStatus.Acknowledged);
    return `Understood. The issue "${insight.title}" is now marked as **Acknowledged**. Please ensure this is logged in the project's official issue tracker for formal record-keeping.`;
  }
  
  if (lowerMessage.includes('resolve') || lowerMessage.includes('fixed') || lowerMessage.includes('complete')) {
    onStatusChange?.(insight.id, InsightStatus.Resolved);
    return `Excellent. To formally mark "${insight.title}" as **Resolved**, please confirm the following checklist is complete:
- [ ] Corrective work has been completed on-site.
- [ ] A photo of the corrected work is attached to the issue log.
- [ ] The resolution has been approved by the project superintendent.`;
  }
  
  const assignMatch = lowerMessage.match(/assign to (.+)/);
  if (assignMatch && assignMatch[1]) {
    const trade = assignMatch[1].trim();
    const foundTrade = TRADES.find(t => t.toLowerCase() === trade.toLowerCase()) || trade.charAt(0).toUpperCase() + trade.slice(1);
    onReassignTrade?.(insight.id, foundTrade);
    return `Assignment updated. I've logged that the **${foundTrade}** team is now responsible for "${insight.title}". They will be notified.`;
  }

  // Generate contextual response based on insight data
  const severityText = insight.severity === Severity.Critical 
    ? 'This is a CRITICAL issue requiring immediate attention.'
    : insight.severity === Severity.High
    ? 'This is a HIGH priority issue that should be addressed soon.'
    : 'This issue has been categorized for review.';

  const clearanceInfo = insight.source?.clearance 
    ? ` The clearance measurement is ${insight.source.clearance}.`
    : '';

  const componentsInfo = insight.source?.itemA && insight.source?.itemB
    ? ` This involves ${insight.source.itemA} and ${insight.source.itemB}.`
    : '';

  return `I'm analyzing your request regarding "${insight.title}". ${severityText}${clearanceInfo}${componentsInfo}

**Current Status:** ${insight.status}
**Assigned To:** ${insight.assignedTo || 'Unassigned'}
**Summary:** ${insight.summary}

How can I assist you further? You can ask me to:
- Change the status (e.g., "acknowledge" or "resolve")
- Reassign the trade (e.g., "assign to MEP")
- Get more details about this issue`;
};

const InsightChatPanel: React.FC<InsightChatPanelProps> = ({ 
  insight, 
  onBack, 
  onStatusChange, 
  onReassignTrade
}) => {
  const [chatHistory, setChatHistory] = useState<Message[]>([
    {
      role: 'model',
      parts: [{ 
        text: `Hello! I'm here to help you with "${insight.title}". You can ask me about this task, change its status, reassign it, or get more details. How can I assist you?` 
      }]
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isLoading]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      parts: [{ text: inputValue }]
    };

    setChatHistory(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    // Simulate API call with response based on insight data
    setTimeout(() => {
      const responseText = getInsightAgentResponse(
        inputValue,
        insight,
        onStatusChange,
        onReassignTrade
      );
      
      const assistantMessage: Message = {
        role: 'model',
        parts: [{ text: responseText }]
      };

      setChatHistory(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 800 + Math.random() * 400);
  };

  const severityColorClasses = {
    [Severity.Critical]: { gradient: 'from-red-600 via-red-500 to-red-400' },
    [Severity.High]: { gradient: 'from-orange-600 via-orange-500 to-orange-400' },
    [Severity.Medium]: { gradient: 'from-yellow-600 via-yellow-500 to-yellow-400' },
    [Severity.Low]: { gradient: 'from-green-600 via-green-500 to-green-400' },
  };
  const severityClasses = severityColorClasses[insight.severity] || { gradient: 'from-cyan-600 via-cyan-500 to-cyan-400' };

  return (
    <div className="w-full h-full flex flex-col bg-gray-900/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b border-gray-700/80">
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
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatHistory.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
              msg.role === 'user' 
                ? 'bg-cyan-600 text-white' 
                : 'bg-gray-800 text-gray-200'
            }`}>
              <p className="whitespace-pre-wrap text-sm">{msg.parts[0].text}</p>
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 rounded-lg px-4 py-3">
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="h-2 w-2 bg-gray-500 rounded-full animate-bounce"></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <form onSubmit={handleSendMessage} className="flex-shrink-0 p-4 border-t border-gray-700/80">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Ask about this task..."
            className="flex-1 bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            aria-label="Chat input"
          />
          <button
            type="submit"
            className="bg-cyan-600 text-white p-2.5 rounded-lg hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
            aria-label="Send message"
            disabled={!inputValue.trim() || isLoading}
          >
            <SendIcon className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default InsightChatPanel;

