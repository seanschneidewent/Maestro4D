import React, { useMemo } from 'react';
import { Project } from '../types';
import { 
    CriticalDotIcon, 
    AlertTriangleIcon, 
    MediumPriorityIcon, 
    LowPriorityIcon,
    ClockIcon,
    CheckIcon,
    FolderIcon
} from './Icons';

interface DashboardSidebarProps {
    projects: Project[];
}

const DashboardSidebar: React.FC<DashboardSidebarProps> = ({ projects }) => {
    
    const stats = useMemo(() => {
        const total = projects.length;
        const critical = projects.reduce((sum, p) => sum + p.issues.critical, 0);
        const high = projects.reduce((sum, p) => sum + p.issues.high, 0);
        const medium = projects.reduce((sum, p) => sum + (p.issues.medium || 0), 0);
        const low = projects.reduce((sum, p) => sum + (p.issues.low || 0), 0);
        const active = projects.filter(p => p.status === 'Active').length;
        const completed = projects.filter(p => p.status === 'Completed').length;

        // Calculate "System Health" - simple heuristic: 100 - (critical * 10 + high * 5) / total projects
        // Clamped between 0 and 100.
        const penalty = (critical * 10) + (high * 5);
        const rawHealth = total > 0 ? 100 - (penalty / total) : 100;
        const systemHealth = Math.max(0, Math.min(100, Math.round(rawHealth)));

        // Recent activity: Sort by last scan date
        const recentProjects = [...projects]
            .sort((a, b) => new Date(b.lastScan.date).getTime() - new Date(a.lastScan.date).getTime())
            .slice(0, 4);

        return {
            total,
            critical,
            high,
            medium,
            low,
            active,
            completed,
            systemHealth,
            recentProjects
        };
    }, [projects]);

    // Circular Progress Props
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (stats.systemHealth / 100) * circumference;
    
    // Use the gradient for the text color instead of conditional colors for the number
    const healthTextColor = 'bg-gradient-to-r from-blue-500 to-cyan-400 text-transparent bg-clip-text';

    return (
        <div className="w-80 bg-[#161b22] border-l border-[#2d3748] flex flex-col h-full overflow-y-auto sticky top-0 shadow-xl">
            <div className="p-6 space-y-8">
                
                {/* System Health Section */}
                <div className="text-center relative group">
                    <div className="absolute inset-0 bg-blue-500/5 blur-3xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-[0.2em] mb-6">System Health</h3>
                    <div className="relative flex items-center justify-center transform transition-transform duration-500 hover:scale-105">
                        {/* Glow effect behind ring */}
                        <div className="absolute inset-0 bg-cyan-500/10 blur-2xl rounded-full" />
                        
                        <svg className="transform -rotate-90 w-40 h-40 drop-shadow-2xl">
                            <defs>
                                <linearGradient id="healthGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#3b82f6" />
                                    <stop offset="100%" stopColor="#22d3ee" />
                                </linearGradient>
                            </defs>
                            <circle
                                cx="80"
                                cy="80"
                                r={radius}
                                stroke="#1f2937"
                                strokeWidth="8"
                                fill="transparent"
                                className="opacity-30"
                            />
                            <circle
                                cx="80"
                                cy="80"
                                r={radius}
                                stroke="url(#healthGradient)"
                                strokeWidth="8"
                                fill="transparent"
                                strokeDasharray={circumference}
                                strokeDashoffset={strokeDashoffset}
                                className="transition-all duration-1000 ease-out drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]"
                                strokeLinecap="round"
                            />
                        </svg>
                        <div className="absolute flex flex-col items-center">
                            <span className={`text-4xl font-black tracking-tighter ${healthTextColor}`}>
                                {stats.systemHealth}%
                            </span>
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-1">Score</span>
                        </div>
                    </div>
                </div>

                {/* Issues Breakdown */}
                <div>
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Total Issues</h3>
                    <div className="space-y-3 bg-[#0d1117]/50 p-4 rounded-xl border border-[#30363d]">
                        <IssueBar label="Critical" count={stats.critical} total={stats.critical + stats.high + stats.medium + stats.low} color="bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" icon={<CriticalDotIcon className="w-3 h-3 text-red-500" />} />
                        <IssueBar label="High" count={stats.high} total={stats.critical + stats.high + stats.medium + stats.low} color="bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]" icon={<AlertTriangleIcon className="w-3 h-3 text-orange-500" />} />
                        <IssueBar label="Medium" count={stats.medium} total={stats.critical + stats.high + stats.medium + stats.low} color="bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]" icon={<MediumPriorityIcon className="w-3 h-3 text-yellow-400" />} />
                        <IssueBar label="Low" count={stats.low} total={stats.critical + stats.high + stats.medium + stats.low} color="bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" icon={<LowPriorityIcon className="w-3 h-3 text-green-500" />} />
                    </div>
                </div>

                {/* Project Status */}
                <div className="grid grid-cols-2 gap-3">
                    <StatusCard 
                        label="Active" 
                        count={stats.active} 
                        isActive={true}
                        icon={<FolderIcon className="w-5 h-5 text-cyan-400" />} 
                    />
                    <StatusCard 
                        label="Completed" 
                        count={stats.completed} 
                        isActive={false}
                        icon={<CheckIcon className="w-5 h-5 text-green-400" />} 
                    />
                </div>

                {/* Recent Activity */}
                <div>
                    <h3 className="text-gray-400 text-xs font-bold uppercase tracking-[0.2em] mb-4">Recent Scans</h3>
                    <div className="space-y-2">
                        {stats.recentProjects.length > 0 ? (
                            stats.recentProjects.map(project => (
                                <div key={project.id} className="group bg-[#0d1117] p-3 rounded-lg border border-[#30363d] hover:border-cyan-500/30 hover:bg-[#1a1f2e] transition-all duration-300 cursor-pointer relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 to-cyan-500/0 group-hover:from-blue-500/5 group-hover:to-cyan-500/5 transition-all duration-500" />
                                    
                                    <div className="flex justify-between items-start mb-1.5 relative z-10">
                                        <span className="font-semibold text-sm truncate w-2/3 text-gray-200 group-hover:text-white transition-colors" title={project.name}>{project.name}</span>
                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                            project.status === 'Active' 
                                                ? 'bg-blue-500/10 text-blue-300 border-blue-500/20 group-hover:border-blue-500/40' 
                                                : 'bg-green-500/10 text-green-300 border-green-500/20'
                                        }`}>
                                            {project.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="flex items-center text-[10px] text-gray-500 gap-1.5 relative z-10 group-hover:text-gray-400">
                                        <ClockIcon className="w-3 h-3" />
                                        <span>{project.lastScanTimeAgo}</span>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="text-gray-600 text-xs text-center py-6 italic border border-dashed border-gray-800 rounded-lg">No recent activity</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
};

const IssueBar: React.FC<{ label: string, count: number, total: number, color: string, icon: React.ReactNode }> = ({ label, count, total, color, icon }) => {
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    
    return (
        <div className="flex flex-col gap-1.5 group">
            <div className="flex justify-between text-[11px] items-end">
                <div className="flex items-center gap-2 text-gray-400 font-medium group-hover:text-gray-300 transition-colors">
                    {icon}
                    <span>{label}</span>
                </div>
                <span className="font-bold text-gray-300">{count}</span>
            </div>
            <div className="h-1.5 w-full bg-gray-800 rounded-full overflow-hidden border border-white/5">
                <div 
                    className={`h-full rounded-full ${color} transition-all duration-1000 ease-out`} 
                    style={{ width: `${total === 0 ? 0 : Math.max(5, percentage)}%` }}
                />
            </div>
        </div>
    );
};

const StatusCard: React.FC<{ label: string, count: number, isActive: boolean, icon: React.ReactNode }> = ({ label, count, isActive, icon }) => (
    <div className={`
        p-4 rounded-xl border flex flex-col items-center justify-center text-center transition-all duration-300 relative overflow-hidden group
        ${isActive 
            ? 'bg-gradient-to-br from-blue-900/10 to-cyan-900/10 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.1)] hover:border-cyan-400/50' 
            : 'bg-[#0d1117] border-[#30363d] hover:border-gray-600'
        }
    `}>
        {isActive && <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-cyan-400/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />}
        
        <div className="mb-2 p-2 rounded-lg bg-white/5 backdrop-blur-sm relative z-10">
            {icon}
        </div>
        <span className={`text-2xl font-black relative z-10 ${isActive ? 'text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300' : 'text-gray-200'}`}>
            {count}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mt-1 relative z-10">{label}</span>
    </div>
);

export default DashboardSidebar;