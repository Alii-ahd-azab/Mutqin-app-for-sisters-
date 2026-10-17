import React, { useEffect, useState } from 'react';
import { AdminAccountUpdate, User } from '../types';
import { normalizePhone } from '../lib/authHelpers';
import { X, Pencil, Lock, Phone } from 'lucide-react';

interface EditMemberModalProps {
  member: User | null;
  onClose: () => void;
  // Sends only the changed fields; all changes are applied by the
  // admin-users Edge Function.
  onSubmit: (payload: AdminAccountUpdate) => Promise<void>;
}

export const EditMemberModal: React.FC<EditMemberModalProps> = ({
  member,
  onClose,
  onSubmit,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // Prefill with the member's current data each time the modal opens.
  useEffect(() => {
    if (member) {
      setName(member.name);
      setPhone(member.phone);
      setPassword('');
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

    const trimmedName = name.trim();
    const normalizedPhone = normalizePhone(phone);
    const trimmedPassword = password.trim();

    if (!trimmedName) {
      setErrorMsg('الاسم مطلوب');
      return;
    }
    if (!normalizedPhone) {
      setErrorMsg('رقم الهاتف مطلوب');
      return;
    }
    if (trimmedPassword && trimmedPassword.length < 6) {
      setErrorMsg('كلمة المرور يجب أن تكون 6 أحرف أو أكثر');
      return;
    }

    const payload: AdminAccountUpdate = {};
    if (trimmedName !== member.name) payload.name = trimmedName;
    if (normalizedPhone !== member.phone) payload.phone = normalizedPhone;
    if (trimmedPassword) payload.password = trimmedPassword;

    if (Object.keys(payload).length === 0) {
      setErrorMsg('لا توجد تغييرات للحفظ');
      return;
    }

    setErrorMsg('');
    setSaving(true);
    try {
      await onSubmit(payload);
      setSaving(false);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر حفظ التعديلات');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <Pencil className="w-5 h-5 text-emerald-700" />
              تعديل بيانات العضوة
            </h2>
            <p className="text-xs text-stone-500">
              تبقى العضوة في دفعتها نفسها مع جميع سجلاتها
            </p>
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

          <div>
            <label htmlFor="edit-member-name" className="block text-xs font-bold text-stone-700 mb-1.5">
              الاسم الكامل *
            </label>
            <input
              id="edit-member-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs"
              required
            />
          </div>

          <div>
            <label htmlFor="edit-member-phone" className="block text-xs font-bold text-stone-700 mb-1.5">
              رقم الهاتف (يُستخدم لتسجيل الدخول) *
            </label>
            <div className="relative">
              <input
                id="edit-member-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs pl-8"
                required
              />
              <Phone className="w-4 h-4 text-stone-400 absolute left-2.5 top-3" />
            </div>
            <p className="mt-1 text-[10px] text-stone-500">
              عند تغيير الرقم تسجّل العضوة الدخول بالرقم الجديد فقط.
            </p>
          </div>

          <div>
            <label htmlFor="edit-member-password" className="block text-xs font-bold text-stone-700 mb-1.5">
              كلمة مرور جديدة (اختياري)
            </label>
            <div className="relative">
              <input
                id="edit-member-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="اتركيه فارغًا للإبقاء على كلمة المرور الحالية"
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs pl-8"
              />
              <Lock className="w-4 h-4 text-stone-400 absolute left-2.5 top-3" />
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
              id="confirm-edit-member-btn"
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
