import React, { useState } from 'react';
import { User, UserRole } from '../types';
import { X, UserPlus, Shield, User as UserIcon, Lock, Phone } from 'lucide-react';

interface AdminMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    phone: string;
    password: string;
    role: UserRole;
  }) => Promise<void>;
  loading: boolean;
}

export const AdminMemberModal: React.FC<AdminMemberModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  loading,
}) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('member');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !password.trim()) {
      setErrorMsg('جميع الحقول مطلوبة');
      return;
    }
    setErrorMsg('');
    try {
      await onSubmit({
        name: name.trim(),
        phone: phone.trim(),
        password: password.trim(),
        role,
      });
      setName('');
      setPhone('');
      setPassword('');
      setRole('member');
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء إضافة العضو');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-emerald-700" />
              إضافة عضو أو مشرف جديد
            </h2>
            <p className="text-xs text-stone-500">
              لا يوجد تسجيل ذاتي، المشرف فقط يضيف الحسابات
            </p>
          </div>
          <button
            onClick={onClose}
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
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              الاسم الكامل *
            </label>
            <input
              id="new-member-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: عبد الله محمد"
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              رقم الهاتف (يُستخدم كمعرّف لتسجيل الدخول) *
            </label>
            <div className="relative">
              <input
                id="new-member-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="مثال: 01012345678"
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs pl-8"
                required
              />
              <Phone className="w-4 h-4 text-stone-400 absolute left-2.5 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              كلمة المرور الأولية *
            </label>
            <div className="relative">
              <input
                id="new-member-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="مثال: pass123"
                className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs pl-8"
                required
              />
              <Lock className="w-4 h-4 text-stone-400 absolute left-2.5 top-3" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              الدور والصلاحيات *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('member')}
                className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition text-right ${
                  role === 'member'
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                    : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
                }`}
              >
                <UserIcon className="w-4 h-4 text-emerald-700 shrink-0" />
                <div>
                  <div>عضو حافظ</div>
                  <div className="text-[10px] font-normal text-stone-500">يُسمِّع ويراجع</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition text-right ${
                  role === 'admin'
                    ? 'border-amber-600 bg-amber-50 text-amber-900'
                    : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
                }`}
              >
                <Shield className="w-4 h-4 text-amber-600 shrink-0" />
                <div>
                  <div>مشرف إداري</div>
                  <div className="text-[10px] font-normal text-stone-500">رقابي/إداري فقط</div>
                </div>
              </button>
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
            >
              إلغاء
            </button>
            <button
              id="confirm-add-member-btn"
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'جاري الإضافة...' : 'إضافة الحساب'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
