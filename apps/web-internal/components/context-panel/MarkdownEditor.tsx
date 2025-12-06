import React, { useState, useEffect } from 'react';
import { SparklesIcon, CheckIcon, CloseIcon } from '../Icons';

interface MarkdownEditorProps {
    initialMarkdown: string;
    onSave: (markdown: string) => void;
    onCancel: () => void;
    onAiEdit: (instruction: string) => Promise<{ newMarkdown: string }>;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({ initialMarkdown, onSave, onCancel, onAiEdit }) => {
    const [markdown, setMarkdown] = useState(initialMarkdown);
    const [instruction, setInstruction] = useState('');
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        setMarkdown(initialMarkdown);
    }, [initialMarkdown]);

    const handleAiEdit = async () => {
        if (!instruction) return;
        setIsEditing(true);
        try {
            const result = await onAiEdit(instruction);
            setMarkdown(result.newMarkdown);
        } catch (e) {
            console.error("AI edit failed", e);
        } finally {
            setIsEditing(false);
            setInstruction('');
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700 absolute inset-0 z-20">
            <div className="p-2 border-b border-slate-700 flex justify-between bg-slate-800">
                <span className="font-semibold text-slate-300">Editor</span>
                <div className="flex space-x-2">
                    <button onClick={onCancel} className="text-slate-400 hover:text-white"><CloseIcon className="h-5 w-5"/></button>
                    <button onClick={() => onSave(markdown)} className="text-emerald-500 hover:text-emerald-400"><CheckIcon className="h-5 w-5"/></button>
                </div>
            </div>
            
            <div className="p-2 bg-slate-800 border-b border-slate-700 flex gap-2">
                <div className="relative flex-1">
                    <input 
                        className="w-full bg-slate-900 text-white text-sm rounded pl-8 pr-2 py-1 border border-slate-700 focus:border-purple-500 outline-none"
                        placeholder="Ask AI to edit..."
                        value={instruction}
                        onChange={e => setInstruction(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAiEdit()}
                        disabled={isEditing}
                    />
                    <SparklesIcon className="absolute left-2 top-1.5 h-4 w-4 text-purple-500" />
                </div>
                <button 
                    onClick={handleAiEdit} 
                    disabled={isEditing || !instruction}
                    className="bg-purple-600 text-white px-3 py-1 rounded text-sm disabled:opacity-50"
                >
                    {isEditing ? '...' : 'Apply'}
                </button>
            </div>

            <textarea 
                className="flex-1 bg-slate-900 text-slate-300 p-4 font-mono text-sm outline-none resize-none"
                value={markdown}
                onChange={e => setMarkdown(e.target.value)}
            />
        </div>
    );
};

