import React, { useState } from 'react';
import { AdminAccountUpdate, Batch, User } from '../types';
import { api } from '../api/client';
import { BatchCheckboxList } from './BatchCheckboxList';
import { EditMemberModal } from './EditMemberModal';
import { ACTION_TONE, ACTION_ICON, CONFIRM_TONE } from './actionButtonStyles';
import { Layers, X, Pencil, UserMinus, RotateCcw, Trash2, AlertCircle } from 'lucide-react';

interface BatchAdminActionsProps {
  // A BATCH admin account (never a master admin, never the current user).
  // Render this only for master admins; the admin-users Edge Function
  // re-checks master status on every action.
  account: User;
  // Her current assignments if already known; otherwise loaded on demand.
  batchIds?: string[];
  batches: Batch[];
  onChanged: (message: string) => void | Promise<void>;
}

type ConfirmKind = 'deactivate' | 'reactivate' | 'delete';

const DELETE_CONFIRM_TEXT = 'حذف نهائي';

const actionButton =
  'px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap';

export const BatchAdminActions: React.FC<BatchAdminActionsProps> = ({
  account,
  batchIds,
  batches,
  onChanged,
}) => {
  const [editingAccount, setEditingAccount] = useState(false);

  const [editingBatches, setEditingBatches] = useState(false);
  const [editBatchIds, setEditBatchIds] = useState<string[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const openEditBatches = async () => {
    setEditError('');
    setEditingBatches(true);
    if (batchIds) {
      setEditBatchIds(batchIds);
      return;
    }
    // Not known in this view (e.g. the members table): load from the server.
    setLoadingBatches(true);
    try {
      const res = await api.adminListAdmins();
      setEditBatchIds(res.admins.find((a) => a.user.id === account.id)?.batch_ids ?? []);
    } catch (err: any) {
      setEditError(err?.message || 'تعذر تحميل دفعات المشرفة');
    } finally {
      setLoadingBatches(false);
    }
  };

  const handleSaveBatches = async () => {
    if (saving || loadingBatches) return;
    if (editBatchIds.length === 0) {
      setEditError('يرجى اختيار دفعة واحدة على الأقل');
      return;
    }
    setSaving(true);
    setEditError('');
    try {
      await api.adminUpdateMember(account.id, { batch_ids: editBatchIds });
      setEditingBatches(false);
      await onChanged(`تم تحديث دفعات المشرفة "${account.name}" بنجاح.`);
    } catch (err: any) {
      setEditError(err?.message || 'تعذر حفظ الصلاحيات');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccount = async (payload: AdminAccountUpdate) => {
    const newName = payload.name ?? account.name;
    await api.adminUpdateMember(account.id, payload);
    await onChanged(`تم تحديث بيانات المشرفة "${newName}" بنجاح.`);
  };

  const openConfirm = (kind: ConfirmKind) => {
    setConfirmKind(kind);
    setConfirmText('');
    setConfirmError('');
  };

  const handleConfirm = async () => {
    if (!confirmKind || confirming) return;

    if (confirmKind === 'delete' && confirmText.trim() !== DELETE_CONFIRM_TEXT) {
      setConfirmError(`يرجى كتابة "${DELETE_CONFIRM_TEXT}" للتأكيد.`);
      return;
    }

    setConfirming(true);
    setConfirmError('');
    try {
      if (confirmKind === 'delete') {
        await api.adminDeleteMemberCompletely(account.id);
        setConfirmKind(null);
        await onChanged(`تم حذف حساب المشرفة "${account.name}" نهائيًا.`);
      } else {
        const activate = confirmKind === 'reactivate';
        await api.adminUpdateMember(account.id, { is_active: activate });
        setConfirmKind(null);
        await onChanged(
          activate
            ? `تمت إعادة تفعيل المشرفة "${account.name}" مع الاحتفاظ بدفعاتها.`
            : `تم إقصاء المشرفة "${account.name}" مؤقتًا مع الاحتفاظ بدفعاتها.`
        );
      }
    } catch (err: any) {
      setConfirmError(err?.message || 'تعذر تنفيذ الإجراء');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setEditingAccount(true)}
          className={`${actionButton} ${ACTION_TONE.edit}`}
          title="تعديل الاسم ورقم الهاتف وكلمة المرور"
        >
          <Pencil className={`w-3.5 h-3.5 ${ACTION_ICON.edit}`} />
          <span>تعديل</span>
        </button>
        <button
          onClick={openEditBatches}
          className={`${actionButton} ${ACTION_TONE.batches}`}
        >
          <Layers className={`w-3.5 h-3.5 ${ACTION_ICON.batches}`} />
          <span>تعديل الدفعات</span>
        </button>
        {account.is_active ? (
          <button
            onClick={() => openConfirm('deactivate')}
            className={`${actionButton} ${ACTION_TONE.exclude}`}
          >
            <UserMinus className={`w-3.5 h-3.5 ${ACTION_ICON.exclude}`} />
            <span>إقصاء</span>
          </button>
        ) : (
          <button
            onClick={() => openConfirm('reactivate')}
            className={`${actionButton} ${ACTION_TONE.reactivate}`}
          >
            <RotateCcw className={`w-3.5 h-3.5 ${ACTION_ICON.reactivate}`} />
            <span>إعادة التفعيل</span>
          </button>
        )}
        <button
          onClick={() => openConfirm('delete')}
          className={`${actionButton} ${ACTION_TONE.delete}`}
        >
          <Trash2 className={`w-3.5 h-3.5 ${ACTION_ICON.delete}`} />
          <span>حذف نهائي</span>
        </button>
      </div>

      {/* Name / phone / password */}
      <EditMemberModal
        member={editingAccount ? account : null}
        accountKind="admin"
        onClose={() => setEditingAccount(false)}
        onSubmit={handleSaveAccount}
      />

      {/* Batch assignments */}
      {editingBatches && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 text-right">
            <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
              <div>
                <h3 className="font-bold text-sm text-stone-900">دفعات المشرفة</h3>
                <p className="text-xs text-stone-500">{account.name}</p>
              </div>
              <button
                onClick={() => !saving && setEditingBatches(false)}
                className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {editError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">{editError}</div>
              )}
              {loadingBatches ? (
                <p className="text-xs text-stone-500 py-4 text-center">جاري تحميل الدفعات...</p>
              ) : (
                <BatchCheckboxList batches={batches} selectedIds={editBatchIds} onChange={setEditBatchIds} />
              )}
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  onClick={() => setEditingBatches(false)}
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleSaveBatches}
                  disabled={saving || loadingBatches}
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
      {confirmKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 p-6 space-y-4 text-right">
            <div className="flex items-center gap-3">
              <div
                className={`p-2.5 rounded-xl ${
                  confirmKind === 'reactivate' ? 'bg-emerald-100' : confirmKind === 'delete' ? 'bg-rose-100' : 'bg-amber-100'
                }`}
              >
                {confirmKind === 'reactivate' ? (
                  <RotateCcw className="w-6 h-6 text-emerald-700" />
                ) : (
                  <AlertCircle className={`w-6 h-6 ${confirmKind === 'delete' ? 'text-rose-700' : 'text-amber-700'}`} />
                )}
              </div>
              <div>
                <h3 className="font-bold text-base text-stone-900">
                  {confirmKind === 'deactivate'
                    ? 'تأكيد إقصاء المشرفة'
                    : confirmKind === 'reactivate'
                    ? 'تأكيد إعادة تفعيل المشرفة'
                    : 'تأكيد الحذف النهائي للمشرفة'}
                </h3>
                <p className="text-xs text-stone-500 font-semibold">{account.name}</p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              {confirmKind === 'deactivate'
                ? 'لن تتمكن المشرفة من تسجيل الدخول أو الوصول لأي دفعة. تبقى دفعاتها المعيّنة محفوظة وتعود إليها عند إعادة التفعيل.'
                : confirmKind === 'reactivate'
                ? 'ستتمكن المشرفة من تسجيل الدخول مجددًا وإدارة الدفعات المعيّنة لها سابقًا.'
                : 'سيتم حذف حساب المشرفة ودخولها وتعييناتها نهائيًا. تبقى سجلات البرنامج التي أنشأتها (الدورات، أيام الراحة، الخواطر...) محفوظة دون اسمها. لا يمكن التراجع عن هذا الإجراء.'}
            </p>

            {confirmKind === 'delete' && (
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
                onClick={() => !confirming && setConfirmKind(null)}
                disabled={confirming}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={confirming || (confirmKind === 'delete' && confirmText.trim() !== DELETE_CONFIRM_TEXT)}
                className={`px-5 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition disabled:opacity-40 ${
                  confirmKind === 'reactivate'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : confirmKind === 'delete'
                    ? CONFIRM_TONE.delete
                    : CONFIRM_TONE.exclude
                }`}
              >
                {confirming
                  ? 'جاري التنفيذ...'
                  : confirmKind === 'deactivate'
                  ? 'تأكيد الإقصاء'
                  : confirmKind === 'reactivate'
                  ? 'تأكيد إعادة التفعيل'
                  : 'تأكيد الحذف النهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
