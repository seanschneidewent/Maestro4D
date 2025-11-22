import React, { useState, useRef } from 'react';
import { ProjectSummary, Severity, Insight, InsightStatus, InsightType, FileSystemNode } from '../types';
import { DocumentIcon, ArrowDownTrayIcon, CloseIcon, PlusIcon, FolderIcon } from './Icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { analyzeDeviationReport } from '../utils/gemini';
import FolderTreeView from './FolderTreeView';

type ReportType = 'progress' | 'deviation' | 'clash' | 'allData';

interface ReferencePanelProps {
  summary: ProjectSummary;
  insights: Insight[];
  progress: number;
  onViewReport?: (type: ReportType, files: File | File[], onDeleteFile?: (index: number) => void, onAddFile?: (files: File[]) => void) => void;
  onAddInsights?: (insights: Insight[]) => void;
  isListDataActive?: boolean;
  onToggleListData?: () => void;
  // Updated props for folder structure
  fileSystemTree?: FileSystemNode[];
  selectedNodeId?: string | null;
  onSelectNode?: (node: FileSystemNode) => void;
  onToggleExpand?: (node: FileSystemNode) => void;
  onRenameNode?: (node: FileSystemNode, newName: string) => void;
  onDeleteNode?: (node: FileSystemNode) => void;
  onMoveNode?: (nodeId: string, targetParentId: string | undefined) => void;
  onOpenFile?: (node: FileSystemNode) => void;
  onCreateFolder?: (parentId?: string) => void;
  
  // Legacy props (keeping for compatibility during transition if needed, but mainly replaced)
  centerViewerFiles?: Array<{ name: string; url: string; file: File }>;
  selectedFileIndex?: number;
  onSelectFile?: (index: number) => void;
  onDeleteFile?: (index: number) => void;
  
  onAddFile?: (files: File[]) => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
}

// Augment HTMLInputElement attributes to support directory upload
declare module 'react' {
  interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    directory?: string;
    webkitdirectory?: string;
  }
}

