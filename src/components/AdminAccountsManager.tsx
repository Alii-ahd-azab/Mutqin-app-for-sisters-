import React, { useCallback, useEffect, useState } from 'react';
import { AdminAccount, Batch } from '../types';
import { api } from '../api/client';
import { BatchAdminActions } from './BatchAdminActions';
import { Shield, Crown, Layers, RefreshCw, CheckCircle2 } from 'lucide-react';

interface AdminAccountsManagerProps {
  batches: Batch[];
  currentUserId: string;
  onChanged: () => void;
}

// Master-admin only: lists every admin account and lets the master fully
// manage BATCH admins (data, password, batches, deactivate/reactivate,
// permanent delete). Every change is applied by the admin-users Edge
// Function, which re-checks that the caller is a master admin.
export const AdminAccountsManager: React.FC<AdminAccountsManagerProps> = ({
  batches,
  currentUserId,
  onChanged,
}) => {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

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

  const afterChange = async (message: string) => {
    await loadAdmins();
    onChanged();
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 4000);
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

      {successMsg && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2 text-xs text-emerald-900 font-semibold">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="divide-y divide-stone-100 border-t border-stone-100">
        {!loading && admins.length === 0 && !errorMsg && (
          <p className="text-xs text-stone-400 py-4 text-center">لا توجد حسابات مشرفات</p>
        )}
        {admins.map((account) => {
          const isBatchAdmin = !account.is_master_admin;
          const canManage = isBatchAdmin && account.user.id !== currentUserId;

          return (
            <div
              key={account.user.id}
              className="py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-xs"
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
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      مُقصاة (غير نشطة)
                    </span>
                  )}
                  {account.user.id === currentUserId && (
                    <span className="text-[10px] text-stone-400">(حسابكِ)</span>
                  )}
                </div>
                {isBatchAdmin && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[11px] text-stone-500 font-mono ml-1">{account.user.phone}</span>
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

              {canManage && (
                <BatchAdminActions
                  account={account.user}
                  batchIds={account.batch_ids}
                  batches={batches}
                  onChanged={afterChange}
                />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
