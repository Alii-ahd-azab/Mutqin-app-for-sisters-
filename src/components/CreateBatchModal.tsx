import React, { useState } from 'react';
import { Batch } from '../types';
import { api } from '../api/client';
import { programDate } from '../lib/calculations';
import { X, Layers, CalendarRange } from 'lucide-react';

interface CreateBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (batch: Batch) => Promise<void> | void;
}

export const CreateBatchModal: React.FC<CreateBatchModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(() => programDate());
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setErrorMsg('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate) {
      setErrorMsg('اسم الدفعة وتاريخ البداية مطلوبان');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      const res = await api.adminCreateBatch({ name: name.trim(), start_date: startDate });
      setName('');
      setStartDate(programDate());
      onClose();
      await onCreated(res.batch);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر إنشاء الدفعة');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <Layers className="w-5 h-5 text-rose-600" />
              إنشاء دفعة جديدة
            </h2>
            <p className="text-xs text-stone-500">
              دفعة مستقلة بأعضائها ودورتها وإحصائياتها، دون أي تأثير على الدفعات الأخرى
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div>
            <label htmlFor="new-batch-name" className="block text-xs font-bold text-stone-700 mb-1.5">
              اسم الدفعة *
            </label>
            <input
              id="new-batch-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: دفعة البشائر"
              maxLength={100}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-rose-500 transition outline-hidden text-xs"
              required
            />
          </div>

          <div>
            <label htmlFor="new-batch-start" className="block text-xs font-bold text-stone-700 mb-1.5">
              تاريخ البداية *
            </label>
            <div className="relative">
              <input
                id="new-batch-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-rose-500 transition outline-hidden text-xs"
                required
              />
            </div>
            <p className="mt-1.5 text-[11px] text-stone-500 flex items-start gap-1.5 leading-relaxed">
              <CalendarRange className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-0.5" />
              <span>
                تبدأ الدورة الأولى للدفعة في هذا التاريخ. إذا كان التاريخ مستقبليًا تظهر الدفعة في وضع «لم تبدأ بعد» حتى موعد الانطلاق.
              </span>
            </p>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
            >
              إلغاء
            </button>
            <button
              id="confirm-create-batch-btn"
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'جاري الإنشاء...' : 'إنشاء الدفعة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