const ReferencePanel: React.FC<ReferencePanelProps> = ({ 
  summary, 
  insights, 
  progress, 
  onViewReport,
  onAddInsights,
  isListDataActive = false,
  onToggleListData,
  fileSystemTree = [],
  selectedNodeId = null,
  onSelectNode,
  onToggleExpand,
  onRenameNode,
  onDeleteNode,
  onMoveNode,
  onOpenFile,
  onCreateFolder,
  centerViewerFiles = [],
  selectedFileIndex = 0,
  onSelectFile,
  onDeleteFile,
  onAddFile,
  fileInputRef
}) => {
  // State for uploaded PDF files
  const [reportFiles, setReportFiles] = useState<{
    progress: File | null;
    deviation: File | null;
    clash: File | null;
    allData: File[];
  }>({
    progress: null,
    deviation: null,
    clash: null,
    allData: [],
  });

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Refs for file inputs
  const progressFileInputRef = useRef<HTMLInputElement>(null);
  const deviationFileInputRef = useRef<HTMLInputElement>(null);
  const clashFileInputRef = useRef<HTMLInputElement>(null);
  
  // Separate ref for folder input
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Upload handlers
  const handleProgressUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setReportFiles(prev => ({ ...prev, progress: file }));
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleDeviationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setReportFiles(prev => ({ ...prev, deviation: file }));
      
      if (onAddInsights) {
        setIsAnalyzing(true);
        try {
          const newInsights = await analyzeDeviationReport(file);
          onAddInsights(newInsights);
        } catch (error) {
          console.error("Failed to analyze report:", error);
          alert("Failed to analyze the deviation report. Please ensure your Gemini API key is set correctly.");
        } finally {
          setIsAnalyzing(false);
        }
      }
    }
    e.target.value = '';
  };

  const handleClashUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setReportFiles(prev => ({ ...prev, clash: file }));
    }
    e.target.value = '';
  };
  
  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && onAddFile) {
      const files = Array.from(e.target.files);
      onAddFile(files);
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  // Delete handler for allData files
  const handleDeleteAllDataFile = (index: number) => {
    setReportFiles(prev => ({
      ...prev,
      allData: prev.allData.filter((_, i) => i !== index)
    }));
  };

  // Helper function to check if a file already exists (by name and size)
  const isFileDuplicate = (file: File, existingFiles: File[]): boolean => {
    return existingFiles.some(
      existingFile => existingFile.name === file.name && existingFile.size === file.size
    );
  };

  // Add handler for allData files
  const handleAddAllDataFiles = (files: File[]) => {
    console.log('[ReferencePanel] handleAddAllDataFiles called with', files.length, 'file(s):', files.map(f => ({ name: f.name, size: f.size })));
    setReportFiles(prev => {
      // Filter out duplicates before adding
      const newFiles = files.filter(file => !isFileDuplicate(file, prev.allData));
      console.log('[ReferencePanel] After duplicate check:', newFiles.length, 'unique file(s) to add');
      if (newFiles.length === 0) {
        // No new files to add, return previous state
        console.log('[ReferencePanel] All files were duplicates, no files added');
        return prev;
      }
      console.log('[ReferencePanel] Adding', newFiles.length, 'file(s) to allData. New total:', prev.allData.length + newFiles.length);
      return {
        ...prev,
        allData: [...prev.allData, ...newFiles]
      };
    });
  };

  // Download handlers
  const handleDownload = (file: File, filename: string) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Button click handlers
  const handleProgressButtonClick = () => {
    if (reportFiles.progress) {
      handleDownload(reportFiles.progress, reportFiles.progress.name || 'progress-report.pdf');
    } else {
      progressFileInputRef.current?.click();
    }
  };

  const handleDeviationButtonClick = () => {
    if (reportFiles.deviation) {
      handleDownload(reportFiles.deviation, reportFiles.deviation.name || 'deviation-report.pdf');
    } else {
      deviationFileInputRef.current?.click();
    }
  };

  const handleClashButtonClick = () => {
    if (reportFiles.clash) {
      handleDownload(reportFiles.clash, reportFiles.clash.name || 'clash-report.pdf');
    } else {
      clashFileInputRef.current?.click();
    }
  };

  const handleGeneratePdf = () => {
    const validInsights = insights.filter(i => i.title !== 'Awaiting Model Upload');
    if (!validInsights || validInsights.length === 0) return;

    const doc = new jsPDF();
    const projectName = summary.projectName;
    const scanDate = summary.captureDate;

    // Header
    doc.setFillColor(31, 41, 55); // gray-800
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), 25, 'F');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(projectName, doc.internal.pageSize.getWidth() / 2, 12, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Scan Date: ${scanDate}`, doc.internal.pageSize.getWidth() / 2, 20, { align: 'center' });

    // Executive Summary
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text('Executive Summary', 14, 40);

    autoTable(doc, {
      startY: 45,
      head: [['Metric', 'Count']],
      body: [
        ['Total Deviations', summary.totalDeviations],
        ...Object.entries(summary.deviationsBySeverity).map(([severity, count]) => [`${severity} Severity`, count]),
        ...Object.entries(summary.deviationsByStatus).map(([status, count]) => [`${status} Status`, count]),
      ],
      theme: 'grid',
      headStyles: { fillColor: [31, 41, 55] },
    });
    
    // Detailed Deviations
    const tableStartY = (doc as any).lastAutoTable.finalY + 15;
    doc.text('Detailed Deviations', 14, tableStartY);

    const severityOrder: Record<string, number> = { [Severity.Critical]: 4, [Severity.High]: 3, [Severity.Medium]: 2, [Severity.Low]: 1 };
    const statusOrder: Record<string, number> = { [InsightStatus.Open]: 4, [InsightStatus.Acknowledged]: 3, [InsightStatus.Resolved]: 2, [InsightStatus.Muted]: 1 };
    
    const sortedInsights = [...validInsights].sort((a, b) => {
        const severityA = severityOrder[a.severity!] || 0;
        const severityB = severityOrder[b.severity!] || 0;
        if (severityA !== severityB) return severityB - severityA;

        const statusA = statusOrder[a.status!] || 0;
        const statusB = statusOrder[b.status!] || 0;
        return statusB - statusA;
    });

    const tableData = sortedInsights.map((insight, index) => [
        index + 1,
        insight.title,
        insight.severity || 'N/A',
        insight.status || 'N/A',
        insight.assignedTo || 'Unassigned',
        (insight.notes || []).map(n => `- ${n.text}`).join('\n'),
    ]);
    
    const severityColors: Record<string, [number, number, number]> = {
      [Severity.Critical]: [239, 68, 68],
      [Severity.High]: [249, 115, 22],
      [Severity.Medium]: [234, 179, 8],
      [Severity.Low]: [34, 197, 94],
    };
    const statusColors: Record<string, [number, number, number]> = {
      [InsightStatus.Open]: [239, 68, 68],
      [InsightStatus.Acknowledged]: [234, 179, 8],
      [InsightStatus.Resolved]: [34, 197, 94],
      [InsightStatus.Muted]: [107, 114, 128],
    };

    autoTable(doc, {
        startY: tableStartY + 5,
        head: [['#', 'Issue', 'Severity', 'Status', 'Trade', 'Notes']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [31, 41, 55] },
        didParseCell: (data) => {
          if (data.section === 'body') {
            if (data.column.index === 2) { // Severity
                const color = severityColors[data.cell.raw as string];
                if (color) {
                    data.cell.styles.fillColor = color;
                    data.cell.styles.textColor = [255,255,255];
                }
            }
            if (data.column.index === 3) { // Status
                const color = statusColors[data.cell.raw as string];
                if (color) {
                    data.cell.styles.fillColor = color;
                    data.cell.styles.textColor = [255,255,255];
                }
            }
          }
        },
        didDrawPage: (data) => {
            const pageCount = doc.getNumberOfPages();
            doc.setFontSize(10);
            doc.setTextColor(150);
            const timestamp = new Date().toLocaleString();
            doc.text(`Generated on ${timestamp} | Page ${data.pageNumber} of ${pageCount}`, 14, doc.internal.pageSize.height - 10);
            doc.text('Maestro 4D - Construction Site Intelligence', doc.internal.pageSize.width - 14, doc.internal.pageSize.height - 10, { align: 'right' });
        },
        margin: { bottom: 20 },
    });

    const filename = `Deviation_Report_${projectName.replace(/\s/g, '_')}_${scanDate}.pdf`;
    doc.save(filename);
  };

  const hasInsights = insights && insights.length > 0 && insights[0]?.title !== 'Awaiting Model Upload';

  // Calculate counts for Total Tasks pie chart
  const criticalCount = summary.deviationsBySeverity[Severity.Critical] || 0;
  const highCount = summary.deviationsBySeverity[Severity.High] || 0;
  const mediumCount = summary.deviationsBySeverity[Severity.Medium] || 0;
  const lowCount = summary.deviationsBySeverity[Severity.Low] || 0;
  const totalTasks = criticalCount + highCount + mediumCount + lowCount;

  // Calculate percentages for pie chart
  const criticalPercent = totalTasks > 0 ? (criticalCount / totalTasks) * 100 : 0;
  const highPercent = totalTasks > 0 ? (highCount / totalTasks) * 100 : 0;
  const mediumPercent = totalTasks > 0 ? (mediumCount / totalTasks) * 100 : 0;
  const lowPercent = totalTasks > 0 ? (lowCount / totalTasks) * 100 : 0;

  // Build conic-gradient string
  let gradient = 'conic-gradient(';
  let currentPercent = 0;
  if (criticalCount > 0) {
    gradient += `#ef4444 ${currentPercent}% ${currentPercent + criticalPercent}%`;
    currentPercent += criticalPercent;
  }
  if (highCount > 0) {
    if (currentPercent > 0) gradient += ', ';
    gradient += `#f97316 ${currentPercent}% ${currentPercent + highPercent}%`;
    currentPercent += highPercent;
  }
  if (mediumCount > 0) {
    if (currentPercent > 0) gradient += ', ';
    gradient += `#eab308 ${currentPercent}% ${currentPercent + mediumPercent}%`;
    currentPercent += mediumPercent;
  }
  if (lowCount > 0) {
    if (currentPercent > 0) gradient += ', ';
    gradient += `#22c55e ${currentPercent}% ${currentPercent + lowPercent}%`;
    currentPercent += lowPercent;
  }
  if (totalTasks === 0) {
    gradient = 'conic-gradient(#374151 0% 100%';
  }
  gradient += ')';

  // Calculate clash count
  const clashCount = insights.filter(i => i.type === InsightType.Clash).length;

  return (
    <div className="w-full bg-gradient-to-b from-gray-900 via-gray-900 to-black backdrop-blur-xl p-5 flex flex-col h-full border-l border-white/5">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 tracking-tight">Reference</h2>
      </div>

      <div className="flex p-1 bg-black/40 rounded-lg border border-white/5 mb-6">
        <button
          type="button"
          onClick={() => isListDataActive && onToggleListData && onToggleListData()}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all duration-300 ${
            !isListDataActive
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-900/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
          aria-label="BIM Milestones"
        >
          BIM Milestones
        </button>
        <button
          type="button"
          onClick={() => !isListDataActive && onToggleListData && onToggleListData()}
          className={`flex-1 py-2 text-sm font-bold rounded-md transition-all duration-300 ${
            isListDataActive
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg shadow-cyan-900/20'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
          aria-label="List Data"
          aria-pressed={isListDataActive}
        >
          List Data
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-5 custom-scrollbar flex flex-col">
        {isListDataActive ? (
          <div className="flex flex-col h-full">
            {/* Hidden folder input */}
            <input
               ref={folderInputRef}
               type="file"
               webkitdirectory=""
               directory=""
               className="hidden"
               onChange={handleFolderUpload}
               multiple
             />
             
            {/* Folder Tree View */}
            <div className="flex-1">
                <FolderTreeView 
                    nodes={fileSystemTree}
                    selectedNodeId={selectedNodeId || null}
                    onSelectNode={onSelectNode || (() => {})}
                    onToggleExpand={onToggleExpand || (() => {})}
                    onRenameNode={onRenameNode || (() => {})}
                    onDeleteNode={onDeleteNode || (() => {})}
                    onMoveNode={onMoveNode || (() => {})}
                    onOpenFile={onOpenFile || (() => {})}
                    onCreateFolder={onCreateFolder || (() => {})}
                />
            </div>
            
            {/* Upload Buttons Area */}
            {onAddFile && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                        onClick={() => fileInputRef?.current?.click()}
                        className="px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-cyan-900/20 hover:to-blue-900/20 text-gray-300 hover:text-cyan-400 rounded-xl border border-dashed border-gray-700 hover:border-cyan-500/50 transition-all duration-300 flex items-center justify-center gap-2 text-sm font-bold shadow-lg hover:shadow-cyan-900/10 group"
                        aria-label="Add Files"
                    >
                        <PlusIcon className="h-4 w-4 group-hover:scale-110 transition-transform duration-300" />
                        <span>Add Files</span>
                    </button>
                    
                    <button
                        onClick={() => folderInputRef.current?.click()}
                        className="px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-purple-900/20 hover:to-pink-900/20 text-gray-300 hover:text-purple-400 rounded-xl border border-dashed border-gray-700 hover:border-purple-500/50 transition-all duration-300 flex items-center justify-center gap-2 text-sm font-bold shadow-lg hover:shadow-purple-900/10 group"
                        aria-label="Add Folder"
                    >
                        <FolderIcon className="h-4 w-4 group-hover:scale-110 transition-transform duration-300" />
                        <span>Add Folder</span>
                    </button>
                </div>
            )}
          </div>
        ) : (
          <>
            {/* Total Tasks Card */}
            <div className="group relative bg-gradient-to-br from-gray-800/40 to-gray-900/40 p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-all duration-300 overflow-hidden hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 group-hover:text-cyan-400 transition-colors">Total Tasks</h3>
              <div className="flex items-center gap-6">
                {/* Donut Chart */}
                <div className="flex-shrink-0 relative">
                  <div className="absolute inset-0 rounded-full blur-md opacity-50" style={{ background: gradient }}></div>
                  <div className="relative w-24 h-24">
                    <div
                      className="absolute inset-0 rounded-full border-[6px] border-transparent"
                      style={{ background: `${gradient} border-box`, mask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)' }}
                    />
                    <div className="absolute inset-0 rounded-full" style={{ background: gradient, mask: 'radial-gradient(transparent 60%, black 61%)' }} />
                    
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-3xl font-black text-white drop-shadow-lg">{totalTasks}</span>
                    </div>
                  </div>
                </div>
                {/* Severity Counts */}
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></div>
                      <span className="text-sm font-medium text-gray-400">Critical</span>
                    </div>
                    <span className="text-sm font-bold text-white">{criticalCount}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]"></div>
                      <span className="text-sm font-medium text-gray-400">High</span>
                    </div>
                    <span className="text-sm font-bold text-white">{highCount}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]"></div>
                      <span className="text-sm font-medium text-gray-400">Medium</span>
                    </div>
                    <span className="text-sm font-bold text-white">{mediumCount}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                      <span className="text-sm font-medium text-gray-400">Low</span>
                    </div>
                    <span className="text-sm font-bold text-white">{lowCount}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Overall Job Progress Card */}
            <div className="group relative bg-gradient-to-br from-gray-800/40 to-gray-900/40 p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-all duration-300 overflow-hidden hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 group-hover:text-cyan-400 transition-colors">Overall Job Progress</h3>
              <div className="mb-6">
                <div className="flex justify-between items-end mb-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Completion</span>
                  <span className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">{progress}%</span>
                </div>
                <div className="w-full bg-gray-800/50 rounded-full h-2.5 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full rounded-full transition-all duration-500 shadow-[0_0_15px_rgba(6,182,212,0.5)]"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
              <input
                type="file"
                accept="application/pdf"
                ref={progressFileInputRef}
                onChange={handleProgressUpload}
                className="hidden"
                aria-label="Upload progress report PDF"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (reportFiles.progress && onViewReport) {
                      onViewReport('progress', reportFiles.progress);
                    }
                  }}
                  disabled={!reportFiles.progress}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 ${
                    reportFiles.progress
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/20 hover:shadow-cyan-900/40 hover:-translate-y-0.5'
                      : 'bg-gray-800/50 border border-white/5 text-gray-500 cursor-not-allowed'
                  }`}
                  aria-label="View Progress Report"
                >
                  <DocumentIcon className="h-4 w-4" />
                  <span>View Report</span>
                </button>
                <button
                  onClick={handleProgressButtonClick}
                  className={`p-2.5 rounded-lg transition-all duration-300 border ${
                    reportFiles.progress
                      ? 'bg-gray-800 border-white/10 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-white/20'
                      : 'bg-gray-800/50 border-transparent text-gray-600 hover:bg-gray-800 hover:text-cyan-400'
                  }`}
                  aria-label={reportFiles.progress ? 'Download Progress Report' : 'Upload Progress Report'}
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Deviation Analysis Card */}
            <div className="group relative bg-gradient-to-br from-gray-800/40 to-gray-900/40 p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-all duration-300 overflow-hidden hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 group-hover:text-cyan-400 transition-colors">Deviation Analysis</h3>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 mb-6">{summary.totalDeviations} <span className="text-lg font-medium text-gray-500">Deviations</span></p>
              <input
                type="file"
                accept="application/pdf"
                ref={deviationFileInputRef}
                onChange={handleDeviationUpload}
                className="hidden"
                aria-label="Upload deviation report PDF"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (reportFiles.deviation && onViewReport) {
                      onViewReport('deviation', reportFiles.deviation);
                    }
                  }}
                  disabled={!reportFiles.deviation || isAnalyzing}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 ${
                    reportFiles.deviation
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/20 hover:shadow-cyan-900/40 hover:-translate-y-0.5'
                      : 'bg-gray-800/50 border border-white/5 text-gray-500 cursor-not-allowed'
                  }`}
                  aria-label="View Deviation Report"
                >
                  {isAnalyzing ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Analyzing...</span>
                    </>
                  ) : (
                    <>
                      <DocumentIcon className="h-4 w-4" />
                      <span>View Report</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleDeviationButtonClick}
                  className={`p-2.5 rounded-lg transition-all duration-300 border ${
                    reportFiles.deviation
                      ? 'bg-gray-800 border-white/10 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-white/20'
                      : 'bg-gray-800/50 border-transparent text-gray-600 hover:bg-gray-800 hover:text-cyan-400'
                  }`}
                  aria-label={reportFiles.deviation ? 'Download Deviation Report' : 'Upload Deviation Report'}
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Clash Detection Card */}
            <div className="group relative bg-gradient-to-br from-gray-800/40 to-gray-900/40 p-5 rounded-xl border border-white/10 hover:border-cyan-500/30 transition-all duration-300 overflow-hidden hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 group-hover:text-cyan-400 transition-colors">Clash Detection</h3>
              <p className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-white to-gray-400 mb-6">{clashCount} <span className="text-lg font-medium text-gray-500">Clashes</span></p>
              <input
                type="file"
                accept="application/pdf"
                ref={clashFileInputRef}
                onChange={handleClashUpload}
                className="hidden"
                aria-label="Upload clash report PDF"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (reportFiles.clash && onViewReport) {
                      onViewReport('clash', reportFiles.clash);
                    }
                  }}
                  disabled={!reportFiles.clash}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold rounded-lg transition-all duration-300 ${
                    reportFiles.clash
                      ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-900/20 hover:shadow-cyan-900/40 hover:-translate-y-0.5'
                      : 'bg-gray-800/50 border border-white/5 text-gray-500 cursor-not-allowed'
                  }`}
                  aria-label="View Clash Report"
                >
                  <DocumentIcon className="h-4 w-4" />
                  <span>View Report</span>
                </button>
                <button
                  onClick={handleClashButtonClick}
                  className={`p-2.5 rounded-lg transition-all duration-300 border ${
                    reportFiles.clash
                      ? 'bg-gray-800 border-white/10 text-gray-300 hover:bg-gray-700 hover:text-white hover:border-white/20'
                      : 'bg-gray-800/50 border-transparent text-gray-600 hover:bg-gray-800 hover:text-cyan-400'
                  }`}
                  aria-label={reportFiles.clash ? 'Download Clash Report' : 'Upload Clash Report'}
                >
                  <ArrowDownTrayIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReferencePanel;
