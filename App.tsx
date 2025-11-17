
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Project, ScanData, Severity, InsightStatus, AgentType, AgentState } from './types';
import { MaestroLogo, PlusIcon, SearchIcon, FolderIcon, CriticalDotIcon, AlertTriangleIcon, MediumPriorityIcon, LowPriorityIcon, ClockIcon, ChevronDownIcon, GridIcon, ListIcon, ArrowRightIcon, PencilIcon } from './components/Icons';
import ProjectViewerPage from './components/ProjectViewerPage';

// --- DASHBOARD SUB-COMPONENTS ---

interface HeaderProps {
  onNewProject: () => void;
}

const Header: React.FC<HeaderProps> = ({ onNewProject }) => (
  <header className="flex items-center justify-between p-4 border-b border-[#2d3748] bg-[#1a1f2e]">
    <MaestroLogo />
    <div className="flex items-center gap-4">
      <div className="relative">
        <input type="text" placeholder="Search projects..." className="bg-[#0f1419] border border-[#2d3748] rounded-lg py-2 pl-10 pr-4 w-64 focus:outline-none focus:ring-2 focus:ring-[#4299e1]" />
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
      </div>
      <button onClick={onNewProject} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors">
        <PlusIcon className="h-5 w-5" />
        New Project
      </button>
    </div>
  </header>
);

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, color }) => (
  <div className="bg-[#1a1f2e] p-6 rounded-xl border border-[#2d3748] flex items-center gap-4">
    <div className={`p-3 rounded-lg ${color || 'bg-gray-600'}`}>
      {icon}
    </div>
    <div>
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  </div>
);

// --- Custom Dropdown Component ---
interface StatusDropdownProps {
    status: 'Active' | 'Completed';
    onUpdateStatus: (newStatus: 'Active' | 'Completed') => void;
    className?: string;
    buttonClassName?: string;
}
  
const StatusDropdown: React.FC<StatusDropdownProps> = ({ status, onUpdateStatus, className, buttonClassName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
            setIsOpen(false);
        }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [dropdownRef]);

    const handleSelect = (newStatus: 'Active' | 'Completed') => {
        onUpdateStatus(newStatus);
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className || ''}`} ref={dropdownRef} onClick={e => e.stopPropagation()}>
        <button
            onClick={() => setIsOpen(!isOpen)}
            className={`w-full text-left flex justify-between items-center focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-black/50 focus:ring-cyan-500 ${buttonClassName}`}
            aria-haspopup="listbox"
            aria-expanded={isOpen}
        >
            <span>{status}</span>
            <ChevronDownIcon className={`h-3 w-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
            <div className="absolute z-10 mt-1 w-full bg-[#1a1f2e] rounded-md border border-gray-600 shadow-lg overflow-hidden p-1">
            <ul role="listbox">
                <li>
                <button
                    onClick={() => handleSelect('Active')}
                    className={`w-full text-left px-2 py-1.5 text-xs font-bold rounded hover:bg-white/10 transition-colors ${
                        status === 'Active' ? 'text-cyan-400' : 'text-gray-400'
                    }`}
                    role="option"
                    aria-selected={status === 'Active'}
                >
                    Active
                </button>
                </li>
                <li>
                <button
                    onClick={() => handleSelect('Completed')}
                    className={`w-full text-left px-2 py-1.5 text-xs font-bold rounded hover:bg-white/10 transition-colors ${
                        status === 'Completed' ? 'text-cyan-400' : 'text-gray-400'
                    }`}
                    role="option"
                    aria-selected={status === 'Completed'}
                >
                    Completed
                </button>
                </li>
            </ul>
            </div>
        )}
        </div>
    );
};

