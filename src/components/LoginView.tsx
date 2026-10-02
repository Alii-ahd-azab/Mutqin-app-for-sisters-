import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, Phone, ArrowLeft } from 'lucide-react';
import { SistersLogo } from './SistersLogo';

export const LoginView: React.FC = () => {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!phone.trim() || !password.trim()) {
    setErrorMsg('يرجى إدخال رقم الهاتف وكلمة المرور');
    return;
  }

  setErrorMsg('');
  setLoading(true);

  try {
    const result = await login(
      phone.trim(),
      password.trim()
    );

    if (result.error) {
      setErrorMsg(result.error);
    }
  } catch (err: any) {
    setErrorMsg(
      err?.message || 'فشل تسجيل الدخول. تحقق من بياناتك.'
    );
  } finally {
    setLoading(false);
  }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-50/70 via-rose-50/30 to-stone-100 flex flex-col justify-center items-center p-4 selection:bg-pink-200">
      <div className="w-full max-w-md space-y-6">
        {/* App Logo & Quranic Verse */}
        <div className="text-center space-y-3">
          <div className="inline-flex justify-center">
            <SistersLogo size="xl" className="shadow-md ring-4 ring-pink-100/80" />
          </div>
          <div>
            <h1 className="text-3xl font-bold font-quran text-stone-900 tracking-tight">
              مُتْقِن للنساء
            </h1>
            <p className="text-xs text-pink-600 font-semibold mt-1">
              مقرأة القرآن الكريم للأخوات والحافظات
            </p>
          </div>
          <p className="font-quran text-rose-800 text-sm">
            ﴿ إِنَّ هَـٰذَا الْقُرْآنَ يَهْدِي لِلَّتِي هِيَ أَقْوَمُ ﴾
          </p>
          <p className="text-xs text-stone-500 max-w-xs mx-auto">
            منظومة الحفظ والمراجعة اليومية الجماعية عبر التسميع المتبادل بين الأخوات
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-3xl border border-pink-100 shadow-lg shadow-pink-100/50 p-6 sm:p-8 space-y-5">
          <div className="border-b border-pink-50 pb-3">
            <h2 className="text-base font-bold text-stone-900">تسجيل الدخول للمقرأة</h2>
            <p className="text-xs text-stone-400">
              أدخلي رقم الهاتف وكلمة المرور المسجلة من قِبل المشرفة
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-stone-700 mb-1.5">
                رقم الهاتف (معرف الدخول)
              </label>
              <div className="relative">
                <input
                  id="login-phone-input"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01000000001"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-pink-200/80 bg-pink-50/20 focus:bg-white focus:border-pink-500 focus:ring-2 focus:ring-pink-100 transition outline-hidden pl-8"
                  required
                />
                <Phone className="w-4 h-4 text-pink-400 absolute left-2.5 top-3" />
              </div>
            </div>

            <div>
              <label className="block font-bold text-stone-700 mb-1.5">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  id="login-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-pink-200/80 bg-pink-50/20 focus:bg-white focus:border-pink-500 focus:ring-2 focus:ring-pink-100 transition outline-hidden pl-8"
                  required
                />
                <Lock className="w-4 h-4 text-pink-400 absolute left-2.5 top-3" />
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-pink-500 to-rose-400 hover:from-pink-600 hover:to-rose-500 text-white font-bold text-xs shadow-md shadow-pink-200/60 transition flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer active:scale-98"
            >
              <span>{loading ? 'جاري التحقق...' : 'دخول المقرأة'}</span>
              <ArrowLeft className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Footer Guidance */}
        <div className="text-center text-[11px] text-stone-400 space-y-1">
          <p>إذا كنتِ عضوة جديدة يرجى التواصل مع المشرفة لإضافتك في المقرأة</p>
          <p>© {new Date().getFullYear()} مُتْقِن للنساء — جميع الحقوق محفوظة</p>
        </div>
      </div>
    </div>
  );
};
