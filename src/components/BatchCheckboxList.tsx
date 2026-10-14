import React from 'react';
import { Batch } from '../types';
import { Check } from 'lucide-react';

interface BatchCheckboxListProps {
  batches: Batch[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export const BatchCheckboxList: React.FC<BatchCheckboxListProps> = ({
  batches,
  selectedIds,
  onChange,
}) => {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
    );
  };

  if (batches.length === 0) {
    return <p className="text-xs text-stone-500">لا توجد دفعات بعد</p>;
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 divide-y divide-stone-100 max-h-48 overflow-y-auto">
      {batches.map((batch) => {
        const checked = selectedIds.includes(batch.id);
        return (
          <label
            key={batch.id}
            className="flex items-center gap-2.5 px-3 py-2.5 text-xs cursor-pointer hover:bg-white transition"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(batch.id)}
              className="sr-only"
            />
            <span
              className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition ${
                checked ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-stone-300'
              }`}
            >
              {checked && <Check className="w-3 h-3" />}
            </span>
            <span className={checked ? 'font-bold text-stone-900' : 'text-stone-700'}>{batch.name}</span>
          </label>
        );
      })}
    </div>
  );
};
