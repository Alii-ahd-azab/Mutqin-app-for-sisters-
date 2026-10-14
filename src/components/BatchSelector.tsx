import React, { useState } from 'react';
import { Batch } from '../types';
import { Layers, Plus, ChevronDown } from 'lucide-react';
import { CreateBatchModal } from './CreateBatchModal';

interface BatchSelectorProps {
  batches: Batch[];
  selectedBatchId: string | null;
  onSelect: (batchId: string) => void;
  canCreate: boolean;
  onBatchCreated: (batch: Batch) => Promise<void> | void;
}

export const BatchSelector: React.FC<BatchSelectorProps> = ({
  batches,
  selectedBatchId,
  onSelect,
  canCreate,
  onBatchCreated,
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="mb-5 bg-white rounded-2xl border border-pink-100 shadow-2xs p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
        <label
          htmlFor="batch-selector"
          className="text-xs font-bold text-rose-900 flex items-center gap-1.5 shrink-0"
        >
          <Layers className="w-4 h-4 text-rose-600" />
          الدفعة الحالية
        </label>

        {batches.length > 0 ? (
          <div className="relative w-full sm:w-72">
            <select
              id="batch-selector"
              value={selectedBatchId || ''}
              onChange={(e) => onSelect(e.target.value)}
              className="w-full appearance-none pl-8 pr-3.5 py-2.5 rounded-xl border border-pink-200 bg-pink-50/40 hover:bg-pink-50 focus:bg-white focus:border-rose-500 transition outline-hidden text-xs font-bold text-stone-900 cursor-pointer"
            >
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-rose-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        ) : (
          <span className="text-xs text-stone-500">لا توجد دفعات بعد</span>
        )}
      </div>

      {canCreate && (
        <button
          id="open-create-batch-btn"
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إنشاء دفعة جديدة</span>
        </button>
      )}

      <CreateBatchModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={onBatchCreated}
      />
    </div>
  );
};
