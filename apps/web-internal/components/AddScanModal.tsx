import React, { useState, useEffect } from 'react';

interface AddScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddScan: (date: string) => void;
}

const AddScanModal: React.FC<AddScanModalProps> = ({ isOpen, onClose, onAddScan }) => {
  const [date, setDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      // Pre-fill with today's date when the modal opens
      setDate(new Date().toISOString().split('T')[0]);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (date) {
      onAddScan(date);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-scan-title">
      <div className="bg-[#1a1f2e] rounded-xl border border-[#2d3748] p-8 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 id="add-scan-title" className="text-2xl font-bold mb-4">Add New Scan</h2>
        <p className="text-gray-400 mb-6">Select the date for the new construction scan.</p>
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label htmlFor="scan-date" className="block text-sm font-medium text-gray-300 mb-2">Scan Date</label>
            <input
              type="date"
              id="scan-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-[#0f1419] border border-[#2d3748] rounded-lg py-2 px-4 w-full focus:outline-none focus:ring-2 focus:ring-[#4299e1] text-white"
              required
              aria-required="true"
            />
          </div>
          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!date}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
            >
              Add Scan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddScanModal;
