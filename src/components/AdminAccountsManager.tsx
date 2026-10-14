import React, { useCallback, useEffect, useState } from 'react';
import { AdminAccount, Batch } from '../types';
import { api } from '../api/client';
import { BatchCheckboxList } from './BatchCheckboxList';
import { Shield, Crown, Layers, RefreshCw, X, Pencil } from 'lucide-react';

interface AdminAccountsManagerProps {
  batches: Batch[];
  currentUserId: string;
  onChanged: () => void;
}

// Master-admin only: lists every admin account and lets the master
// change which batches a batch admin manages.
export const AdminAccountsManager: React.FC<AdminAccountsManagerProps> = ({
  batches,
  currentUserId,
  onChanged,
}) => {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [editBatchIds, setEditBatchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await api.adminListAdmins();
      setAdmins(res.admins);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل حسابات المشرفات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const batchName = (id: string) => batches.find((b) => b.id === id)?.name || 'دفعة مؤرشفة';

  const openEdit = (account: AdminAccount) => {
    setEditing(account);
    setEditBatchIds(account.batch_ids);
    setEditError('');
  };

  const handleSave = async () => {
    if (!editing) return;
    if (editBatchIds.length === 0) {
      setEditError('يرجى اختيار دفعة واحدة على الأقل');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await api.adminUpdateMember(editing.user.id, { batch_ids: editBatchIds });
      setEditing(null);
      await loadAdmins();
      onChanged();
    } catch (err: any) {
      setEditError(err?.message || 'تعذر حفظ الصلاحيات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-700" />
            <span>المشرفات وصلاحيات الدفعات</span>
          </h3>
          <p className="text-xs text-stone-500 mt-0.5">
            المشرفة العامة تدير جميع الدفعات، ومشرفة الدفعة ترى الدفعات المعيّنة لها فقط
          </p>
        </div>
        <button
          onClick={loadAdmins}
          className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition shrink-0"
          title="تحديث"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {errorMsg && <p className="text-xs text-rose-600 font-medium">{errorMsg}</p>}

      <div className="divide-y divide-stone-100 border-t border-stone-100">
        {!loading && admins.length === 0 && !errorMsg && (
          <p className="text-xs text-stone-400 py-4 text-center">لا توجد حسابات مشرفات</p>
        )}
        {admins.map((account) => (
          <div
            key={account.user.id}
            className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
          >
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-stone-900">{account.user.name}</span>
                {account.is_master_admin ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] bg-amber-50 text-amber-900 border border-amber-200">
                    <Crown className="w-3 h-3 text-amber-600" />
                    مشرفة عامة
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-[10px] bg-rose-50 text-rose-800 border border-rose-200">
                    <Layers className="w-3 h-3 text-rose-600" />
                    مشرفة دفعة
                  </span>
                )}
                {!account.user.is_active && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] bg-stone-100 text-stone-500">غير نشطة</span>
                )}
                {account.user.id === currentUserId && (
                  <span className="text-[10px] text-stone-400">(حسابكِ)</span>
                )}
              </div>
              {!account.is_master_admin && (
                <div className="flex items-center gap-1 flex-wrap">
                  {account.batch_ids.length === 0 ? (
                    <span className="text-[11px] text-amber-700">غير معيّنة على أي دفعة</span>
                  ) : (
                    account.batch_ids.map((id) => (
                      <span
                        key={id}
                        className="px-2 py-0.5 rounded-full text-[10px] bg-pink-50 text-pink-800 border border-pink-100"
                      >
                        {batchName(id)}
                      </span>
                    ))
                  )}
                </div>
              )}
            </div>

            {!account.is_master_admin && (
              <button
                onClick={() => openEdit(account)}
                className="self-start sm:self-auto px-3 py-1.5 rounded-xl text-[11px] font-bold bg-stone-100 hover:bg-stone-200 text-stone-700 flex items-center gap-1.5 transition shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>تعديل الدفعات</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-sm text-stone-900">دفعات المشرفة</h3>
                <p className="text-xs text-stone-500">{editing.user.name}</p>
              </div>
              <button
                onClick={() => setEditing(null)}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                  {editError}
                </div>
              )}
              <BatchCheckboxList batches={batches} selectedIds={editBatchIds} onChange={setEditBatchIds} />
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
