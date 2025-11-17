
import React, { useState, useRef } from 'react';
import { ProjectSummary, Severity, Insight, InsightStatus, InsightType } from '../types';
import { DocumentIcon, ArrowDownTrayIcon } from './Icons';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type ReportType = 'progress' | 'deviation' | 'clash' | 'allData';

interface ReferencePanelProps {
  summary: ProjectSummary;
  insights: Insight[];
  progress: number;
  onViewReport?: (type: ReportType, files: File | File[], onDeleteFile?: (index: number) => void, onAddFile?: (files: File[]) => void) => void;
}

const ReferencePanel: React.FC<ReferencePanelProps> = ({ summary, insights, progress, onViewReport }) => {
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

  // Refs for file inputs
  const progressFileInputRef = useRef<HTMLInputElement>(null);
  const deviationFileInputRef = useRef<HTMLInputElement>(null);
  const clashFileInputRef = useRef<HTMLInputElement>(null);

  // Upload handlers
  const handleProgressUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setReportFiles(prev => ({ ...prev, progress: file }));
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const handleDeviationUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setReportFiles(prev => ({ ...prev, deviation: file }));
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
  }
  if (totalTasks === 0) {
    gradient = 'conic-gradient(#374151 0% 100%';
  }
  gradient += ')';

  // Calculate clash count
  const clashCount = insights.filter(i => i.type === InsightType.Clash).length;

  return (
    <div className="w-full bg-gray-900/80 backdrop-blur-sm p-4 flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-white tracking-wide">Reference</h2>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          className="px-3 py-2 bg-gray-700 text-gray-200 text-sm font-semibold rounded-md hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-gray-500"
          aria-label="BIM Milestones"
        >
          BIM Milestones
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-4">
        {/* Total Tasks Card */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-3">Total Tasks</h3>
          <div className="flex items-center gap-4">
            {/* Donut Chart */}
            <div className="flex-shrink-0">
              <div className="relative w-20 h-20">
                <div
                  className="absolute inset-0 rounded-full"
                  style={{ background: gradient }}
                />
                <div className="absolute inset-3 bg-gray-900/80 rounded-full" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-extrabold leading-none text-white">{totalTasks}</span>
                </div>
              </div>
            </div>
            {/* Severity Counts */}
            <div className="flex-1 space-y-1.5">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-sm text-gray-300">Critical</span>
                </div>
                <span className="text-sm font-bold text-white">{criticalCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                  <span className="text-sm text-gray-300">High</span>
                </div>
                <span className="text-sm font-bold text-white">{highCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span className="text-sm text-gray-300">Medium</span>
                </div>
                <span className="text-sm font-bold text-white">{mediumCount}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-sm text-gray-300">Low</span>
                </div>
                <span className="text-sm font-bold text-white">{lowCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Overall Job Progress Card */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-3">Overall Job Progress</h3>
          <div className="mb-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-400">Progress</span>
              <span className="text-sm font-bold text-cyan-400">{progress}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-blue-500 to-cyan-400 h-3 rounded-full transition-all duration-300"
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
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (reportFiles.progress && onViewReport) {
                  onViewReport('progress', reportFiles.progress);
                }
              }}
              disabled={!reportFiles.progress}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.progress
                  ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  : 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
              }`}
              aria-label="View Progress Report"
            >
              <DocumentIcon className="h-4 w-4" />
              <span>View Progress Report</span>
            </button>
            <button
              onClick={handleProgressButtonClick}
              className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.progress
                  ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={reportFiles.progress ? 'Download Progress Report' : 'Upload Progress Report'}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Deviation Analysis Card */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-2">Deviation Analysis</h3>
          <p className="text-2xl font-bold text-white mb-3">{summary.totalDeviations} Deviations</p>
          <input
            type="file"
            accept="application/pdf"
            ref={deviationFileInputRef}
            onChange={handleDeviationUpload}
            className="hidden"
            aria-label="Upload deviation report PDF"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (reportFiles.deviation && onViewReport) {
                  onViewReport('deviation', reportFiles.deviation);
                }
              }}
              disabled={!reportFiles.deviation}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.deviation
                  ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  : 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
              }`}
              aria-label="View Deviation Report"
            >
              <DocumentIcon className="h-4 w-4" />
              <span>View Deviation Report</span>
            </button>
            <button
              onClick={handleDeviationButtonClick}
              className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.deviation
                  ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={reportFiles.deviation ? 'Download Deviation Report' : 'Upload Deviation Report'}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Clash Detection Card */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-2">Clash Detection</h3>
          <p className="text-2xl font-bold text-white mb-3">{clashCount} Clashes</p>
          <input
            type="file"
            accept="application/pdf"
            ref={clashFileInputRef}
            onChange={handleClashUpload}
            className="hidden"
            aria-label="Upload clash report PDF"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (reportFiles.clash && onViewReport) {
                  onViewReport('clash', reportFiles.clash);
                }
              }}
              disabled={!reportFiles.clash}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.clash
                  ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  : 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
              }`}
              aria-label="View Clash Report"
            >
              <DocumentIcon className="h-4 w-4" />
              <span>View Clash Report</span>
            </button>
            <button
              onClick={handleClashButtonClick}
              className={`p-2 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 ${
                reportFiles.clash
                  ? 'bg-cyan-600 text-white hover:bg-cyan-700'
                  : 'bg-gray-700 text-gray-200 hover:bg-gray-600'
              }`}
              aria-label={reportFiles.clash ? 'Download Clash Report' : 'Upload Clash Report'}
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Test Card */}
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200">Test</h3>
        </div>
      </div>
    </div>
  );
};

export default ReferencePanel;

