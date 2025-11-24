import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Project, Insight, InsightType, Severity, InsightStatus, ProjectSummary, Note, ScanData, AgentType, AgentState, PdfAnnotation, AnnotationGroup, ThreeDAnnotation, SerializableFile, FileSystemNode, Annotation } from '../types';
import { ArrowLeftIcon, PencilIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlusIcon, DocumentIcon, RectangleIcon } from './Icons';
import Viewer from './Viewer';
import PdfViewer, { PdfToolbarHandlers } from './PdfViewer';
import PdfToolsPanel from './PdfToolsPanel';
import InsightsList from './InsightsList';
import ReferencePanel from './ReferencePanel';
import InsightChatPanel from './InsightChatPanel';
import TimelineScrubber from './TimelineScrubber';
import AddScanModal from './AddScanModal';
import GeminiPanel, { AgentsLogo } from './GeminiPanel';
import AnnotationsPanel from './AnnotationsPanel';

import { saveFileToDB, getFileFromDB, deleteFileFromDB } from '../utils/db';
import {
    buildTreeFromFiles,
    flattenTree,
    findNodeById,
    updateNodeInTree,
    removeNodeFromTree,
    addNodeToTree,
    moveNode,
    renameNode,
    sortNodes
} from '../utils/fileSystem';

// --- FILE HELPERS ---
const fileToSerializable = async (file: File, path?: string): Promise<SerializableFile> => {
    try {
        const id = await saveFileToDB(file, file.name, file.type);
        return {
            name: file.name,
            type: file.type,
            size: file.size,
            storageId: id,
            path: path
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
                path: path
            });
            reader.onerror = error => reject(error);
        });
    }
};

const serializableToFile = async (sFile: SerializableFile): Promise<File> => {
    if (sFile.storageId) {
        try {
            const stored = await getFileFromDB(sFile.storageId);
            if (stored) {
                const file = new File([stored.blob], stored.name, { type: stored.type });
                // We can attach the path property to the file object if needed, but File object is read-only usually
                // Instead we rely on the node structure
                return file;
            }
        } catch (e) {
            console.error("Error fetching file from DB", e);
        }
    }

    if (sFile.content) {
        const arr = sFile.content.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || sFile.type;
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new File([u8arr], sFile.name, { type: mime });
    }

    return new File(["File not found"], sFile.name, { type: "text/plain" });
};

// --- CSV PARSING UTILITY ---
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

// --- REPORT OVERLAY VIEWER COMPONENT ---
interface ReportOverlayViewerProps {
    files: Array<{ name: string; url: string; file: File }>;
    selectedIndex: number;
    onClose: () => void;
    onSelectFile: (index: number) => void;
    getFileType: (file: File) => 'pdf' | 'csv' | 'glb' | 'image' | 'other';
    onDeleteFile?: (index: number) => void;
    onAddFile?: (files: File[]) => void;
}

