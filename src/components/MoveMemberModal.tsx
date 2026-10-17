import React, { useEffect, useState } from 'react';
import { Batch, User } from '../types';
import { X, ArrowLeftRight, Layers, AlertCircle } from 'lucide-react';

interface MoveMemberModalProps {
  member: User | null;
  currentBatch: Batch;
  // Batches the admin may move members into (current batch excluded here)
  batches: Batch[];
  onClose: () => void;
  onSubmit: (destinationBatchId: string) => Promise<void>;
}

export const MoveMemberModal: React.FC<MoveMemberModalProps> = ({
  member,
  currentBatch,
  batches,
  onClose,
  onSubmit,
}) => {
  const destinations = batches.filter((b) => b.id !== currentBatch.id);

  const [destinationId, setDestinationId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (member) {
      setDestinationId('');
      setErrorMsg('');
      setSaving(false);
    }
  }, [member]);

  if (!member) return null;

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!destinationId) {
      setErrorMsg('يرجى اختيار الدفعة الجديدة');
      return;
    }

    setErrorMsg('');
    setSaving(true);
    try {
      await onSubmit(destinationId);
      setSaving(false);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر نقل العضوة');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-emerald-700" />
              نقل إلى دفعة أخرى
            </h2>
            <p className="text-xs text-stone-500">{member.name}</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-sm overflow-y-auto">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="block text-stone-500 mb-0.5">العضوة</span>
              <span className="font-bold text-stone-900">{member.name}</span>
            </div>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
              <span className="block text-stone-500 mb-0.5">الدفعة الحالية</span>
              <span className="font-bold text-stone-900">{currentBatch.name}</span>
            </div>
          </div>

          <div>
            <label htmlFor="move-member-destination" className="block text-xs font-bold text-stone-700 mb-1.5">
              الدفعة الجديدة *
            </label>
            {destinations.length === 0 ? (
              <p className="text-xs text-stone-500">لا توجد دفعة أخرى متاحة لكِ للنقل إليها.</p>
            ) : (
              <div className="relative">
                <select
                  id="move-member-destination"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  disabled={saving}
                  className="w-full appearance-none px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs pl-8 cursor-pointer"
                  required
                >
                  <option value="" disabled>
                    اختر الدفعة
                  </option>
                  {destinations.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.name}
                    </option>
                  ))}
                </select>
                <Layers className="w-4 h-4 text-stone-400 absolute left-2.5 top-3 pointer-events-none" />
              </div>
            )}
          </div>

          <div className="rounded-xl bg-amber-50/80 border border-amber-200 p-3 text-[11px] text-amber-900 leading-relaxed flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">
                سيتم نقل العضوة إلى الدفعة الجديدة مع الاحتفاظ بسجلها السابق في الدفعة الحالية.
              </p>
              <p>
                • تبقى بيانات دخولها وحالتها (نشطة/مُقصاة) كما هي.
                <br />
                • المراجعة في الدفعة الجديدة تبدأ من تاريخ النقل، أما أرباع التسميع التي سبق أن وصلت إليها الدفعة الجديدة فتبقى مطلوبة منها.
              </p>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={handleClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              id="confirm-move-member-btn"
              type="submit"
              disabled={saving || destinations.length === 0}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'جاري النقل...' : 'تأكيد النقل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
