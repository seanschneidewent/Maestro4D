import React, { useState, useEffect, useCallback } from 'react';
import { CloseIcon, PlusIcon } from './Icons';
import {
    fetchUsers,
    fetchProjectUsers,
    createUser,
    assignUserToProject,
    unassignUserFromProject,
    UserResponse,
    UserCreate,
} from '../utils/api';

// --- ICONS ---
const UserIcon: React.FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
);

const UsersGroupIcon: React.FC<{ className?: string }> = ({ className = "h-5 w-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
);

const CheckIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
);

const MinusIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
    </svg>
);

export const UsersLogo: React.FC = () => (
    <h2 className="text-xl font-extrabold tracking-wider">
        <span className="bg-gradient-to-r from-emerald-500 to-teal-400 text-transparent bg-clip-text">
            USERS
        </span>
    </h2>
);

// --- TYPES ---
interface UserManagementPanelProps {
    projectId: string;
    isOpen: boolean;
    onClose: () => void;
}

type TabType = 'assigned' | 'all' | 'create';

// --- USER CARD COMPONENT ---
interface UserCardProps {
    user: UserResponse;
    isAssigned: boolean;
    onToggleAssignment: (user: UserResponse) => void;
    isLoading: boolean;
}

const UserCard: React.FC<UserCardProps> = ({ user, isAssigned, onToggleAssignment, isLoading }) => {
    return (
        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    user.role === 'admin' 
                        ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30' 
                        : 'bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30'
                }`}>
                    <UserIcon className={`h-5 w-5 ${user.role === 'admin' ? 'text-amber-400' : 'text-blue-400'}`} />
                </div>
                <div>
                    <p className="font-semibold text-white text-sm">{user.name}</p>
                    <p className="text-xs text-gray-400">{user.email}</p>
                </div>
            </div>
            <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full ${
                    user.role === 'admin' 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                        : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                }`}>
                    {user.role}
                </span>
                <button
                    onClick={() => onToggleAssignment(user)}
                    disabled={isLoading}
                    className={`p-2 rounded-lg transition-all ${
                        isAssigned
                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
                    } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={isAssigned ? 'Remove from project' : 'Add to project'}
                >
                    {isLoading ? (
                        <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : isAssigned ? (
                        <MinusIcon />
                    ) : (
                        <PlusIcon className="h-4 w-4" />
                    )}
                </button>
            </div>
        </div>
    );
};

// --- CREATE USER FORM ---
interface CreateUserFormProps {
    onUserCreated: (user: UserResponse) => void;
}

const CreateUserForm: React.FC<CreateUserFormProps> = ({ onUserCreated }) => {
    const [formData, setFormData] = useState<UserCreate>({
        name: '',
        email: '',
        password: '',
        role: 'superintendent',
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const newUser = await createUser(formData);
            onUserCreated(newUser);
            setSuccess(true);
            setFormData({ name: '', email: '', password: '', role: 'superintendent' });
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create user');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                    Full Name
                </label>
                <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="John Doe"
                />
            </div>

            <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                    Email
                </label>
                <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="john@example.com"
                />
            </div>

            <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                    Password
                </label>
                <input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                    required
                    minLength={6}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="Min 6 characters"
                />
            </div>

            <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                    Role
                </label>
                <select
                    value={formData.role}
                    onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value as 'admin' | 'superintendent' }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                >
                    <option value="superintendent">Superintendent</option>
                    <option value="admin">Admin</option>
                </select>
            </div>

            {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {error}
                </div>
            )}

            {success && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
                    <CheckIcon />
                    User created successfully!
                </div>
            )}

            <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-2.5 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                    isLoading
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:from-emerald-600 hover:to-teal-600 shadow-lg shadow-emerald-500/20'
                }`}
            >
                {isLoading ? (
                    <>
                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Creating...
                    </>
                ) : (
                    <>
                        <PlusIcon className="h-4 w-4" />
                        Create User
                    </>
                )}
            </button>
        </form>
    );
};