const ReportOverlayViewer: React.FC<ReportOverlayViewerProps> = ({
    files,
    selectedIndex,
    onClose,
    onSelectFile,
    getFileType,
    onDeleteFile,
    onAddFile
}) => {
    const selectedFile = files[selectedIndex];
    const fileType = selectedFile ? getFileType(selectedFile.file) : 'other';
    const [csvData, setCsvData] = useState<Record<string, string>[] | null>(null);
    const [csvLoading, setCsvLoading] = useState(false);
    const [csvError, setCsvError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load CSV data when CSV file is selected
    useEffect(() => {
        if (fileType === 'csv' && selectedFile) {
            setCsvLoading(true);
            setCsvError(null);
            selectedFile.file.text()
                .then(text => {
                    try {
                        const parsed = parseCsv(text);
                        setCsvData(parsed);
                    } catch (error) {
                        setCsvError('Failed to parse CSV file');
                        console.error('CSV parsing error:', error);
                    }
                    setCsvLoading(false);
                })
                .catch(error => {
                    setCsvError('Failed to read CSV file');
                    console.error('CSV read error:', error);
                    setCsvLoading(false);
                });
        } else {
            setCsvData(null);
            setCsvError(null);
        }
    }, [fileType, selectedFile]);

    const handleDownload = () => {
        if (!selectedFile) return;
        const url = URL.createObjectURL(selectedFile.file);
        const link = document.createElement('a');
        link.href = url;
        link.download = selectedFile.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleAddFileClick = () => {
        if (onAddFile && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (onAddFile && e.target.files && e.target.files.length > 0) {
            const selectedFiles = Array.from(e.target.files) as File[];
            console.log('[ReportOverlay] Files selected:', selectedFiles.map(f => ({ name: f.name, size: f.size })));
            onAddFile(selectedFiles);
            // Reset the input so the same file can be selected again
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        } else {
            console.warn('[ReportOverlay] File input change but no files or onAddFile callback');
        }
    };

    const renderViewer = () => {
        if (!selectedFile) return null;

        switch (fileType) {
            case 'pdf':
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden">
                        <iframe
                            src={selectedFile.url}
                            className="w-full h-full border-2 border-gray-700 rounded-lg bg-white"
                            title={`Report: ${selectedFile.name}`}
                        />
                    </div>
                );

            case 'csv':
                if (csvLoading) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                                <p className="text-gray-300">Loading CSV...</p>
                            </div>
                        </div>
                    );
                }
                if (csvError) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <p className="text-red-400 mb-4">{csvError}</p>
                                <button
                                    onClick={handleDownload}
                                    className="px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600"
                                >
                                    Download File
                                </button>
                            </div>
                        </div>
                    );
                }
                if (!csvData || csvData.length === 0) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <p className="text-gray-400">CSV file is empty</p>
                        </div>
                    );
                }
                const headers = Object.keys(csvData[0]);
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-auto">
                        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-700 text-gray-200 sticky top-0">
                                    <tr>
                                        {headers.map((header, idx) => (
                                            <th key={idx} className="px-4 py-3 font-semibold border-b border-gray-600">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="text-gray-300">
                                    {csvData.map((row, rowIdx) => (
                                        <tr key={rowIdx} className="border-b border-gray-700 hover:bg-gray-700/50">
                                            {headers.map((header, colIdx) => (
                                                <td key={colIdx} className="px-4 py-2">
                                                    {row[header] || ''}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );

            case 'glb':
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden">
                        <Viewer modelUrl={selectedFile.url} />
                    </div>
                );

            case 'image':
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden flex items-center justify-center bg-gray-800">
                        <img
                            src={selectedFile.url}
                            alt={selectedFile.name}
                            className="max-w-full max-h-full object-contain border-2 border-gray-700 rounded-lg"
                            title={selectedFile.name}
                        />
                    </div>
                );

            default:
                // Fallback for other file types
                const fileSizeKB = (selectedFile.file.size / 1024).toFixed(2);
                return (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center max-w-md">
                            <p className="text-gray-300 text-lg mb-2">{selectedFile.name}</p>
                            <p className="text-gray-400 text-sm mb-4">
                                Type: {selectedFile.file.type || 'Unknown'} ({fileSizeKB} KB)
                            </p>
                            <button
                                onClick={handleDownload}
                                className="px-6 py-3 bg-cyan-600 text-white rounded-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                            >
                                Download File
                            </button>
                        </div>
                    </div>
                );
        }
    };

    return (
        <div className="absolute inset-0 z-30 bg-gray-900/95 flex flex-col">
            {/* Hidden file input */}
            {onAddFile && (
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                    accept=".pdf,.csv,.glb"
                />
            )}

            {/* Add file button */}
            {onAddFile && (
                <button
                    onClick={handleAddFileClick}
                    className="absolute top-3 right-14 z-40 p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                    aria-label="Add Files"
                >
                    <PlusIcon className="h-6 w-6" />
                </button>
            )}

            <button
                onClick={onClose}
                className="absolute top-3 right-3 z-40 p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                aria-label="Close Report Viewer"
            >
                <CloseIcon className="h-6 w-6" />
            </button>

            {/* File selector for multiple files */}
            {(files.length > 1 || (files.length > 0 && onDeleteFile)) && (
                <div className="flex gap-2 p-4 bg-gray-800/50 border-b border-gray-700 overflow-x-auto">
                    {files.map((file, index) => (
                        <div key={index} className="relative group">
                            <button
                                onClick={() => onSelectFile(index)}
                                className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors whitespace-nowrap flex items-center gap-2 ${selectedIndex === index
                                    ? 'bg-cyan-600 text-white'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                            >
                                <span>{file.name}</span>
                                {onDeleteFile && (
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteFile(index);
                                        }}
                                        className="ml-1 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors focus:outline-none focus:ring-1 focus:ring-red-400 cursor-pointer"
                                        aria-label={`Delete ${file.name}`}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.stopPropagation();
                                                e.preventDefault();
                                                onDeleteFile(index);
                                            }
                                        }}
                                    >
                                        <CloseIcon className="h-3 w-3" />
                                    </span>
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {renderViewer()}
        </div>
    );
};

// --- VIEWER PAGE COMPONENT ---

interface ProjectViewerPageProps {
    project: Project;
    onBack: () => void;
    onUpdateProjectName: (newName: string) => void;
    onSaveProject: (updatedScans: ScanData[], agentStates: Record<AgentType, AgentState>) => void;
}

const DEFAULT_AGENT_STATES: Record<AgentType, AgentState> = {
    market: {
        chatHistory: [{ role: 'model', parts: [{ text: "I am the Market Intelligence Agent. I'm tracking live prices. Ask me about material trends, volatility, or for procurement advice, like 'Should I lock in steel prices now?'" }] }],
        uploadedFiles: [],
    },
    spec: {
        chatHistory: [{ role: 'model', parts: [{ text: "I am the Spec Search Agent. Please upload your project specifications, drawings, and contracts. I can then answer questions like, 'What are the fire rating requirements for the stairwell walls?'" }] }],
        uploadedFiles: [],
    }
};

// Per-scan viewer state type
interface ScanViewerState {
    // Kept for compatibility/reference, but derived from fileSystemTree in this implementation
    centerViewerFiles: Array<{ name: string; url: string; file: File }>;

    // New tree structure state
    fileSystemTree: FileSystemNode[];
    selectedNodeId: string | null;

    // Which file is currently open in the main viewer
    openedFileId: string | null;

    selectedFileIndex: number; // Maintained for compatibility with legacy logic

    pdfAnnotations: Record<string, Record<number, PdfAnnotation[]>>;
    pdfAnnotationGroups: Record<string, AnnotationGroup[]>;
    csvData: Record<string, string>[] | null;
    csvLoading: boolean;
    csvError: string | null;
    briefFileIndex: number | null;
}

const EMPTY_SCAN_VIEWER_STATE: ScanViewerState = {
    centerViewerFiles: [],
    fileSystemTree: [],
    selectedNodeId: null,
    openedFileId: null,
    selectedFileIndex: 0,
    pdfAnnotations: {},
    pdfAnnotationGroups: {},
    csvData: null,
    csvLoading: false,
    csvError: null,
    briefFileIndex: null,
};

const ProjectViewerPage: React.FC<ProjectViewerPageProps> = ({ project, onBack, onUpdateProjectName, onSaveProject }) => {
    const [scans, setScans] = useState<ScanData[]>([]);
    const [currentScanDate, setCurrentScanDate] = useState('');
    const [isAddScanModalOpen, setIsAddScanModalOpen] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [editedName, setEditedName] = useState(project.name);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const [agentStates, setAgentStates] = useState<Record<AgentType, AgentState>>(project.agentStates || DEFAULT_AGENT_STATES);
    const [isAgentsLauncherOpen, setIsAgentsLauncherOpen] = useState(false);
    const [isDeleteMode, setIsDeleteMode] = useState(false);
    const [selectedScanDates, setSelectedScanDates] = useState<string[]>([]);
    const [isGlbActive, setIsGlbActive] = useState(false);
    const [isBimActive, setIsBimActive] = useState(false);
    const [isListDataActive, setIsListDataActive] = useState(false);

    // Per-scan viewer state map - keyed by scan date
    const [scanViewerState, setScanViewerState] = useState<Record<string, ScanViewerState>>({});

    // Refs for center viewer
    const centerViewerUrlsRef = useRef<Record<string, string[]>>({});
    const centerViewerFileInputRef = useRef<HTMLInputElement>(null);

    // Ref for tracking GLB URLs per scan (for cleanup)
    const glbUrlsRef = useRef<Record<string, string>>({});

    // PDF tools panel state
    const [isPdfToolsOpen, setIsPdfToolsOpen] = useState<boolean>(false);
    const [pdfToolbarHandlers, setPdfToolbarHandlers] = useState<PdfToolbarHandlers | null>(null);
    const pdfToolsButtonRef = useRef<HTMLButtonElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);

    // Report overlay state
    type ReportType = 'progress' | 'deviation' | 'clash' | 'allData';
    const [reportOverlay, setReportOverlay] = useState<{
        type: ReportType | null;
        files: Array<{ name: string; url: string; file: File }>;
        selectedIndex: number;
        onDeleteFile?: (index: number) => void;
        onAddFile?: (files: File[]) => void;
    }>({ type: null, files: [], selectedIndex: 0 });
    const reportUrlsRef = useRef<string[]>([]);

    const [isInsightsPanelCollapsed, setIsInsightsPanelCollapsed] = useState(() => {
        return localStorage.getItem('maestro4d_insightsPanelCollapsed') === 'true';
    });

    const [isMetricsPanelCollapsed, setIsMetricsPanelCollapsed] = useState(() => {
        return localStorage.getItem('maestro4d_metricsPanelCollapsed') === 'true';
    });

    // State for tracking active insight chat in right panel
    const [activeInsightChatId, setActiveInsightChatId] = useState<string | null>(null);
    const [highlightedInsightId, setHighlightedInsightId] = useState<string | null>(null);

    // File type detection utility - defined early to avoid temporal dead zone issues
    const getFileType = (file: File): 'pdf' | 'csv' | 'glb' | 'image' | 'other' => {
        try {
            const extension = file.name.split('.').pop()?.toLowerCase() || '';
            const mimeType = file.type.toLowerCase();

            if (extension === 'pdf' || mimeType === 'application/pdf') return 'pdf';
            if (extension === 'csv' || mimeType === 'text/csv' || mimeType === 'text/comma-separated-values') return 'csv';
            if (extension === 'glb' || mimeType === 'model/gltf-binary') return 'glb';
            if (extension === 'png' || extension === 'jpg' || extension === 'jpeg' || extension === 'gif' || extension === 'webp' ||
                mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/gif' || mimeType === 'image/webp') {
                return 'image';
            }
            return 'other';
        } catch (error) {
            console.error('Error detecting file type:', error);
            return 'other';
        }
    };

    // Helper function to generate unique file identifier
    const getFileIdentifier = (file: File): string => {
        return `${file.name}_${file.size}`;
    };

    // Helper functions to get/update current scan's viewer state
    const getCurrentScanViewerState = useCallback((): ScanViewerState => {
        if (!currentScanDate) return EMPTY_SCAN_VIEWER_STATE;
        return scanViewerState[currentScanDate] || EMPTY_SCAN_VIEWER_STATE;
    }, [currentScanDate, scanViewerState]);

    const updateCurrentScanViewerState = useCallback((updater: (state: ScanViewerState) => ScanViewerState) => {
        if (!currentScanDate) return;
        setScanViewerState(prev => ({
            ...prev,
            [currentScanDate]: updater(prev[currentScanDate] || EMPTY_SCAN_VIEWER_STATE)
        }));
    }, [currentScanDate]);

    // Memoized current scan viewer state
    const currentScanViewerState = useMemo(() => getCurrentScanViewerState(), [getCurrentScanViewerState]);

    useEffect(() => {
        localStorage.setItem('maestro4d_insightsPanelCollapsed', String(isInsightsPanelCollapsed));
    }, [isInsightsPanelCollapsed]);

    useEffect(() => {
        localStorage.setItem('maestro4d_metricsPanelCollapsed', String(isMetricsPanelCollapsed));
    }, [isMetricsPanelCollapsed]);

    const toggleInsightsPanel = useCallback(() => {
        setIsInsightsPanelCollapsed(prev => !prev);
    }, []);

    const toggleMetricsPanel = useCallback(() => {
        setIsMetricsPanelCollapsed(prev => !prev);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '[') {
                    e.preventDefault();
                    toggleInsightsPanel();
                } else if (e.key === ']') {
                    e.preventDefault();
                    toggleMetricsPanel();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [toggleInsightsPanel, toggleMetricsPanel]);


    useEffect(() => {
        if (isEditingName && nameInputRef.current) {
            nameInputRef.current.focus();
            nameInputRef.current.select();
        }
    }, [isEditingName]);

    useEffect(() => {
        setEditedName(project.name);
    }, [project.name]);

    const handleNameSave = () => {
        if (editedName.trim() && editedName.trim() !== project.name) {
            onUpdateProjectName(editedName.trim());
        } else {
            setEditedName(project.name); // revert
        }
        setIsEditingName(false);
    };

    const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleNameSave();
        } else if (e.key === 'Escape') {
            setEditedName(project.name);
            setIsEditingName(false);
        }
    };

    // Get the data for the currently selected scan
    const currentScan = useMemo(() => scans.find(s => s.date === currentScanDate), [scans, currentScanDate]);

    useEffect(() => {
        // Initialize scans from project prop. If empty, create a default one.
        const initialScans = (project.scans && project.scans.length > 0)
            ? project.scans
            : [{
                date: project.lastScan.date,
                modelUrl: project.modelUrl,
                pdfUrl: undefined,
                pdfAnnotations: {},
                insights: [],
            }];
        setScans(initialScans);

        // Initialize agent states
        setAgentStates(project.agentStates || DEFAULT_AGENT_STATES);

        // Initialize empty viewer state for all scans
        const initialViewerState: Record<string, ScanViewerState> = {};
        initialScans.forEach(scan => {
            initialViewerState[scan.date] = {
                ...EMPTY_SCAN_VIEWER_STATE,
                centerViewerFiles: [], // Will load async
                fileSystemTree: [],
                selectedFileIndex: 0,
            };
        });
        setScanViewerState(initialViewerState);

        // Async load files
        const loadFiles = async () => {
            for (const scan of initialScans) {
                if (!scan.centerViewerFiles || scan.centerViewerFiles.length === 0) continue;

                try {
                    // Reconstruct file objects from serializable
                    const hydratedFiles = await Promise.all(scan.centerViewerFiles.map(async sFile => {
                        const file = await serializableToFile(sFile);
                        const url = URL.createObjectURL(file);
                        // Track URL for cleanup
                        if (!centerViewerUrlsRef.current[scan.date]) {
                            centerViewerUrlsRef.current[scan.date] = [];
                        }
                        centerViewerUrlsRef.current[scan.date].push(url);

                        // Attach path from serialized object if available, or use name
                        if (sFile.path) {
                            Object.defineProperty(file, 'webkitRelativePath', {
                                value: sFile.path,
                                writable: false
                            });
                        }

                        return { name: file.name, url, file };
                    }));

                    const filesOnly = hydratedFiles.map(f => f.file);
                    const tree = buildTreeFromFiles(filesOnly);

                    setScanViewerState(prev => ({
                        ...prev,
                        [scan.date]: {
                            ...prev[scan.date],
                            centerViewerFiles: hydratedFiles,
                            fileSystemTree: tree,
                            selectedFileIndex: 0,
                            // If we have files, open the first one by default
                            openedFileId: tree.length > 0 && tree[0].type === 'file' ? tree[0].id : null,
                            selectedNodeId: tree.length > 0 ? tree[0].id : null
                        }
                    }));
                } catch (error) {
                    console.error(`Error loading files for scan ${scan.date}:`, error);
                }
            }
        };
        loadFiles();

        // Set current date to the latest scan date present in the project data
        const latestScanDate = initialScans.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.date || project.lastScan.date;
        setCurrentScanDate(latestScanDate);
    }, [project.id]);

    const handleDateChange = (newDate: string) => {
        setCurrentScanDate(newDate);
    };

    // Reset UI elements when scan changes
    useEffect(() => {
        // Close PDF tools panel
        setIsPdfToolsOpen(false);
        setPdfToolbarHandlers(null);

        // Close active insight chat
        setActiveInsightChatId(null);
    }, [currentScanDate]);

    const handleAddScan = () => {
        // Exit delete mode when adding a scan
        if (isDeleteMode) {
            setIsDeleteMode(false);
            setSelectedScanDates([]);
        }
        setIsAddScanModalOpen(true);
    };

    const handleToggleDeleteMode = () => {
        setIsDeleteMode(prev => !prev);
        setSelectedScanDates([]);
    };

    const handleToggleGlb = () => {
        setIsGlbActive(prev => {
            const newValue = !prev;
            if (newValue) {
                setIsBimActive(false);
            }
            return newValue;
        });
    };

    const handleToggleBim = () => {
        setIsBimActive(prev => {
            const newValue = !prev;
            if (newValue) {
                setIsGlbActive(false);
            }
            return newValue;
        });
    };

    const handleToggleListData = () => {
        setIsListDataActive(prev => !prev);
    };

    const handleToggleScanSelection = (date: string) => {
        setSelectedScanDates(prev => {
            if (prev.includes(date)) {
                return prev.filter(d => d !== date);
            } else {
                return [...prev, date];
            }
        });
    };

    const handleConfirmDelete = () => {
        if (selectedScanDates.length === 0) return;

        // Clean up URLs for deleted scans
        selectedScanDates.forEach(date => {
            const state = scanViewerState[date];
            if (state) {
                // Revoke all object URLs for this scan
                state.centerViewerFiles.forEach(file => {
                    if (file.url) URL.revokeObjectURL(file.url);
                });
                const urls = centerViewerUrlsRef.current[date] || [];
                urls.forEach(url => URL.revokeObjectURL(url));
                delete centerViewerUrlsRef.current[date];
            }
            // Clean up GLB URL for this scan
            const glbUrl = glbUrlsRef.current[date];
            if (glbUrl) {
                URL.revokeObjectURL(glbUrl);
                delete glbUrlsRef.current[date];
            }
        });

        // Delete files from DB for deleted scans
        scans.filter(scan => selectedScanDates.includes(scan.date)).forEach(scan => {
            scan.centerViewerFiles?.forEach(sFile => {
                if (sFile.storageId) {
                    deleteFileFromDB(sFile.storageId).catch(err => console.error("Error deleting file from DB:", err));
                }
            });
        });

        // Remove selected scans
        const updatedScans = scans.filter(scan => !selectedScanDates.includes(scan.date));

        // Remove viewer state for deleted scans
        setScanViewerState(prev => {
            const updated = { ...prev };
            selectedScanDates.forEach(date => delete updated[date]);
            return updated;
        });

        // If current scan is being deleted, switch to the latest remaining scan
        if (selectedScanDates.includes(currentScanDate)) {
            if (updatedScans.length > 0) {
                const latestScan = updatedScans.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
                setCurrentScanDate(latestScan.date);
            } else {
                // If all scans are deleted, we'll need to handle this edge case
                // For now, just clear the current date
                setCurrentScanDate('');
            }
        }

        setScans(updatedScans);
        setIsDeleteMode(false);
        setSelectedScanDates([]);

        // Persist the deletion - handled by useEffect
    };

    const handleConfirmAddScan = (newDate: string) => {
        // If date already exists, just select it instead of creating a duplicate
        if (scans.some(s => s.date === newDate)) {
            setCurrentScanDate(newDate);
            setIsAddScanModalOpen(false);
            return;
        }

        const newScan: ScanData = {
            date: newDate,
            modelUrl: undefined,
            pdfUrl: undefined,
            pdfAnnotations: {},
            insights: []
        };

        // Add new scan and sort the array by date to maintain chronological order
        const updatedScans = [...scans, newScan];
        updatedScans.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // Initialize empty viewer state for the new scan
        setScanViewerState(prev => ({
            ...prev,
            [newDate]: EMPTY_SCAN_VIEWER_STATE
        }));

        setScans(updatedScans);
        setCurrentScanDate(newDate);
        setIsAddScanModalOpen(false);

        // Persist for new scan - handled by useEffect
    };

    const projectSummary = useMemo<ProjectSummary>(() => {
        const currentInsights = currentScan?.insights || [];
        const summary: ProjectSummary = {
            projectName: project.name,
            captureDate: currentScanDate,
            totalDeviations: currentInsights.length,
            deviationsBySeverity: {
                [Severity.Critical]: 0,
                [Severity.High]: 0,
                [Severity.Medium]: 0,
                [Severity.Low]: 0,
            },
            deviationsByStatus: {
                [InsightStatus.Open]: 0,
                [InsightStatus.Acknowledged]: 0,
                [InsightStatus.Resolved]: 0,
                [InsightStatus.Muted]: 0,
            }
        };

        currentInsights.forEach(insight => {
            if (insight.severity) summary.deviationsBySeverity[insight.severity]++;
            if (insight.status) summary.deviationsByStatus[insight.status]++;
        });

        return summary;

    }, [currentScan, project.name, currentScanDate]);

    const handleUploadInsights = (newInsights: Insight[]) => {
        setScans(prev => prev.map(scan =>
            scan.date === currentScanDate ? { ...scan, insights: newInsights } : scan
        ));
    };

    const handleAddInsights = (newInsights: Insight[]) => {
        setScans(prev => prev.map(scan =>
            scan.date === currentScanDate ? { ...scan, insights: [...scan.insights, ...newInsights] } : scan
        ));
    };

    const handleInsightStatusChange = (insightId: string, newStatus: InsightStatus) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const newInsights = scan.insights.map(i =>
                    i.id === insightId ? { ...i, status: newStatus } : i
                );
                return { ...scan, insights: newInsights };
            }
            return scan;
        }));
    };

    const handleAddNote = (insightId: string, noteText: string) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const newInsights = scan.insights.map(i => {
                    if (i.id === insightId) {
                        const newNote: Note = {
                            id: `note-${Date.now()}`,
                            text: noteText,
                            author: 'Current User',
                            timestamp: new Date().toISOString()
                        };
                        return { ...i, notes: [...(i.notes || []), newNote] };
                    }
                    return i;
                });
                return { ...scan, insights: newInsights };
            }
            return scan;
        }));
    };

    const handleReassignTrade = (insightId: string, newTrade: string) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const newInsights = scan.insights.map(i =>
                    i.id === insightId ? { ...i, assignedTo: newTrade } : i
                );
                return { ...scan, insights: newInsights };
            }
            return scan;
        }));
    };

    const handleInsightFileDelete = useCallback((insightId: string, fileIndex: number) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const newInsights = scan.insights.map(i => {
                    if (i.id === insightId && i.files) {
                        return { ...i, files: i.files.filter((_, idx) => idx !== fileIndex) };
                    }
                    return i;
                });
                return { ...scan, insights: newInsights };
            }
            return scan;
        }));
    }, [currentScanDate]);

    const handleInsightFileAdd = useCallback((insightId: string, files: File[]) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const newInsights = scan.insights.map(i => {
                    if (i.id === insightId) {
                        const existingFiles = i.files || [];
                        // Filter out duplicates
                        const newFiles = files.filter(file =>
                            !existingFiles.some(existing =>
                                existing.name === file.name && existing.size === file.size
                            )
                        );
                        return { ...i, files: [...existingFiles, ...newFiles] };
                    }
                    return i;
                });
                return { ...scan, insights: newInsights };
            }
            return scan;
        }));
    }, [currentScanDate]);

    const handleModelUpload = (url: string) => {
        if (!currentScanDate) return;

        // Revoke old GLB URL for this scan if it exists
        const oldUrl = glbUrlsRef.current[currentScanDate];
        if (oldUrl && oldUrl !== url) {
            URL.revokeObjectURL(oldUrl);
        }

        // Store new GLB URL
        glbUrlsRef.current[currentScanDate] = url;

        setScans(prev => prev.map(scan =>
            scan.date === currentScanDate ? { ...scan, modelUrl: url } : scan
        ));
    };

    const handlePdfUpload = (url: string) => {
        setScans(prev => prev.map(scan =>
            scan.date === currentScanDate ? { ...scan, pdfUrl: url, pdfAnnotations: {} } : scan
        ));
    };

    const handlePdfAnnotationsChange = (annotations: Record<number, PdfAnnotation[]>) => {
        setScans(prev => prev.map(scan =>
            scan.date === currentScanDate ? { ...scan, pdfAnnotations: annotations } : scan
        ));
    };

    const handleThreeDAnnotationAdd = (annotation: ThreeDAnnotation) => {
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                return {
                    ...scan,
                    threeDAnnotations: [...(scan.threeDAnnotations || []), annotation]
                };
            }
            return scan;
        }));
    };

    const handleThreeDAnnotationSelect = (annotationId: string | null) => {
        if (!annotationId) {
            setHighlightedInsightId(null);
            return;
        }
        // Find the annotation in the current scan to get the linkedInsightId
        const annotation = currentScan?.threeDAnnotations?.find(a => a.id === annotationId);
        if (annotation?.linkedInsightId) {
            setHighlightedInsightId(annotation.linkedInsightId);
        } else {
            setHighlightedInsightId(null);
        }
    };

    const handleThreeDAnnotationDelete = (annotationId: string) => {
        if (!currentScanDate) return;

        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                return {
                    ...scan,
                    threeDAnnotations: (scan.threeDAnnotations || []).filter(a => a.id !== annotationId)
                };
            }
            return scan;
        }));
        setHighlightedInsightId(null); // Clear selection
    };

    // --- Tree Action Handlers ---

    const handleSelectNode = useCallback((node: FileSystemNode) => {
        updateCurrentScanViewerState(state => ({
            ...state,
            selectedNodeId: node.id
        }));
    }, [updateCurrentScanViewerState]);

    const handleToggleExpand = useCallback((node: FileSystemNode) => {
        if (node.type !== 'folder') return;

        updateCurrentScanViewerState(state => ({
            ...state,
            fileSystemTree: updateNodeInTree(state.fileSystemTree, node.id, { expanded: !node.expanded })
        }));
    }, [updateCurrentScanViewerState]);

    const handleOpenFile = useCallback((node: FileSystemNode) => {
        if (node.type !== 'file' || !node.file) return;

        // Skip macOS resource fork files
        if (node.name.startsWith('._')) {
            console.warn('Skipping macOS resource fork file:', node.name);
            return;
        }

        updateCurrentScanViewerState(state => {
            const allNodes = flattenTree(state.fileSystemTree);
            const fileNodes = allNodes.filter(n => n.type === 'file');
            const fileIndex = fileNodes.findIndex(n => n.id === node.id);

            // Ensure the file has a URL in centerViewerFiles
            let updatedFiles = [...state.centerViewerFiles];
            const existingIndex = updatedFiles.findIndex(f =>
                f.file === node.file ||
                (f.name === node.name && f.file.size === node.file.size)
            );

            if (existingIndex >= 0) {
                // File exists, ensure it has a URL
                const existingFile = updatedFiles[existingIndex];
                if (!existingFile.url) {
                    const url = URL.createObjectURL(node.file);
                    centerViewerUrlsRef.current[currentScanDate] = centerViewerUrlsRef.current[currentScanDate] || [];
                    centerViewerUrlsRef.current[currentScanDate].push(url);
                    updatedFiles[existingIndex] = { ...existingFile, url };
                }
            } else {
                // File not in centerViewerFiles, add it with URL
                const url = URL.createObjectURL(node.file);
                centerViewerUrlsRef.current[currentScanDate] = centerViewerUrlsRef.current[currentScanDate] || [];
                centerViewerUrlsRef.current[currentScanDate].push(url);
                updatedFiles.push({
                    name: node.name,
                    url,
                    file: node.file
                });
            }

            return {
                ...state,
                centerViewerFiles: updatedFiles,
                openedFileId: node.id,
                selectedNodeId: node.id,
                selectedFileIndex: fileIndex >= 0 ? fileIndex : 0
            };
        });
    }, [updateCurrentScanViewerState, currentScanDate]);

    const handleRenameNode = useCallback((node: FileSystemNode, newName: string) => {
        updateCurrentScanViewerState(state => {
            const newTree = renameNode(state.fileSystemTree, node.id, newName);

            // Also need to update the persistence (Project/Scan data)
            // This is tricky because we need to map back to centerViewerFiles
            // For now, we just update state and rely on saveProject to trigger later

            // Update scan state for persistence
            const allNodes = flattenTree(newTree);
            const filesOnly = allNodes.filter(n => n.type === 'file' && n.file);

            // We need to update the file object's path if we can (read-only) or just tracking
            // In persistence we save `path`

            // Trigger persistence update
            setTimeout(() => {
                setScans(prev => prev.map(scan => {
                    if (scan.date === currentScanDate) {
                        return {
                            ...scan,
                            centerViewerFiles: filesOnly.map(n => ({
                                name: n.name, // Filename might be different from node name if renamed? No, node.name is filename
                                type: n.file?.type || 'application/octet-stream',
                                size: n.file?.size || 0,
                                path: n.path,
                                // storageId needs to be preserved... tricky
                                // We probably need to keep map of original file to storageId
                            }))
                        };
                    }
                    return scan;
                }));
            }, 0);

            return {
                ...state,
                fileSystemTree: newTree
            };
          });
      }, [currentScanDate, updateCurrentScanViewerState]);

    // Persistence helpers (defined early to avoid temporal dead zone)
    const saveTreeToScans = useCallback(async (tree: FileSystemNode[]) => {
        if (!currentScanDate) return;

        const allNodes = flattenTree(tree);
        const fileNodes = allNodes.filter(n => n.type === 'file' && n.file);

        const serializableFiles = await Promise.all(fileNodes.map(n => {
            if (!n.file) throw new Error("Node missing file");
            return fileToSerializable(n.file, n.path);
        }));

        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                return {
                    ...scan,
                    centerViewerFiles: serializableFiles
                };
            }
            return scan;
        }));
    }, [currentScanDate]);

    const updatePersistenceFromTree = useCallback(() => {
        if (!currentScanDate) return;

        setScanViewerState(prevState => {
            const state = prevState[currentScanDate];
            if (!state) return prevState;

            // Trigger async save
            saveTreeToScans(state.fileSystemTree);

            return prevState;
        });
    }, [currentScanDate, saveTreeToScans]);
  
      const handleDeleteNode = useCallback((node: FileSystemNode) => {
        updateCurrentScanViewerState(state => {
            const newTree = removeNodeFromTree(state.fileSystemTree, node.id);

            // If deleted node was selected or opened, reset selection
            const wasSelected = state.selectedNodeId === node.id || (node.type === 'folder' && findNodeById([node], state.selectedNodeId || ''));
            const wasOpened = state.openedFileId === node.id || (node.type === 'folder' && findNodeById([node], state.openedFileId || ''));

            return {
                ...state,
                fileSystemTree: newTree,
                selectedNodeId: wasSelected ? null : state.selectedNodeId,
                openedFileId: wasOpened ? null : state.openedFileId
            };
        });

        // Update persistence
        setScans(prev => prev.map(scan => {
            if (scan.date === currentScanDate) {
                const nodesToDelete = flattenTree([node]);
                const fileNodesToDelete = nodesToDelete.filter(n => n.type === 'file' && n.file);

                // We need to remove these from centerViewerFiles in scan
                // But we don't have direct mapping here easily without ID map
                // Simpler: rebuild centerViewerFiles from the NEW tree

                // But we need to actually delete from DB to clean up storage
                // This part is missing: we need storageIds

                // Reconstruct valid files list from state (pre-update) is hard because we are in setScans callback
                // Better to rely on the updateCurrentScanViewerState to have updated the tree, 
                // then we read the NEW tree to save.

                // Let's do a second pass for persistence after state update
                setTimeout(() => {
                    updatePersistenceFromTree();
                }, 0);

                return scan;
            }
            return scan;
        }));
    }, [currentScanDate, updateCurrentScanViewerState, updatePersistenceFromTree]);

    const handleMoveNode = useCallback((nodeId: string, targetParentId: string | undefined) => {
        updateCurrentScanViewerState(state => ({
            ...state,
            fileSystemTree: moveNode(state.fileSystemTree, nodeId, targetParentId)
        }));

        setTimeout(() => {
            updatePersistenceFromTree();
        }, 0);
    }, [updateCurrentScanViewerState, updatePersistenceFromTree]);

    const handleCreateFolder = useCallback((parentId?: string) => {
        const newFolder: FileSystemNode = {
            id: `folder-${Date.now()}`,
            name: 'New Folder',
            type: 'folder',
            path: 'New Folder', // Will be updated by addNodeToTree logic implicitly? No
            children: [],
            expanded: false,
            parentId
        };

        // We need correct path
        updateCurrentScanViewerState(state => {
            let parentPath = '';
            if (parentId) {
                const parent = findNodeById(state.fileSystemTree, parentId);
                if (parent) parentPath = parent.path;
            }
            newFolder.path = parentPath ? `${parentPath}/${newFolder.name}` : newFolder.name;

            const newTree = addNodeToTree(state.fileSystemTree, newFolder, parentId);
            return {
                ...state,
                fileSystemTree: newTree,
                selectedNodeId: newFolder.id // Select the new folder
            };
        });

        setTimeout(() => {
            updatePersistenceFromTree();
        }, 0);
    }, [updateCurrentScanViewerState]);

    // --- Specific Upload Handlers ---

    const ensureFolderExists = (tree: FileSystemNode[], folderName: string, parentId?: string): { tree: FileSystemNode[], folderId: string } => {
        let currentTree = [...tree];
        
        // Try to find existing folder
        // We need to search in the correct scope (root or children of parentId)
        let existingFolder: FileSystemNode | undefined;
        
        if (parentId) {
            const parent = findNodeById(currentTree, parentId);
            if (parent && parent.children) {
                existingFolder = parent.children.find(n => n.name === folderName && n.type === 'folder');
            }
        } else {
            existingFolder = currentTree.find(n => n.name === folderName && n.type === 'folder');
        }

        if (existingFolder) {
            return { tree: currentTree, folderId: existingFolder.id };
        }

        // Create new folder
        const newFolderId = `folder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const newFolder: FileSystemNode = {
            id: newFolderId,
            name: folderName,
            type: 'folder',
            path: folderName, // Will be fixed by updatePaths if needed, or we calculate it here
            children: [],
            expanded: true,
            parentId
        };

        // Calculate path
        if (parentId) {
             const parent = findNodeById(currentTree, parentId);
             if (parent) {
                 newFolder.path = `${parent.path}/${folderName}`;
             }
        }

        currentTree = addNodeToTree(currentTree, newFolder, parentId);
        return { tree: currentTree, folderId: newFolderId };
    };

    const handleUploadToScanFolder = useCallback((files: File[], folderPath: string[]) => {
        if (!currentScanDate || !files.length) return;

        updateCurrentScanViewerState(state => {
            let tree = [...state.fileSystemTree];
            let currentParentId: string | undefined = undefined;

            // Create folder structure
            folderPath.forEach(folderName => {
                const result = ensureFolderExists(tree, folderName, currentParentId);
                tree = result.tree;
                currentParentId = result.folderId;
            });

            // Add files to the deepest folder
            const newNodes = buildTreeFromFiles(files);
            
            // Calculate parent path prefix
            let parentPath = '';
            if (currentParentId) {
                const parent = findNodeById(tree, currentParentId);
                if (parent) parentPath = parent.path;
            }

            newNodes.forEach(node => {
                 const updatePath = (n: FileSystemNode, prefix: string): FileSystemNode => {
                      const p = prefix ? `${prefix}/${n.name}` : n.name;
                      return { ...n, path: p, children: n.children?.map(c => updatePath(c, p)) };
                 };
                 const updatedNode = updatePath(node, parentPath);
                 tree = addNodeToTree(tree, updatedNode, currentParentId);
            });

            return {
                ...state,
                fileSystemTree: tree
            };
        });

        setTimeout(() => {
            updatePersistenceFromTree();
        }, 0);
    }, [currentScanDate, updateCurrentScanViewerState, updatePersistenceFromTree]);

    const handleUploadProjectMaster = useCallback((files: File[]) => {
        handleUploadToScanFolder(files, ['Project Master']);
    }, [handleUploadToScanFolder]);

    const handleUploadModel = useCallback((files: File[]) => {
        handleUploadToScanFolder(files, ['Models']);
    }, [handleUploadToScanFolder]);

    const handleUploadDeviation = useCallback((file: File) => {
        handleUploadToScanFolder([file], ['3DR Reports', 'Deviation']);
    }, [handleUploadToScanFolder]);

    const handleUploadClash = useCallback((file: File) => {
        handleUploadToScanFolder([file], ['3DR Reports', 'Clash']);
    }, [handleUploadToScanFolder]);

    const handleUploadProgress = useCallback((file: File) => {
        handleUploadToScanFolder([file], ['3DR Reports', 'Progress']);
    }, [handleUploadToScanFolder]);

    // Center viewer file management handlers
    const handleCenterViewerAddFile = useCallback(async (files: File[]) => {
        if (!files || files.length === 0 || !currentScanDate) return;

        // Filter out macOS metadata files and other system files
        const validFiles = files.filter(file => {
            const name = file.name;
            // Skip macOS metadata files (._*), .DS_Store, Thumbs.db, etc.
            if (name.startsWith('._')) return false;
            if (name === '.DS_Store' || name === 'Thumbs.db') return false;
            if (name.startsWith('~$')) return false; // Office temp files
            return true;
        });

        if (validFiles.length === 0) return;

        try {
            // Initialize URLs array for this scan if it doesn't exist
            if (!centerViewerUrlsRef.current[currentScanDate]) {
                centerViewerUrlsRef.current[currentScanDate] = [];
            }

            let glbUrl: string | undefined;

            const newFileData = validFiles.map(file => {
                if (!file || !(file instanceof File)) {
                    throw new Error('Invalid file object');
                }
                const url = URL.createObjectURL(file);
                centerViewerUrlsRef.current[currentScanDate].push(url);

                if (getFileType(file) === 'glb') {
                    glbUrl = url;
                }

                return { name: file.name, url, file };
            });

            if (glbUrl) {
                const oldUrl = glbUrlsRef.current[currentScanDate];
                if (oldUrl && oldUrl !== glbUrl) {
                    URL.revokeObjectURL(oldUrl);
                }
                glbUrlsRef.current[currentScanDate] = glbUrl;
                // We will update scans modelUrl below
            }

            updateCurrentScanViewerState(state => {
                const currentTree = state.fileSystemTree;
                const newTreeNodes = buildTreeFromFiles(validFiles);

                // Merge new nodes into existing tree
                let mergedTree = [...currentTree];
                newTreeNodes.forEach(node => {
                    mergedTree = addNodeToTree(mergedTree, node, undefined);
                });

                // Flatten for legacy support
                const allNodes = flattenTree(mergedTree);
                const allFiles = allNodes.filter(n => n.type === 'file' && n.file).map(n => {
                    // We need to find the URL for this file
                    // Since we just added it, we can find it in newFileData
                    // Or existing files
                    const match = newFileData.find(f => f.name === n.name && f.file.size === n.file?.size) ||
                        state.centerViewerFiles.find(f => f.name === n.name && f.file.size === n.file?.size);

                    if (match) return match;
                    // Fallback creating url
                    const url = URL.createObjectURL(n.file!);
                    centerViewerUrlsRef.current[currentScanDate].push(url);
                    return { name: n.name, url, file: n.file! };
                });

                return {
                    ...state,
                    fileSystemTree: mergedTree,
                    centerViewerFiles: allFiles,
                    selectedFileIndex: state.selectedFileIndex // Keep selection
                };
            });

            // Persist files
            // We need to save the updated tree structure
            // Access the updated state in next tick or pass it
            setTimeout(() => {
                setScanViewerState(prev => {
                    const state = prev[currentScanDate];
                    if (state) {
                        saveTreeToScans(state.fileSystemTree);
                    }
                    return prev;
                });
            }, 100);

        } catch (error) {
            console.error('Error adding files:', error);
            // Don't crash the app, just log the error
        }
    }, [currentScanDate, updateCurrentScanViewerState]);

    const handleCenterViewerDeleteFile = useCallback((index: number) => {
        // Legacy delete handler - mapped to node delete if possible
        // or just remove from flat list and rebuild tree? 
        // Better to use handleDeleteNode directly for tree view
        // But for compatibility if called from other places:

        if (!currentScanDate) return;

        updateCurrentScanViewerState(state => {
            const fileToDelete = state.centerViewerFiles[index];
            if (!fileToDelete) return state;

            // Find node for this file
            const allNodes = flattenTree(state.fileSystemTree);
            const nodeToDelete = allNodes.find(n => n.type === 'file' && n.file === fileToDelete.file);

            if (nodeToDelete) {
                // Reuse tree delete logic
                const newTree = removeNodeFromTree(state.fileSystemTree, nodeToDelete.id);

                // Clean up URLs
                if (fileToDelete.url) {
                    URL.revokeObjectURL(fileToDelete.url);
                }

                const newFiles = state.centerViewerFiles.filter((_, i) => i !== index);

                return {
                    ...state,
                    fileSystemTree: newTree,
                    centerViewerFiles: newFiles,
                    selectedFileIndex: Math.min(state.selectedFileIndex, newFiles.length - 1)
                };
            }

            return state;
        });

        // Trigger persistence update
        setTimeout(() => {
            setScanViewerState(prev => {
                const state = prev[currentScanDate];
                if (state) {
                    saveTreeToScans(state.fileSystemTree);
                }
                return prev;
            });
        }, 100);

    }, [currentScanDate, updateCurrentScanViewerState]);

    const handleCenterViewerFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const selectedFiles = Array.from(e.target.files) as File[];
            handleCenterViewerAddFile(selectedFiles);
            if (centerViewerFileInputRef.current) {
                centerViewerFileInputRef.current.value = '';
            }
        }
    };

    // Handler for PDF upload in center viewer (when user changes PDF via PdfViewer)
    const handleCenterViewerPdfUpload = useCallback((url: string) => {
        if (!currentScanDate) return;

        updateCurrentScanViewerState(state => {
            const validIndex = state.centerViewerFiles.length > 0 ? Math.min(state.selectedFileIndex, state.centerViewerFiles.length - 1) : -1;
            if (validIndex < 0) return state;

            return {
                ...state,
                centerViewerFiles: state.centerViewerFiles.map((file, index) =>
                    index === validIndex ? { ...file, url } : file
                )
            };
        });
    }, [currentScanDate, updateCurrentScanViewerState]);

    // Handler for PDF annotation changes in center viewer
    const handleCenterViewerPdfAnnotationsChange = useCallback((annotations: Record<number, PdfAnnotation[]>) => {
        if (!currentScanDate) return;

        updateCurrentScanViewerState(state => {
            const validIndex = state.centerViewerFiles.length > 0 ? Math.min(state.selectedFileIndex, state.centerViewerFiles.length - 1) : -1;
            if (validIndex >= 0 && state.centerViewerFiles[validIndex]) {
                const fileId = getFileIdentifier(state.centerViewerFiles[validIndex].file);
                return {
                    ...state,
                    pdfAnnotations: {
                        ...state.pdfAnnotations,
                        [fileId]: annotations
                    }
                };
            }
            return state;
        });
    }, [currentScanDate, updateCurrentScanViewerState]);

    // Handler for PDF annotation groups change in center viewer
    const handleCenterViewerPdfAnnotationGroupsChange = useCallback((groups: AnnotationGroup[]) => {
        if (!currentScanDate) return;

        updateCurrentScanViewerState(state => {
            const validIndex = state.centerViewerFiles.length > 0 ? Math.min(state.selectedFileIndex, state.centerViewerFiles.length - 1) : -1;
            if (validIndex >= 0 && state.centerViewerFiles[validIndex]) {
                const fileId = getFileIdentifier(state.centerViewerFiles[validIndex].file);
                const newState = {
                    ...state,
                    pdfAnnotationGroups: {
                        ...state.pdfAnnotationGroups,
                        [fileId]: groups
                    }
                };

                // Generate/update the 2-pager brief PDF if we have groups
                if (groups.length > 0) {
                    generateBriefPdf(groups, fileId, newState);
                }

                return newState;
            }
            return state;
        });
    }, [currentScanDate, updateCurrentScanViewerState]);

    // Generate the 2-Pager Brief PDF from annotation groups
    const generateBriefPdf = useCallback(async (groups: AnnotationGroup[], sourceFileId: string, state: ScanViewerState) => {
        if (!currentScanDate) return;

        try {
            const jsPDF = (await import('jspdf')).default;
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 14;
            const contentWidth = pageWidth - (margin * 2);

            // Header
            doc.setFillColor(31, 41, 55); // gray-800
            doc.rect(0, 0, pageWidth, 25, 'F');
            doc.setFontSize(16);
            doc.setTextColor(255, 255, 255);
            doc.text('2-Pager Brief: Maestro Construction Data', pageWidth / 2, 12, { align: 'center' });
            doc.setFontSize(10);
            doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 20, { align: 'center' });

            let yPos = margin + 30;
            let currentPage = 1;
            const maxY = pageHeight - margin - 20;

            // Add each annotation group (using for loop for async/await)
            for (let index = 0; index < groups.length; index++) {
                const group = groups[index];

                // Check if we need a new page
                if (yPos > maxY - 80) {
                    doc.addPage();
                    currentPage++;
                    yPos = margin + 10;
                }

                // Group header
                doc.setFontSize(12);
                doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'bold');
                doc.text(`Annotation ${index + 1} - Page ${group.pageNumber}`, margin, yPos);
                yPos += 8;

                // Load and add snapshot image
                if (group.snapshotDataUrl) {
                    try {
                        const img = new Image();
                        img.src = group.snapshotDataUrl;

                        await new Promise<void>((resolve, reject) => {
                            img.onload = () => {
                                try {
                                    // Calculate dimensions to fit in content width
                                    const maxImgWidth = contentWidth;
                                    const maxImgHeight = 60;
                                    let imgWidth = img.width;
                                    let imgHeight = img.height;

                                    // Scale to fit
                                    const scale = Math.min(maxImgWidth / imgWidth, maxImgHeight / imgHeight);
                                    imgWidth *= scale;
                                    imgHeight *= scale;

                                    // Check if image fits on current page
                                    if (yPos + imgHeight > maxY) {
                                        doc.addPage();
                                        currentPage++;
                                        yPos = margin + 10;
                                    }

                                    doc.addImage(group.snapshotDataUrl, 'PNG', margin, yPos, imgWidth, imgHeight);
                                    yPos += imgHeight + 5;
                                    resolve();
                                } catch (error) {
                                    reject(error);
                                }
                            };
                            img.onerror = reject;
                        });
                    } catch (error) {
                        console.error('Error adding image to PDF:', error);
                        doc.setFontSize(10);
                        doc.setTextColor(150, 150, 150);
                        doc.text('[Image could not be loaded]', margin, yPos);
                        yPos += 10;
                    }
                }

                // Add text description
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'normal');
                const textLines = doc.splitTextToSize(group.text || '[No description]', contentWidth);

                // Check if text fits on current page
                const textHeight = textLines.length * 5;
                if (yPos + textHeight > maxY) {
                    doc.addPage();
                    currentPage++;
                    yPos = margin + 10;
                }

                doc.text(textLines, margin, yPos);
                yPos += textHeight + 10;

                // Add separator line
                if (index < groups.length - 1) {
                    doc.setDrawColor(200, 200, 200);
                    doc.line(margin, yPos, pageWidth - margin, yPos);
                    yPos += 5;
                }
            }

            // Add page numbers
            for (let i = 1; i <= currentPage; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.setTextColor(150, 150, 150);
                doc.text(`Page ${i} of ${currentPage}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
            }

            // Convert PDF to blob and create File object
            const pdfBlob = doc.output('blob');
            const pdfFile = new File([pdfBlob], '2-Pager Brief_ Maestro Construction Data.pdf', { type: 'application/pdf' });
            const pdfUrl = URL.createObjectURL(pdfFile);

            // Add URL to ref for cleanup
            if (!centerViewerUrlsRef.current[currentScanDate]) {
                centerViewerUrlsRef.current[currentScanDate] = [];
            }
            centerViewerUrlsRef.current[currentScanDate].push(pdfUrl);

            // Serialize for persistence
            let serializableBriefFile: SerializableFile | undefined;
            try {
                serializableBriefFile = await fileToSerializable(pdfFile);
            } catch (e) {
                console.error("Failed to serialize brief file for persistence", e);
            }

            // Update state with brief file
            updateCurrentScanViewerState(currentState => {
                // Check if brief file already exists
                if (currentState.briefFileIndex !== null && currentState.briefFileIndex < currentState.centerViewerFiles.length) {
                    // Update existing brief file
                    const existingUrl = currentState.centerViewerFiles[currentState.briefFileIndex].url;
                    if (existingUrl) {
                        URL.revokeObjectURL(existingUrl);
                    }

                    return {
                        ...currentState,
                        centerViewerFiles: currentState.centerViewerFiles.map((file, index) =>
                            index === currentState.briefFileIndex
                                ? { ...file, url: pdfUrl, file: pdfFile }
                                : file
                        )
                    };
                } else {
                    // Create new brief file entry
                    const newFileData = { name: pdfFile.name, url: pdfUrl, file: pdfFile };
                    return {
                        ...currentState,
                        centerViewerFiles: [...currentState.centerViewerFiles, newFileData],
                        briefFileIndex: currentState.centerViewerFiles.length
                    };
                }
            });

            // Update persistence
            if (serializableBriefFile) {
                setScans(prev => prev.map(scan => {
                    if (scan.date === currentScanDate) {
                        const currentState = scanViewerState[currentScanDate];
                        const currentFiles = scan.centerViewerFiles || [];
                        let newFiles = [...currentFiles];

                        // Try to match brief file logic with state
                        if (currentState && currentState.briefFileIndex !== null && currentState.briefFileIndex < newFiles.length) {
                            // Replace existing
                            newFiles[currentState.briefFileIndex] = serializableBriefFile;
                        } else {
                            // Append
                            newFiles.push(serializableBriefFile);
                        }

                        return {
                            ...scan,
                            centerViewerFiles: newFiles
                        };
                    }
                    return scan;
                }));
            }

        } catch (error) {
            console.error('Error generating brief PDF:', error);
        }
    }, [currentScanDate, updateCurrentScanViewerState, scanViewerState]);

    // Ensure selectedFileIndex stays within bounds when files change
    useEffect(() => {
        const state = currentScanViewerState;
        if (state.centerViewerFiles.length === 0) {
            if (state.selectedFileIndex !== 0) {
                updateCurrentScanViewerState(s => ({ ...s, selectedFileIndex: 0 }));
            }
        } else if (state.selectedFileIndex >= state.centerViewerFiles.length) {
            const newIndex = Math.max(0, state.centerViewerFiles.length - 1);
            if (state.selectedFileIndex !== newIndex) {
                updateCurrentScanViewerState(s => ({ ...s, selectedFileIndex: newIndex }));
            }
        }
    }, [currentScanViewerState, updateCurrentScanViewerState]);

    // Load CSV data when CSV file is selected in center viewer
    // Ensure selectedFileIndex is always valid - memoize to avoid reference errors
    const validSelectedIndex = useMemo(() => {
        const state = currentScanViewerState;
        return state.centerViewerFiles.length > 0
            ? Math.min(state.selectedFileIndex, state.centerViewerFiles.length - 1)
            : -1;
    }, [currentScanViewerState]);

    const selectedCenterFile = useMemo(() => {
        const state = currentScanViewerState;

        if (state.openedFileId) {
            const allNodes = flattenTree(state.fileSystemTree);
            const node = allNodes.find(n => n.id === state.openedFileId);
            if (node && node.file) {
                // Find in centerViewerFiles with robust matching
                const match = state.centerViewerFiles.find(f =>
                    f.file === node.file ||
                    (f.name === node.name && f.file.size === node.file?.size && f.file.type === node.file?.type)
                );
                if (match && match.url) return match;
            }
        }

        // Fallback to index-based selection
        return validSelectedIndex >= 0 ? state.centerViewerFiles[validSelectedIndex] : undefined;
    }, [currentScanViewerState, validSelectedIndex]);

    const centerFileType = useMemo(() => {
        return selectedCenterFile ? getFileType(selectedCenterFile.file) : 'other';
    }, [selectedCenterFile]);

    useEffect(() => {
        if (centerFileType === 'csv' && selectedCenterFile) {
            updateCurrentScanViewerState(state => ({ ...state, csvLoading: true, csvError: null }));
            selectedCenterFile.file.text()
                .then(text => {
                    try {
                        const parsed = parseCsv(text);
                        updateCurrentScanViewerState(state => ({ ...state, csvData: parsed, csvLoading: false }));
                    } catch (error) {
                        updateCurrentScanViewerState(state => ({ ...state, csvError: 'Failed to parse CSV file', csvLoading: false }));
                        console.error('CSV parsing error:', error);
                    }
                })
                .catch(error => {
                    updateCurrentScanViewerState(state => ({ ...state, csvError: 'Failed to read CSV file', csvLoading: false }));
                    console.error('CSV read error:', error);
                });
        } else {
            updateCurrentScanViewerState(state => ({ ...state, csvData: null, csvError: null }));
        }
    }, [centerFileType, selectedCenterFile, updateCurrentScanViewerState]);

    // Cleanup URLs on unmount
    useEffect(() => {
        return () => {
            (Object.values(centerViewerUrlsRef.current) as string[][]).forEach(urls => {
                urls.forEach(url => URL.revokeObjectURL(url));
            });
            // Cleanup GLB URLs
            (Object.values(glbUrlsRef.current) as string[]).forEach(url => {
                URL.revokeObjectURL(url);
            });
        };
    }, []);

    // Clear toolbar handlers when PDF is not loaded or file changes
    useEffect(() => {
        if (centerFileType !== 'pdf' || !selectedCenterFile) {
            setPdfToolbarHandlers(null);
        }
    }, [centerFileType, selectedCenterFile]);

    // Annotations Panel State
    const [fileAnnotations, setFileAnnotations] = useState<Annotation[]>([]);
    const [isAnnotationsPanelCollapsed, setIsAnnotationsPanelCollapsed] = useState(false);
    const [annotationsPanelHeight, setAnnotationsPanelHeight] = useState(300);
    const [isAddingAnnotation, setIsAddingAnnotation] = useState(false);
    const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<string>>(new Set());
    const [pendingRectangleId, setPendingRectangleId] = useState<string | null>(null);
    const [addingRectangleToAnnotationId, setAddingRectangleToAnnotationId] = useState<string | null>(null);

    const handleAddAnnotation = (title: string, description: string) => {
        if (!selectedCenterFile) return;
        // Use logic similar to getFileIdentifier or just use name/storageId as stable ID
        const fileId = selectedCenterFile.storageId || selectedCenterFile.name;
        
        const newAnnotation: Annotation = {
            id: Math.random().toString(36).substr(2, 9),
            fileId: fileId,
            title,
            description,
            linkedRectangleId: pendingRectangleId || undefined
        };
        setFileAnnotations(prev => [...prev, newAnnotation]);
        
        // If there's a pending rectangle, update it with the annotation ID
        if (pendingRectangleId && currentScanDate) {
            const pdfFileId = getFileIdentifier(selectedCenterFile.file);
            updateCurrentScanViewerState(state => {
                const currentPdfAnnotations = state.pdfAnnotations[pdfFileId] || {};
                const updatedPdfAnnotations: Record<number, PdfAnnotation[]> = {};
                
                // Update the rectangle with the linkedAnnotationId
                Object.entries(currentPdfAnnotations).forEach(([pageStr, pageAnnotations]) => {
                    const pageNum = parseInt(pageStr, 10);
                    updatedPdfAnnotations[pageNum] = (pageAnnotations as PdfAnnotation[]).map(annotation => {
                        if (annotation.kind === 'rectangle' && annotation.id === pendingRectangleId) {
                            return { ...annotation, linkedAnnotationId: newAnnotation.id };
                        }
                        return annotation;
                    });
                });
                
                return {
                    ...state,
                    pdfAnnotations: {
                        ...state.pdfAnnotations,
                        [pdfFileId]: updatedPdfAnnotations
                    }
                };
            });
        }
        
        setPendingRectangleId(null);
    };

    const handleEditAnnotation = (id: string, title: string, description: string) => {
        setFileAnnotations(prev => prev.map(a => a.id === id ? { ...a, title, description } : a));
    };

    const handleAddRectangleToAnnotation = (annotationId: string) => {
        setAddingRectangleToAnnotationId(annotationId);
        // Switch to rectangle tool
        pdfToolbarHandlers?.onToolChange('rectangle');
        // Open PDF tools panel
        setIsPdfToolsOpen(true);
    };

    const handleDeleteAnnotation = (id: string) => {
        // Find the annotation to get its linkedRectangleId and linkedRectangleIds
        const annotation = fileAnnotations.find(a => a.id === id);
        
        setFileAnnotations(prev => prev.filter(a => a.id !== id));
        
        // Collect all rectangle IDs to remove (both single and array)
        const rectangleIdsToRemove: string[] = [];
        if (annotation?.linkedRectangleId) {
            rectangleIdsToRemove.push(annotation.linkedRectangleId);
        }
        if (annotation?.linkedRectangleIds) {
            rectangleIdsToRemove.push(...annotation.linkedRectangleIds);
        }
        
        // If the annotation had linked rectangles, remove them from PDF annotations
        if (rectangleIdsToRemove.length > 0 && selectedCenterFile && currentScanDate) {
            const pdfFileId = getFileIdentifier(selectedCenterFile.file);
            updateCurrentScanViewerState(state => {
                const currentPdfAnnotations = state.pdfAnnotations[pdfFileId] || {};
                const updatedPdfAnnotations: Record<number, PdfAnnotation[]> = {};
                
                // Remove all associated rectangles from all pages
                Object.entries(currentPdfAnnotations).forEach(([pageStr, pageAnnotations]) => {
                    const pageNum = parseInt(pageStr, 10);
                    updatedPdfAnnotations[pageNum] = (pageAnnotations as PdfAnnotation[]).filter(
                        ann => !(ann.kind === 'rectangle' && rectangleIdsToRemove.includes(ann.id))
                    );
                });
                
                return {
                    ...state,
                    pdfAnnotations: {
                        ...state.pdfAnnotations,
                        [pdfFileId]: updatedPdfAnnotations
                    }
                };
            });
        }
    };

    // Filter annotations for current file
    const currentFileId = selectedCenterFile?.storageId || selectedCenterFile?.name;
    const currentFileAnnotations = useMemo(() => {
        if (!currentFileId) return [];
        return fileAnnotations.filter(a => a.fileId === currentFileId);
    }, [fileAnnotations, currentFileId]);
    
    // Compute visible rectangle IDs based on selected annotations
    const visibleRectangleIds = useMemo(() => {
        if (selectedAnnotationIds.size === 0) {
            // No annotations selected - show all rectangles (default behavior)
            return undefined;
        }
        
        // Only show rectangles linked to selected annotations
        const rectangleIds = new Set<string>();
        currentFileAnnotations.forEach(annotation => {
            if (selectedAnnotationIds.has(annotation.id)) {
                // Add the primary linked rectangle
                if (annotation.linkedRectangleId) {
                    rectangleIds.add(annotation.linkedRectangleId);
                }
                // Add all additional linked rectangles
                if (annotation.linkedRectangleIds) {
                    annotation.linkedRectangleIds.forEach(id => rectangleIds.add(id));
                }
            }
        });
        
        return rectangleIds;
    }, [selectedAnnotationIds, currentFileAnnotations]);

    // Render center viewer content based on file type
    const renderCenterViewerContent = () => {
        // If GLB mode is active, show the GLB viewer for the current scan
        if (isGlbActive) {
            return (
                <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden">
                    <Viewer
                        modelUrl={currentScan?.modelUrl}
                        onModelUpload={handleModelUpload}
                        annotations={currentScan?.threeDAnnotations}
                        onAnnotationAdd={handleThreeDAnnotationAdd}
                        insights={currentScan?.insights}
                        onAnnotationSelect={handleThreeDAnnotationSelect}
                        onAnnotationDelete={handleThreeDAnnotationDelete}
                    />
                </div>
            );
        }

        if (!selectedCenterFile) {
            return (
                <div className="flex-1 flex items-center justify-center bg-gray-900">
                    <div className="text-center p-8">
                        <DocumentIcon className="mx-auto h-12 w-12 text-gray-600" />
                        <h2 className="mt-4 text-xl font-semibold text-gray-400">Construction Plan Viewer</h2>
                        <p className="mt-1 text-sm text-gray-500">Upload files to get started.</p>
                        <button
                            onClick={() => centerViewerFileInputRef.current?.click()}
                            className="mt-6 px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors"
                        >
                            Upload Files
                        </button>
                    </div>
                </div>
            );
        }

        switch (centerFileType) {
            case 'pdf':
                const fileId = selectedCenterFile ? getFileIdentifier(selectedCenterFile.file) : '';
                const currentAnnotations = fileId ? (currentScanViewerState.pdfAnnotations[fileId] || {}) : {};
                const currentGroups = fileId ? (currentScanViewerState.pdfAnnotationGroups[fileId] || []) : [];
                return (
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                        {/* Banner for adding multiple rectangles */}
                        {addingRectangleToAnnotationId && (
                            <div className="bg-cyan-600 border-b border-cyan-700 px-4 py-3 flex items-center justify-between shadow-lg">
                                <div className="flex items-center gap-3">
                                    <RectangleIcon className="w-5 h-5 text-white" />
                                    <div className="flex flex-col">
                                        <span className="text-white font-semibold text-sm">
                                            Adding rectangles to: {currentFileAnnotations.find(a => a.id === addingRectangleToAnnotationId)?.title || 'Annotation'}
                                        </span>
                                        <span className="text-cyan-100 text-xs">
                                            Draw rectangles on the PDF. Click Done when finished.
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setAddingRectangleToAnnotationId(null)}
                                    className="px-4 py-2 bg-white text-cyan-700 font-semibold rounded-md hover:bg-cyan-50 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-cyan-600 transition-colors"
                                >
                                    Done
                                </button>
                            </div>
                        )}
                        <div className="flex-1 min-h-0 relative flex flex-col">
                            <PdfViewer
                                pdfUrl={selectedCenterFile.url}
                                onPdfUpload={handleCenterViewerPdfUpload}
                                annotations={currentAnnotations}
                                onAnnotationsChange={handleCenterViewerPdfAnnotationsChange}
                                annotationGroups={currentGroups}
                                onAnnotationGroupsChange={handleCenterViewerPdfAnnotationGroupsChange}
                                isToolsOpen={isPdfToolsOpen}
                                onToolsOpenChange={setIsPdfToolsOpen}
                                renderToolbarExternally={true}
                                onToolbarHandlersReady={setPdfToolbarHandlers}
                                toolbarRef={toolbarRef}
                                onRectangleCreated={(rectangleId) => {
                                    if (addingRectangleToAnnotationId) {
                                        // Adding rectangle to existing annotation
                                        setFileAnnotations(prev => prev.map(annotation => {
                                            if (annotation.id === addingRectangleToAnnotationId) {
                                                // Add to linkedRectangleIds array
                                                const existingIds = annotation.linkedRectangleIds || [];
                                                return {
                                                    ...annotation,
                                                    linkedRectangleIds: [...existingIds, rectangleId]
                                                };
                                            }
                                            return annotation;
                                        }));
                                        
                                        // Update the PDF annotation to link back to the annotation
                                        if (selectedCenterFile && currentScanDate) {
                                            const pdfFileId = getFileIdentifier(selectedCenterFile.file);
                                            updateCurrentScanViewerState(state => {
                                                const currentPdfAnnotations = state.pdfAnnotations[pdfFileId] || {};
                                                const updatedPdfAnnotations: Record<number, PdfAnnotation[]> = {};
                                                
                                                // Update the rectangle with the linkedAnnotationId
                                                Object.entries(currentPdfAnnotations).forEach(([pageStr, pageAnnotations]) => {
                                                    const pageNum = parseInt(pageStr, 10);
                                                    updatedPdfAnnotations[pageNum] = (pageAnnotations as PdfAnnotation[]).map(pdfAnnotation => {
                                                        if (pdfAnnotation.kind === 'rectangle' && pdfAnnotation.id === rectangleId) {
                                                            return { ...pdfAnnotation, linkedAnnotationId: addingRectangleToAnnotationId };
                                                        }
                                                        return pdfAnnotation;
                                                    });
                                                });
                                                
                                                return {
                                                    ...state,
                                                    pdfAnnotations: {
                                                        ...state.pdfAnnotations,
                                                        [pdfFileId]: updatedPdfAnnotations
                                                    }
                                                };
                                            });
                                        }
                                        
                                        // Keep mode active to allow adding more rectangles
                                        // User must click "Done" button to exit
                                    } else {
                                        // Creating new annotation with rectangle
                                        setPendingRectangleId(rectangleId);
                                        setIsAddingAnnotation(true);
                                        setIsAnnotationsPanelCollapsed(false);
                                    }
                                }}
                                visibleRectangleIds={visibleRectangleIds}
                            />
                        </div>
                        <AnnotationsPanel
                            selectedFileName={selectedCenterFile.name}
                            annotations={currentFileAnnotations}
                            onAddAnnotation={handleAddAnnotation}
                            onEditAnnotation={handleEditAnnotation}
                            onDeleteAnnotation={handleDeleteAnnotation}
                            isCollapsed={isAnnotationsPanelCollapsed}
                            onToggleCollapse={() => setIsAnnotationsPanelCollapsed(!isAnnotationsPanelCollapsed)}
                            height={annotationsPanelHeight}
                            onHeightChange={setAnnotationsPanelHeight}
                            isAdding={isAddingAnnotation}
                            onIsAddingChange={setIsAddingAnnotation}
                            selectedAnnotationIds={selectedAnnotationIds}
                            onSelectedAnnotationIdsChange={setSelectedAnnotationIds}
                            onAddRectangleToAnnotation={handleAddRectangleToAnnotation}
                        />
                    </div>
                );

            case 'csv':
                if (currentScanViewerState.csvLoading) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                                <p className="text-gray-300">Loading CSV...</p>
                            </div>
                        </div>
                    );
                }
                if (currentScanViewerState.csvError) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center">
                                <p className="text-red-400 mb-4">{currentScanViewerState.csvError}</p>
                            </div>
                        </div>
                    );
                }
                if (!currentScanViewerState.csvData || currentScanViewerState.csvData.length === 0) {
                    return (
                        <div className="flex-1 flex items-center justify-center">
                            <p className="text-gray-400">CSV file is empty</p>
                        </div>
                    );
                }
                const headers = Object.keys(currentScanViewerState.csvData[0]);
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-auto">
                        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-700 text-gray-200 sticky top-0">
                                    <tr>
                                        {headers.map((header, idx) => (
                                            <th key={idx} className="px-4 py-3 font-semibold border-b border-gray-600">
                                                {header}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="text-gray-300">
                                    {currentScanViewerState.csvData.map((row, rowIdx) => (
                                        <tr key={rowIdx} className="border-b border-gray-700 hover:bg-gray-700/50">
                                            {headers.map((header, colIdx) => (
                                                <td key={colIdx} className="px-4 py-2">
                                                    {row[header] || ''}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );

            case 'glb':
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden">
                        <Viewer
                            modelUrl={selectedCenterFile.url}
                            onModelUpload={handleModelUpload}
                            annotations={currentScan?.threeDAnnotations}
                            onAnnotationAdd={handleThreeDAnnotationAdd}
                            insights={currentScan?.insights}
                            onAnnotationSelect={handleThreeDAnnotationSelect}
                            onAnnotationDelete={handleThreeDAnnotationDelete}
                        />
                    </div>
                );

            case 'image':
                return (
                    <div className="flex-1 pl-4 pt-4 pb-4 pr-[52px] overflow-hidden flex items-center justify-center bg-gray-800">
                        <img
                            src={selectedCenterFile.url}
                            alt={selectedCenterFile.name}
                            className="max-w-full max-h-full object-contain border-2 border-gray-700 rounded-lg"
                            title={selectedCenterFile.name}
                        />
                    </div>
                );

            default:
                const fileSizeKB = (selectedCenterFile.file.size / 1024).toFixed(2);
                return (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center max-w-md">
                            <p className="text-gray-300 text-lg mb-2">{selectedCenterFile.name}</p>
                            <p className="text-gray-400 text-sm mb-4">
                                Type: {selectedCenterFile.file.type || 'Unknown'} ({fileSizeKB} KB)
                            </p>
                        </div>
                    </div>
                );
        }
    };

    // Report overlay handlers
    const handleViewReport = (type: ReportType, files: File | File[], onDeleteFile?: (index: number) => void, onAddFile?: (files: File[]) => void) => {
        // Revoke previous URLs to prevent memory leaks
        reportUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        reportUrlsRef.current = [];

        // Convert File(s) to array of {name, url, file}
        // Always use the current files from ReferencePanel to ensure state synchronization
        const fileArray = Array.isArray(files) ? files : [files];
        const fileData = fileArray.map(file => {
            const url = URL.createObjectURL(file);
            reportUrlsRef.current.push(url);
            return { name: file.name, url, file };
        });

        // Initialize overlay with current files from ReferencePanel (single source of truth)
        setReportOverlay({ type, files: fileData, selectedIndex: 0, onDeleteFile, onAddFile });
    };

    const closeReportOverlay = () => {
        // Files are already saved to ReferencePanel state when added via the onAddFile callback,
        // so we just need to clean up object URLs and reset the overlay state
        setReportOverlay(prev => {
            // Revoke URLs
            reportUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
            reportUrlsRef.current = [];

            return { type: null, files: [], selectedIndex: 0 };
        });
    };

    // Handler for deleting files from the overlay
    const handleDeleteFile = useCallback((index: number) => {
        setReportOverlay(prev => {
            if (!prev.onDeleteFile) return prev;

            // Revoke URL for the file being deleted
            if (prev.files[index]?.url) {
                URL.revokeObjectURL(prev.files[index].url);
                reportUrlsRef.current = reportUrlsRef.current.filter(url => url !== prev.files[index].url);
            }

            // Call the delete callback to update the source
            prev.onDeleteFile(index);

            // Update local state
            const newFiles = prev.files.filter((_, i) => i !== index);

            // Handle edge cases: if current file is deleted, switch to first remaining or close
            let newSelectedIndex = prev.selectedIndex;
            if (index === prev.selectedIndex) {
                if (newFiles.length > 0) {
                    newSelectedIndex = 0;
                } else {
                    // No files left, close overlay
                    // Revoke remaining URLs
                    reportUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
                    reportUrlsRef.current = [];
                    return { type: null, files: [], selectedIndex: 0 };
                }
            } else if (index < prev.selectedIndex) {
                // Adjust selected index if a file before it was deleted
                newSelectedIndex = prev.selectedIndex - 1;
            }

            return {
                ...prev,
                files: newFiles,
                selectedIndex: newSelectedIndex
            };
        });
    }, []);

    const handleAddFile = useCallback((files: File[]) => {
        setReportOverlay(prev => {
            if (!prev.onAddFile) return prev;

            // Call the add callback to update the source
            prev.onAddFile(files);

            // Update local state
            const newFileData = files.map(file => {
                const url = URL.createObjectURL(file);
                reportUrlsRef.current.push(url);
                return { name: file.name, url, file };
            });

            return {
                ...prev,
                files: [...prev.files, ...newFileData]
            };
        });
    }, []);

    // Debounced auto-save when scans/agentStates change
    const initializedRef = useRef(false);
    useEffect(() => {
        // mark initialized after initial project load
        initializedRef.current = true;
    }, [project.id]);

    useEffect(() => {
        if (!initializedRef.current) return;
        const timer = window.setTimeout(() => {
            onSaveProject(scans, agentStates);
        }, 500);
        return () => window.clearTimeout(timer);
    }, [scans, agentStates, onSaveProject]);

    // Use current scan's file system tree for display
    const displayedFileSystemTree = useMemo(() => {
        return currentScanViewerState.fileSystemTree;
    }, [currentScanViewerState.fileSystemTree]);

    return (
        <div className="h-screen w-screen bg-[#0f1419] flex flex-col text-white">
            <header className="relative flex items-center justify-between px-4 py-5 border-b border-[#2d3748] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-gray-800 via-gray-900 to-black backdrop-blur-xl flex-shrink-0 min-h-[88px]">
                <div className="relative z-20 flex items-center gap-3 flex-shrink-0">
                    <div
                        onClick={onBack}
                        className="cursor-pointer group"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onBack(); }}
                    >
                        <ArrowLeftIcon className="h-5 w-5 text-gray-400 group-hover:text-cyan-400 transition-colors" />
                    </div>
                    {isEditingName ? (
                        <input
                            ref={nameInputRef}
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            onBlur={handleNameSave}
                            onKeyDown={handleNameKeyDown}
                            className="bg-gray-800 border border-cyan-500 rounded-md py-1 px-2 text-lg font-semibold text-white focus:outline-none"
                            aria-label="Edit project name"
                        />
                    ) : (
                        <div className="flex items-center gap-2 group/title cursor-text" onClick={() => setIsEditingName(true)}>
                            <h2 className="text-lg font-semibold text-gray-300 truncate">{project.name}</h2>
                            <PencilIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover/title:opacity-100 transition-opacity" />
                        </div>
                    )}
                </div>

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="pointer-events-auto w-full max-w-[calc(100%-500px)]">
                        <TimelineScrubber
                            scanDates={[...new Set(scans.map(s => s.date))]}
                            currentDate={currentScanDate}
                            onDateChange={handleDateChange}
                            onAddScan={handleAddScan}
                            isDeleteMode={isDeleteMode}
                            selectedScanDates={selectedScanDates}
                            onToggleDeleteMode={handleToggleDeleteMode}
                            onToggleScanSelection={handleToggleScanSelection}
                            onConfirmDelete={handleConfirmDelete}
                            isGlbActive={isGlbActive}
                            onToggleGlb={handleToggleGlb}
                            isBimActive={isBimActive}
                            onToggleBim={handleToggleBim}
                        />
                    </div>
                </div>

                <div className="relative z-20 flex-shrink-0 flex items-center gap-4">
                    <button
                        onClick={() => setIsAgentsLauncherOpen(!isAgentsLauncherOpen)}
                        className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-lg h-[52px] px-8 flex items-center justify-center shadow-lg hover:border-cyan-500 transition-colors ring-2 ring-offset-2 ring-offset-gray-900 ring-cyan-500 focus:outline-none focus:ring-cyan-400"
                        aria-expanded={isAgentsLauncherOpen}
                    >
                        <AgentsLogo />
                    </button>
                </div>
            </header>
            <main className="flex-1 flex overflow-hidden min-h-0">
                {/* Reference Panel (Left) */}
                <div className={`relative flex-shrink-0 transition-all duration-300 ease-in-out ${isInsightsPanelCollapsed ? 'w-12' : 'w-[24rem]'}`}>
                    <button
                        onClick={toggleInsightsPanel}
                        className="absolute top-1/2 -translate-y-1/2 -right-3 z-20 w-6 h-6 bg-gray-700 hover:bg-cyan-600 text-white rounded-full flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500"
                        aria-label={isInsightsPanelCollapsed ? 'Expand reference panel' : 'Collapse reference panel'}
                        title="Toggle panel (Ctrl+[)"
                    >
                        {isInsightsPanelCollapsed ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}
                    </button>

                    {isInsightsPanelCollapsed ? (
                        <div
                            className="w-full h-full flex items-center justify-center cursor-pointer bg-gray-900 border-r border-gray-800"
                            onDoubleClick={toggleInsightsPanel}
                        >
                            <h2 className="[writing-mode:vertical-rl] rotate-180 text-sm font-bold tracking-wider text-gray-400 whitespace-nowrap">
                                Reference Panel
                            </h2>
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-col border-r border-gray-800 overflow-hidden">
                            {activeInsightChatId ? (() => {
                                const activeInsight = currentScan?.insights.find(i => i.id === activeInsightChatId);
                                return activeInsight ? (
                                    <InsightChatPanel
                                        insight={activeInsight}
                                        onBack={() => setActiveInsightChatId(null)}
                                        onStatusChange={handleInsightStatusChange}
                                        onReassignTrade={handleReassignTrade}
                                    />
                                ) : null;
                            })() : (
                                <ReferencePanel
                                    summary={projectSummary}
                                    insights={currentScan?.insights || []}
                                    progress={project.progress}
                                    onViewReport={handleViewReport}
                                    onAddInsights={handleAddInsights}
                                    isListDataActive={isListDataActive}
                                    onToggleListData={handleToggleListData}

                                    // Legacy Props
                                    centerViewerFiles={currentScanViewerState.centerViewerFiles}
                                    selectedFileIndex={currentScanViewerState.selectedFileIndex}
                                    onSelectFile={(index) => updateCurrentScanViewerState(state => ({ ...state, selectedFileIndex: index }))}
                                    onDeleteFile={handleCenterViewerDeleteFile}
                                    onAddFile={handleCenterViewerAddFile}
                                    fileInputRef={centerViewerFileInputRef}

                                    // New Folder Tree Props
                                    fileSystemTree={displayedFileSystemTree}
                                    selectedNodeId={currentScanViewerState.selectedNodeId}
                                    onSelectNode={handleSelectNode}
                                    onToggleExpand={handleToggleExpand}
                                    onRenameNode={handleRenameNode}
                                    onDeleteNode={handleDeleteNode}
                                    onMoveNode={handleMoveNode}
                                    onOpenFile={handleOpenFile}
                                    onCreateFolder={handleCreateFolder}
                                    onUploadProjectMaster={handleUploadProjectMaster}
                                    onUploadModel={handleUploadModel}
                                    onUploadDeviation={handleUploadDeviation}
                                    onUploadClash={handleUploadClash}
                                    onUploadProgress={handleUploadProgress}
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Viewer (Center) */}
                <div className="flex-1 flex flex-col relative overflow-hidden min-w-0 min-h-0">
                    {/* Hidden file input */}
                    <input
                        ref={centerViewerFileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleCenterViewerFileInputChange}
                        accept=".pdf,.csv,.glb,.png,.jpg,.jpeg,.gif,.webp"
                    />

                    {/* PDF Tools Button */}
                    {centerFileType === 'pdf' && (
                        <button
                            ref={pdfToolsButtonRef}
                            onClick={() => setIsPdfToolsOpen(!isPdfToolsOpen)}
                            className={`absolute top-4 right-4 z-20 p-2 backdrop-blur-sm text-white rounded-md border focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors shadow-lg ${isPdfToolsOpen
                                ? 'bg-cyan-600 border-cyan-500 hover:bg-cyan-700'
                                : 'bg-gray-800/80 border-white/10 hover:bg-gray-700'
                                }`}
                            aria-label="Toggle PDF tools"
                            aria-pressed={isPdfToolsOpen}
                            type="button"
                        >
                            <PencilIcon className="h-5 w-5" />
                        </button>
                    )}

                    {/* PDF Tools Panel */}
                    {centerFileType === 'pdf' && isPdfToolsOpen && pdfToolbarHandlers && (
                        <div ref={toolbarRef} className="absolute top-16 right-4 z-30 shadow-xl">
                            <PdfToolsPanel
                                {...pdfToolbarHandlers}
                                onClose={() => setIsPdfToolsOpen(false)}
                            />
                        </div>
                    )}

                    {/* File viewer content */}
                    {renderCenterViewerContent()}

                    <GeminiPanel
                        agentStates={agentStates}
                        onAgentStatesChange={setAgentStates}
                        isLauncherOpen={isAgentsLauncherOpen}
                        onLauncherOpenChange={setIsAgentsLauncherOpen}
                    />

                    {/* Report Overlay */}
                    {reportOverlay.type && (
                        <ReportOverlayViewer
                            files={reportOverlay.files}
                            selectedIndex={reportOverlay.selectedIndex}
                            onClose={closeReportOverlay}
                            onSelectFile={(index) => setReportOverlay(prev => ({ ...prev, selectedIndex: index }))}
                            getFileType={getFileType}
                            onDeleteFile={reportOverlay.onDeleteFile ? handleDeleteFile : undefined}
                            onAddFile={reportOverlay.onAddFile ? handleAddFile : undefined}
                        />
                    )}
                </div>

                {/* Insights Panel (Right) */}
                <div className={`relative flex-shrink-0 transition-all duration-300 ease-in-out ${isMetricsPanelCollapsed ? 'w-12' : 'w-[24rem]'}`}>
                    <button
                        onClick={toggleMetricsPanel}
                        className="absolute top-1/2 -translate-y-1/2 -left-3 z-20 w-6 h-6 bg-gray-700 hover:bg-cyan-600 text-white rounded-full flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500"
                        aria-label={isMetricsPanelCollapsed ? 'Expand insights panel' : 'Collapse insights panel'}
                        title="Toggle panel (Ctrl+])"
                    >
                        {isMetricsPanelCollapsed ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                    </button>

                    {isMetricsPanelCollapsed ? (
                        <div
                            className="w-full h-full flex items-center justify-center cursor-pointer bg-gray-900 border-l border-gray-800"
                            onDoubleClick={toggleMetricsPanel}
                        >
                            <h2 className="[writing-mode:vertical-rl] text-sm font-bold tracking-wider text-gray-400 whitespace-nowrap">
                                Insights Panel
                            </h2>
                        </div>
                    ) : (
                        <div className="w-full h-full flex flex-col border-l border-gray-800 overflow-hidden">
                            <InsightsList
                                insights={currentScan?.insights || []}
                                onUploadInsights={handleUploadInsights}
                                onInsightStatusChange={handleInsightStatusChange}
                                onAddNote={handleAddNote}
                                onReassignTrade={handleReassignTrade}
                                onOpenInsightChat={setActiveInsightChatId}
                                onCloseInsightChat={() => setActiveInsightChatId(null)}
                                activeInsightChatId={activeInsightChatId}
                                highlightedInsightId={highlightedInsightId}
                            />
                        </div>
                    )}
                </div>
            </main>
            <AddScanModal
                isOpen={isAddScanModalOpen}
                onClose={() => setIsAddScanModalOpen(false)}
                onAddScan={handleConfirmAddScan}
            />
        </div>
    );
};

export default ProjectViewerPage;