interface ProjectCardProps {
  project: Project;
  onSelect: (project: Project) => void;
  onUpdateName: (newName: string) => void;
  onUpdateStatus: (newStatus: 'Active' | 'Completed') => void;
  onUpdateImage: (imageUrl: string) => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ project, onSelect, onUpdateName, onUpdateStatus, onUpdateImage }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editedName.trim() && editedName.trim() !== project.name) {
      onUpdateName(editedName.trim());
    } else {
      setEditedName(project.name);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSave();
    else if (e.key === 'Escape') {
      setEditedName(project.name);
      setIsEditing(false);
    }
  };

  const handleImageUploadClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.blur();
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      e.stopPropagation();
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              if (typeof reader.result === 'string') {
                  onUpdateImage(reader.result);
              }
          };
          reader.readAsDataURL(file);
      }
  };
  
  return (
    <div className="bg-[#1a1f2e] rounded-xl border border-[#2d3748] overflow-hidden group transition-all duration-300 hover:bg-white/5 hover:border-gray-700 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/30">
    <div className="relative h-48 overflow-hidden">
      {project.imageUrl ? (
        <>
          <img src={project.imageUrl} alt={project.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
        </>
      ) : (
        <>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" aria-label="Upload project image file" />
          <button
            onClick={handleImageUploadClick}
            className="w-full h-full bg-gray-800 flex items-center justify-center text-gray-600 hover:bg-gray-700 hover:text-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500"
            aria-label="Upload project image"
          >
            <FolderIcon className="w-16 h-16" />
          </button>
        </>
      )}
      
      <div className="absolute top-4 left-4 w-28">
        <StatusDropdown
          status={project.status}
          onUpdateStatus={onUpdateStatus}
          buttonClassName={`text-xs font-bold py-1 pl-3 pr-2 rounded-full border bg-[#1a1f2e] border-gray-600 ${
            project.status === 'Active' ? 'text-cyan-400' : 'text-gray-400'
          }`}
        />
      </div>

      <div className="absolute top-4 right-4 flex gap-2">
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-white text-xs font-semibold py-1 px-2.5 rounded-full border border-white/20">🔴 {project.issues.critical}</div>
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-white text-xs font-semibold py-1 px-2.5 rounded-full border border-white/20">⚠️ {project.issues.high}</div>
        <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm text-white text-xs font-semibold py-1 px-2.5 rounded-full border border-white/20">📊 {project.issues.total}</div>
      </div>
    </div>
    <div className="p-6">
      {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="w-full bg-gray-700 border border-cyan-500 rounded-md py-0.5 px-2 -mx-2 text-lg font-bold text-white focus:outline-none"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Edit name for project ${project.name}`}
          />
        ) : (
          <div className="flex items-center gap-2 group/title cursor-text" onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}>
            <h3 className="text-lg font-bold truncate">{project.name}</h3>
            <PencilIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover/title:opacity-100 transition-opacity" />
          </div>
        )}
      <p className="text-sm text-gray-400 mt-1">{project.lastScan.type} &bull; {project.lastScan.date}</p>
      <div className="mt-4">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs font-semibold text-gray-300">Progress</span>
          <span className="text-xs font-bold text-cyan-400">{project.progress}%</span>
        </div>
        <div className="w-full bg-[#2d3748] rounded-full h-2">
          <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-2 rounded-full" style={{ width: `${project.progress}%` }}></div>
        </div>
      </div>
      <div className="flex justify-between items-center mt-6 text-sm">
        <p className="text-gray-500">{`Last scan: ${project.lastScanTimeAgo}`}</p>
        <button onClick={() => onSelect(project)} className="font-semibold text-blue-400 flex items-center gap-1 group-hover:gap-2 transition-all">
          Open <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  </div>
  );
};

const ProjectListItem: React.FC<ProjectCardProps> = ({ project, onSelect, onUpdateName, onUpdateStatus, onUpdateImage }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedName, setEditedName] = useState(project.name);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isEditing) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }, [isEditing]);
  
    const handleSave = () => {
      if (editedName.trim() && editedName.trim() !== project.name) {
        onUpdateName(editedName.trim());
      } else {
        setEditedName(project.name);
      }
      setIsEditing(false);
    };
  
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') handleSave();
      else if (e.key === 'Escape') {
        setEditedName(project.name);
        setIsEditing(false);
      }
    };
    
    const handleImageUploadClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.currentTarget.blur();
      fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.stopPropagation();
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    onUpdateImage(reader.result);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    return (
    <div className="bg-[#1a1f2e] rounded-xl border border-[#2d3748] p-4 flex items-center gap-6 group transition-all duration-300 hover:bg-white/5 hover:border-gray-700 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/30">
      {project.imageUrl ? (
        <img src={project.imageUrl} alt={project.name} className="w-32 h-20 object-cover rounded-lg flex-shrink-0" />
      ) : (
        <>
          <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" aria-label="Upload project image file" />
          <button
            onClick={handleImageUploadClick}
            className="w-32 h-20 bg-gray-800 flex items-center justify-center rounded-lg flex-shrink-0 text-gray-600 hover:bg-gray-700 hover:text-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-500"
            aria-label="Upload project image"
          >
            <FolderIcon className="w-10 h-10" />
          </button>
        </>
      )}
      <div className="flex-1">
        {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="w-full bg-gray-700 border border-cyan-500 rounded-md py-0.5 px-2 -mx-2 text-lg font-bold text-white focus:outline-none"
              aria-label={`Edit name for project ${project.name}`}
            />
        ) : (
            <div className="flex items-center gap-2 group/title cursor-text" onClick={() => setIsEditing(true)}>
                <h3 className="text-lg font-bold truncate">{project.name}</h3>
                <PencilIcon className="h-4 w-4 text-gray-400 opacity-0 group-hover/title:opacity-100 transition-opacity" />
            </div>
        )}
        <p className="text-sm text-gray-400 mt-1">{project.lastScan.type} &bull; {project.lastScan.date}</p>
        <p className="text-xs text-gray-500 mt-1">{`Last scan: ${project.lastScanTimeAgo}`}</p>
      </div>
      <div className="flex-shrink-0 w-32">
        <StatusDropdown
          status={project.status}
          onUpdateStatus={onUpdateStatus}
          buttonClassName={`bg-[#1a1f2e] border border-gray-600 rounded-md py-1 px-3 text-xs font-bold ${project.status === 'Active' ? 'text-cyan-400' : 'text-gray-400'}`}
        />
      </div>
      <div className="flex-shrink-0 flex items-center gap-4 text-sm">
         <div className="flex items-center gap-1.5 text-white font-semibold">
           <span className="text-[#f56565]">🔴</span> {project.issues.critical} <span className="text-gray-400">Critical</span>
         </div>
         <div className="flex items-center gap-1.5 text-white font-semibold">
           <span className="text-[#ed8936]">⚠️</span> {project.issues.high} <span className="text-gray-400">High</span>
         </div>
      </div>
      <div className="w-32 flex-shrink-0">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-semibold text-gray-300">Progress</span>
            <span className="text-xs font-bold text-cyan-400">{project.progress}%</span>
          </div>
          <div className="w-full bg-[#2d3748] rounded-full h-2">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-400 h-2 rounded-full" style={{ width: `${project.progress}%` }}></div>
          </div>
      </div>
      <button onClick={() => onSelect(project)} className="font-semibold text-blue-400 flex items-center gap-1 group-hover:gap-2 transition-all bg-blue-500/10 hover:bg-blue-500/20 px-4 py-2 rounded-lg">
          Open <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
    );
};


// --- DASHBOARD COMPONENT ---
interface DashboardProps {
    projects: Project[];
    onSelectProject: (project: Project) => void;
    onNewProject: () => void;
    onUpdateProjectName: (projectId: string, newName: string) => void;
    onUpdateProjectStatus: (projectId: string, newStatus: 'Active' | 'Completed') => void;
    onUpdateProjectImage: (projectId: string, imageUrl: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ projects, onSelectProject, onNewProject, onUpdateProjectName, onUpdateProjectStatus, onUpdateProjectImage }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('All Projects');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
    const statusTabs = ['All Projects', 'Active', 'Completed'];
  
    const displayedProjects = useMemo(() => {
      return projects
        .filter(p => {
          if (statusFilter === 'All Projects') return true;
          return p.status === statusFilter;
        })
        .filter(p => {
            return p.name.toLowerCase().includes(searchQuery.toLowerCase());
        })
        .sort((a, b) => new Date(b.lastScan.date).getTime() - new Date(a.lastScan.date).getTime());
    }, [projects, searchQuery, statusFilter]);
  
    const totalProjects = projects.length;
    const criticalIssues = projects.reduce((sum, p) => sum + p.issues.critical, 0);
    const highPriority = projects.reduce((sum, p) => sum + p.issues.high, 0);
    const mediumPriority = projects.reduce((sum, p) => sum + (p.issues.medium || 0), 0);
    const lowPriority = projects.reduce((sum, p) => sum + (p.issues.low || 0), 0);
    const lastScanProject = projects.sort((a, b) => new Date(b.lastScan.date).getTime() - new Date(a.lastScan.date).getTime())[0];
    const lastScan = lastScanProject ? lastScanProject.lastScanTimeAgo : 'N/A';
  
    return (
        <div className="h-screen flex flex-col">
            <Header onNewProject={onNewProject} />
            <main className="flex-1 bg-[#1a1f2e] p-8 overflow-y-auto">
                <h1 className="text-3xl font-bold">My Projects</h1>
                
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 my-8">
                    <StatCard icon={<FolderIcon />} label="Total Projects" value={totalProjects} />
                    <StatCard icon={<CriticalDotIcon />} label="Critical Issues" value={criticalIssues} color="bg-red-500/20" />
                    <StatCard icon={<AlertTriangleIcon />} label="High Priority" value={highPriority} color="bg-orange-500/20" />
                    <StatCard icon={<MediumPriorityIcon />} label="Medium Priority" value={mediumPriority} color="bg-yellow-500/20" />
                    <StatCard icon={<LowPriorityIcon />} label="Low Priority" value={lowPriority} color="bg-green-500/20" />
                    <StatCard icon={<ClockIcon />} label="Last Scan" value={lastScan} />
                </div>

                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-2 bg-[#0f1419] p-1 rounded-lg border border-[#2d3748]">
                    {statusTabs.map(tab => (
                        <button 
                        key={tab}
                        onClick={() => setStatusFilter(tab)}
                        className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${statusFilter === tab ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-slate-800'}`}
                        >
                        {tab}
                        </button>
                    ))}
                    </div>
                    <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                        <span>Sort by:</span>
                        <button className="flex items-center gap-1 font-semibold text-white hover:text-cyan-400">
                        Most Recent <ChevronDownIcon />
                        </button>
                    </div>
                    <div className="flex items-center gap-1 bg-[#0f1419] p-1 rounded-lg border border-[#2d3748]">
                        <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-slate-800'}`}><GridIcon /></button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-slate-800'}`}><ListIcon /></button>
                    </div>
                    </div>
                </div>
                
                {displayedProjects.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {displayedProjects.map(project => <ProjectCard key={project.id} project={project} onSelect={onSelectProject} onUpdateName={(newName) => onUpdateProjectName(project.id, newName)} onUpdateStatus={(newStatus) => onUpdateProjectStatus(project.id, newStatus)} onUpdateImage={(imageUrl) => onUpdateProjectImage(project.id, imageUrl)} />)}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                        {displayedProjects.map(project => <ProjectListItem key={project.id} project={project} onSelect={onSelectProject} onUpdateName={(newName) => onUpdateProjectName(project.id, newName)} onUpdateStatus={(newStatus) => onUpdateProjectStatus(project.id, newStatus)} onUpdateImage={(imageUrl) => onUpdateProjectImage(project.id, imageUrl)} />)}
                        </div>
                    )
                ) : (
                    <div className="text-center py-16 bg-[#0f1419] rounded-lg border-2 border-dashed border-[#2d3748]">
                        <p className="text-5xl mb-4">📂</p>
                        <h3 className="text-xl font-semibold text-white">No Projects Yet</h3>
                        <p className="text-gray-400 mt-2">Click "New Project" to get started.</p>
                    </div>
                )}
            </main>
        </div>
    );
}


// --- MAIN APP COMPONENT ---

const App: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  const currentView = selectedProjectId ? 'viewer' : 'dashboard';

  // Hydrate projects from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('maestro4d_projects');
    if (saved) {
      try {
        setProjects(JSON.parse(saved));
      } catch (e) {
        // Ignore parse errors, start with empty projects
      }
    }
  }, []);

  // Persist projects to localStorage whenever they change
  useEffect(() => {
    if (projects.length > 0 || localStorage.getItem('maestro4d_projects') !== null) {
      localStorage.setItem('maestro4d_projects', JSON.stringify(projects));
    }
  }, [projects]);

  const handleSelectProject = (project: Project) => {
    setSelectedProjectId(project.id);
  }

  const handleBackToDashboard = () => {
    setSelectedProjectId(null);
  }

  const handleNewProject = () => {
    const newProjectDate = new Date().toISOString().split('T')[0];
    const newProject: Project = {
      id: `proj_${Date.now()}`,
      name: `New Sample Project #${projects.length + 1}`,
      status: 'Active',
      lastScan: {
        type: 'As-Built Scan',
        date: newProjectDate,
      },
      lastScanTimeAgo: 'Just now',
      progress: 0,
      issues: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
      },
      agentStates: {
        market: {
            chatHistory: [{ role: 'model', parts: [{ text: "I am the Market Intelligence Agent. I'm tracking live prices. Ask me about material trends, volatility, or for procurement advice, like 'Should I lock in steel prices now?'" }] }],
            uploadedFiles: [],
        },
        spec: {
            chatHistory: [{ role: 'model', parts: [{ text: "I am the Spec Search Agent. Please upload your project specifications, drawings, and contracts. I can then answer questions like, 'What are the fire rating requirements for the stairwell walls?'" }] }],
            uploadedFiles: [],
        }
      },
      scans: [{
        date: newProjectDate,
        modelUrl: undefined,
        insights: [],
      }],
    };
    setProjects(prev => [...prev, newProject]);
  }

  const handleSaveProject = (projectId: string, updatedScans: ScanData[], agentStates: Record<AgentType, AgentState>) => {
    setProjects(prevProjects =>
      prevProjects.map(p => {
        if (p.id === projectId) {
          // Also update project summary info based on the latest scan
          const latestScan = [...updatedScans].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
          
          if (!latestScan) {
             return { ...p, scans: updatedScans, agentStates };
          }
          
          const insights = latestScan.insights;
          const critical = insights.filter(i => i.severity === Severity.Critical).length;
          const high = insights.filter(i => i.severity === Severity.High).length;
          const medium = insights.filter(i => i.severity === Severity.Medium).length;
          const low = insights.filter(i => i.severity === Severity.Low).length;
          const resolvedCount = insights.filter(i => i.status === InsightStatus.Resolved).length;
          const progress = insights.length > 0 ? Math.round((resolvedCount / insights.length) * 100) : 0;
          
          return {
            ...p,
            scans: updatedScans,
            agentStates,
            lastScan: { ...p.lastScan, date: latestScan.date },
            progress,
            issues: {
              critical,
              high,
              medium,
              low,
              total: insights.length,
            }
          };
        }
        return p;
      })
    );
  };

  const handleUpdateProjectName = (projectId: string, newName: string) => {
    setProjects(prevProjects =>
      prevProjects.map(p =>
        p.id === projectId ? { ...p, name: newName } : p
      )
    );
  };

  const handleUpdateProjectStatus = (projectId: string, newStatus: 'Active' | 'Completed') => {
    setProjects(prevProjects =>
      prevProjects.map(p =>
        p.id === projectId ? { ...p, status: newStatus } : p
      )
    );
  };
  
  const handleUpdateProjectImage = (projectId: string, imageUrl: string) => {
    setProjects(prevProjects =>
      prevProjects.map(p =>
        p.id === projectId ? { ...p, imageUrl: imageUrl } : p
      )
    );
  };

  return (
    <div className="bg-black">
      {currentView === 'dashboard' && <Dashboard projects={projects} onSelectProject={handleSelectProject} onNewProject={handleNewProject} onUpdateProjectName={handleUpdateProjectName} onUpdateProjectStatus={handleUpdateProjectStatus} onUpdateProjectImage={handleUpdateProjectImage} />}
      {currentView === 'viewer' && selectedProject && (
        <ProjectViewerPage 
            project={selectedProject} 
            onBack={handleBackToDashboard} 
            onUpdateProjectName={(newName) => handleUpdateProjectName(selectedProject.id, newName)}
            onSaveProject={(updatedScans, agentStates) => handleSaveProject(selectedProject.id, updatedScans, agentStates)}
        />
      )}
    </div>
  );
};

export default App;