// --- MAIN PANEL COMPONENT ---
const UserManagementPanel: React.FC<UserManagementPanelProps> = ({ projectId, isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState<TabType>('assigned');
    const [allUsers, setAllUsers] = useState<UserResponse[]>([]);
    const [assignedUsers, setAssignedUsers] = useState<UserResponse[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadUsers = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [all, assigned] = await Promise.all([
                fetchUsers(),
                fetchProjectUsers(projectId),
            ]);
            setAllUsers(all);
            setAssignedUsers(assigned);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load users');
        } finally {
            setIsLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen) {
            loadUsers();
        }
    }, [isOpen, loadUsers]);

    const handleToggleAssignment = async (user: UserResponse) => {
        setLoadingUserId(user.id);
        try {
            const isCurrentlyAssigned = assignedUsers.some(u => u.id === user.id);
            if (isCurrentlyAssigned) {
                await unassignUserFromProject(user.id, projectId);
                setAssignedUsers(prev => prev.filter(u => u.id !== user.id));
            } else {
                await assignUserToProject(user.id, projectId);
                setAssignedUsers(prev => [...prev, user]);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update assignment');
        } finally {
            setLoadingUserId(null);
        }
    };

    const handleUserCreated = (newUser: UserResponse) => {
        setAllUsers(prev => [newUser, ...prev]);
    };

    if (!isOpen) return null;

    const assignedUserIds = new Set(assignedUsers.map(u => u.id));
    const unassignedUsers = allUsers.filter(u => !assignedUserIds.has(u.id));

    return (
        <div className="absolute bottom-4 right-4 z-30 w-[400px] bg-gray-900/95 backdrop-blur-xl border border-gray-700 rounded-2xl shadow-2xl shadow-black/50 animate-fade-in-up overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-emerald-500/20 to-teal-500/20 rounded-lg border border-emerald-500/30">
                        <UsersGroupIcon className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-white">User Management</h3>
                        <p className="text-xs text-gray-400">Manage project access</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                >
                    <CloseIcon className="h-5 w-5" />
                </button>
            </div>

            {/* Tabs */}
            <div className="flex p-2 gap-1 bg-gray-800/50">
                <button
                    onClick={() => setActiveTab('assigned')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'assigned'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                    }`}
                >
                    Assigned ({assignedUsers.length})
                </button>
                <button
                    onClick={() => setActiveTab('all')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'all'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                    }`}
                >
                    Available ({unassignedUsers.length})
                </button>
                <button
                    onClick={() => setActiveTab('create')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'create'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-700/50'
                    }`}
                >
                    <PlusIcon className="h-4 w-4 inline mr-1" />
                    New
                </button>
            </div>

            {/* Content */}
            <div className="p-4 max-h-[400px] overflow-y-auto">
                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {isLoading && activeTab !== 'create' ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : activeTab === 'assigned' ? (
                    assignedUsers.length > 0 ? (
                        <div className="space-y-2">
                            {assignedUsers.map(user => (
                                <UserCard
                                    key={user.id}
                                    user={user}
                                    isAssigned={true}
                                    onToggleAssignment={handleToggleAssignment}
                                    isLoading={loadingUserId === user.id}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <div className="w-12 h-12 mx-auto mb-3 bg-gray-800 rounded-full flex items-center justify-center">
                                <UsersGroupIcon className="h-6 w-6 text-gray-500" />
                            </div>
                            <p className="text-gray-400 text-sm">No users assigned to this project</p>
                            <button
                                onClick={() => setActiveTab('all')}
                                className="mt-3 text-emerald-400 text-sm font-semibold hover:text-emerald-300"
                            >
                                Add users from the Available tab
                            </button>
                        </div>
                    )
                ) : activeTab === 'all' ? (
                    unassignedUsers.length > 0 ? (
                        <div className="space-y-2">
                            {unassignedUsers.map(user => (
                                <UserCard
                                    key={user.id}
                                    user={user}
                                    isAssigned={false}
                                    onToggleAssignment={handleToggleAssignment}
                                    isLoading={loadingUserId === user.id}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <div className="w-12 h-12 mx-auto mb-3 bg-gray-800 rounded-full flex items-center justify-center">
                                <CheckIcon className="h-6 w-6 text-emerald-500" />
                            </div>
                            <p className="text-gray-400 text-sm">All users are already assigned</p>
                            <button
                                onClick={() => setActiveTab('create')}
                                className="mt-3 text-emerald-400 text-sm font-semibold hover:text-emerald-300"
                            >
                                Create a new user
                            </button>
                        </div>
                    )
                ) : (
                    <CreateUserForm onUserCreated={handleUserCreated} />
                )}
            </div>
        </div>
    );
};

export default UserManagementPanel;

