import React, { useCallback, useEffect, useState } from 'react';
import { AdminAccount, AdminAccountUpdate, Batch } from '../types';
import { api } from '../api/client';
import { BatchCheckboxList } from './BatchCheckboxList';
import { EditMemberModal } from './EditMemberModal';
import {
  Shield,
  Crown,
  Layers,
  RefreshCw,
  X,
  Pencil,
  UserMinus,
  RotateCcw,
  Trash2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

interface AdminAccountsManagerProps {
  batches: Batch[];
  currentUserId: string;
  onChanged: () => void;
}

type ConfirmAction =
  | { kind: 'deactivate'; account: AdminAccount }
  | { kind: 'reactivate'; account: AdminAccount }
  | { kind: 'delete'; account: AdminAccount };

const DELETE_CONFIRM_TEXT = 'حذف نهائي';

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

  // Batch assignments
  const [editingBatches, setEditingBatches] = useState<AdminAccount | null>(null);
  const [editBatchIds, setEditBatchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Name / phone / password
  const [editingAccount, setEditingAccount] = useState<AdminAccount | null>(null);

  // Deactivate / reactivate / delete
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirming, setConfirming] = useState(false);

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

  const openEditBatches = (account: AdminAccount) => {
    setEditingBatches(account);
    setEditBatchIds(account.batch_ids);
    setEditError('');
  };

  const handleSaveBatches = async () => {
    if (!editingBatches || saving) return;
    if (editBatchIds.length === 0) {
      setEditError('يرجى اختيار دفعة واحدة على الأقل');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await api.adminUpdateMember(editingBatches.user.id, { batch_ids: editBatchIds });
      setEditingBatches(null);
      await afterChange(`تم تحديث دفعات المشرفة "${editingBatches.user.name}" بنجاح.`);
    } catch (err: any) {
      setEditError(err?.message || 'تعذر حفظ الصلاحيات');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccount = async (payload: AdminAccountUpdate) => {
    if (!editingAccount) return;
    const newName = payload.name ?? editingAccount.user.name;
    await api.adminUpdateMember(editingAccount.user.id, payload);
    await afterChange(`تم تحديث بيانات المشرفة "${newName}" بنجاح.`);
  };

  const openConfirm = (action: ConfirmAction) => {
    setConfirmAction(action);
    setConfirmText('');
    setConfirmError('');
  };

  const handleConfirm = async () => {
    if (!confirmAction || confirming) return;
    const { kind, account } = confirmAction;

    if (kind === 'delete' && confirmText.trim() !== DELETE_CONFIRM_TEXT) {
      setConfirmError(`يرجى كتابة "${DELETE_CONFIRM_TEXT}" للتأكيد.`);
      return;
    }

    setConfirming(true);
    setConfirmError('');
    try {
      if (kind === 'delete') {
        await api.adminDeleteMemberCompletely(account.user.id);
        setConfirmAction(null);
        await afterChange(`تم حذف حساب المشرفة "${account.user.name}" نهائيًا.`);
      } else {
        const activate = kind === 'reactivate';
        await api.adminUpdateMember(account.user.id, { is_active: activate });
        setConfirmAction(null);
        await afterChange(
          activate
            ? `تمت إعادة تفعيل المشرفة "${account.user.name}" مع الاحتفاظ بدفعاتها.`
            : `تم إقصاء المشرفة "${account.user.name}" مؤقتًا مع الاحتفاظ بدفعاتها.`
        );
      }
    } catch (err: any) {
      setConfirmError(err?.message || 'تعذر تنفيذ الإجراء');
    } finally {
      setConfirming(false);
    }
  };

  const actionButton =
    'px-2.5 py-1 rounded-lg text-[11px] font-bold border flex items-center gap-1 transition cursor-pointer whitespace-nowrap';

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
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  <button
                    onClick={() => setEditingAccount(account)}
                    className={`${actionButton} bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-200`}
                    title="تعديل الاسم ورقم الهاتف وكلمة المرور"
                  >
                    <Pencil className="w-3.5 h-3.5 text-stone-500" />
                    <span>تعديل</span>
                  </button>
                  <button
                    onClick={() => openEditBatches(account)}
                    className={`${actionButton} bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-200`}
                  >
                    <Layers className="w-3.5 h-3.5 text-stone-500" />
                    <span>تعديل الدفعات</span>
                  </button>
                  {account.user.is_active ? (
                    <button
                      onClick={() => openConfirm({ kind: 'deactivate', account })}
                      className={`${actionButton} bg-amber-50 hover:bg-amber-100 text-amber-800 border-amber-200`}
                    >
                      <UserMinus className="w-3.5 h-3.5 text-amber-700" />
                      <span>إقصاء</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => openConfirm({ kind: 'reactivate', account })}
                      className={`${actionButton} bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200`}
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-emerald-700" />
                      <span>إعادة التفعيل</span>
                    </button>
                  )}
                  <button
                    onClick={() => openConfirm({ kind: 'delete', account })}
                    className={`${actionButton} bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>حذف نهائي</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Name / phone / password */}
      <EditMemberModal
        member={editingAccount?.user ?? null}
        accountKind="admin"
        onClose={() => setEditingAccount(null)}
        onSubmit={handleSaveAccount}
      />

      {/* Batch assignments */}
      {editingBatches && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-sm text-stone-900">دفعات المشرفة</h3>
                <p className="text-xs text-stone-500">{editingBatches.user.name}</p>
              </div>
              <button
                onClick={() => !saving && setEditingBatches(null)}
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
                  onClick={() => setEditingBatches(null)}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveBatches}
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

      {/* Deactivate / reactivate / delete confirmation */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl ${
                  confirmAction.kind === 'reactivate' ? 'bg-emerald-100' : confirmAction.kind === 'delete' ? 'bg-rose-100' : 'bg-amber-100'
                }`}
              >
                {confirmAction.kind === 'reactivate' ? (
                  <RotateCcw className="w-6 h-6 text-emerald-700" />
                ) : (
                  <AlertCircle className={`w-6 h-6 ${confirmAction.kind === 'delete' ? 'text-rose-700' : 'text-amber-700'}`} />
                )}
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">
                  {confirmAction.kind === 'deactivate'
                    ? 'تأكيد إقصاء المشرفة'
                    : confirmAction.kind === 'reactivate'
                    ? 'تأكيد إعادة تفعيل المشرفة'
                    : 'تأكيد الحذف النهائي للمشرفة'}
                </h3>
                <p className="text-xs text-stone-500 font-semibold">{confirmAction.account.user.name}</p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              {confirmAction.kind === 'deactivate'
                ? 'لن تتمكن المشرفة من تسجيل الدخول أو الوصول لأي دفعة. تبقى دفعاتها المعيّنة محفوظة وتعود إليها عند إعادة التفعيل.'
                : confirmAction.kind === 'reactivate'
                ? 'ستتمكن المشرفة من تسجيل الدخول مجددًا وإدارة الدفعات المعيّنة لها سابقًا.'
                : 'سيتم حذف حساب المشرفة ودخولها وتعييناتها نهائيًا. تبقى سجلات البرنامج التي أنشأتها (الدورات، أيام الراحة، الخواطر...) محفوظة دون اسمها. لا يمكن التراجع عن هذا الإجراء.'}
            </p>

            {confirmAction.kind === 'delete' && (
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1.5">
                  لتأكيد الحذف، اكتبي: <span className="font-mono text-rose-700">{DELETE_CONFIRM_TEXT}</span>
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={DELETE_CONFIRM_TEXT}
                  className="w-full px-3.5 py-2 rounded-xl border border-stone-300 text-xs outline-hidden"
                />
              </div>
            )}

            {confirmError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">{confirmError}</div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => !confirming && setConfirmAction(null)}
                disabled={confirming}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirming || (confirmAction.kind === 'delete' && confirmText.trim() !== DELETE_CONFIRM_TEXT)}
                className={`px-5 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition disabled:opacity-40 ${
                  confirmAction.kind === 'reactivate'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : confirmAction.kind === 'delete'
                    ? 'bg-rose-700 hover:bg-rose-800'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {confirming
                  ? 'جاري التنفيذ...'
                  : confirmAction.kind === 'deactivate'
                  ? 'تأكيد الإقصاء'
                  : confirmAction.kind === 'reactivate'
                  ? 'تأكيد إعادة التفعيل'
                  : 'تأكيد الحذف النهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
