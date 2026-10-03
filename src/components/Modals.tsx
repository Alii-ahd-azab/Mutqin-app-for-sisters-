import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { User, CycleInfo, RecitationLog } from '../types';
import { getQuarterInfo, getQuarterBounds, getRangeBounds } from '../data/quranData';
import { calculateMemberRequiredQuarter } from '../lib/calculations';
import { X, CheckCircle, BookMarked, AlertCircle, Lock, Users, Key, Eye, EyeOff } from 'lucide-react';

interface RecitationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    quarter_number: number;
    listener_id: string;
    notes?: string;
  }) => Promise<void>;
  currentUser: User;
  members: User[]; // Active peers excluding current user and admins
  cycleInfo: CycleInfo;
  recitations: RecitationLog[];
  loading: boolean;
}

export const RecitationModal: React.FC<RecitationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  currentUser,
  members,
  cycleInfo,
  recitations,
  loading,
}) => {
  const [listenerId, setListenerId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Calculate required quarter for the current user
  const userQuarterStatus = calculateMemberRequiredQuarter(
    currentUser.id,
    cycleInfo.quarter_of_day,
    recitations
  );

  const quarterNumber = userQuarterStatus.requiredQuarter;
  const currentQuarterInfo = getQuarterInfo(quarterNumber);
  const recitationBounds = getQuarterBounds(quarterNumber);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setListenerId('');
      setNotes('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!listenerId) {
      setErrorMsg('يرجى اختيار الزميل المستمع من أعضاء المقرأة (لا يمكن التسميع على شخص من الخارج)');
      return;
    }

    try {
      const payload: {
        quarter_number: number;
        listener_id: string;
        notes?: string;
      } = {
        quarter_number: quarterNumber,
        listener_id: listenerId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      await onSubmit(payload);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'حدث خطأ أثناء تسجيل التسميع');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-emerald-700" />
              تسجيل تسميع ربع اليوم
            </h2>
            <p className="text-xs text-stone-500">
              تسجيل إتمامك لورد التسميع الخاص بك
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
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Quarter number (locked & automatic) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                <span>الربع المطلوب تسميعه *</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  <Lock className="w-3 h-3 text-emerald-600" />
                  مُحدد تلقائيًا بالترتيب
                </span>
              </label>
              {userQuarterStatus.isBehind && (
                <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                  تعويض ربع سابق ({quarterNumber})
                </span>
              )}
            </div>

            {userQuarterStatus.isBehind && (
              <div className="mb-2 p-2.5 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">
                    أنت متأخر عن ربع اليوم الحالي للمجموعة ({cycleInfo.quarter_of_day}).
                  </p>
                  <p className="text-[11px] text-amber-800">
                    الربع المطلوب تسميعه لك الآن هو (الربع {quarterNumber}). بعد تسجيل هذا الربع، يمكنك فورًا تسجيل الأرباع الفائتة التالية تباعًا في نفس اليوم لتلحق بجدول المجموعة.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              <div className="col-span-1 relative">
                <input
                  id="quarter-number-input"
                  type="number"
                  value={quarterNumber}
                  readOnly
                  disabled
                  className="w-full h-full px-3 py-2.5 rounded-xl border border-stone-300 bg-stone-100 text-center font-bold text-base text-stone-900 cursor-not-allowed select-none transition outline-hidden"
                />
              </div>
              <div className="col-span-3 px-3.5 py-2.5 bg-emerald-50/70 border border-emerald-100 rounded-xl text-xs text-emerald-900 flex flex-col justify-center">
                <span className="font-bold font-quran text-sm text-emerald-950">
                  {currentQuarterInfo.surahName} (الجزء {currentQuarterInfo.juz})
                </span>
                <span className="text-[11px] text-emerald-800 line-clamp-1">
                  {currentQuarterInfo.ayahText}
                </span>
              </div>
            </div>

            {/* بداية ونهاية الربع (ابدأ من / توقف عند مع نص الآيات) */}
            <div className="mt-2.5 text-xs bg-stone-50 border border-stone-200/80 rounded-xl p-3 space-y-2">
              <div className="space-y-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-emerald-800 shrink-0">ابدأ من:</span>
                  <span className="font-bold text-stone-900">{recitationBounds.start.label}</span>
                  <span className="font-quran text-xs text-emerald-900 font-medium">
                    ﴿ {recitationBounds.start.ayahText}... ﴾
                  </span>
                </div>
              </div>
              <div className="border-t border-stone-200/60 pt-2 space-y-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-rose-700 shrink-0">توقف عند:</span>
                  <span className="font-bold text-stone-900">{recitationBounds.stop.label}</span>
                  <span className="font-quran text-xs text-stone-700 font-medium">
                    ﴿ {recitationBounds.stop.ayahText}{recitationBounds.stop.isEndNotice ? '' : '...'} ﴾
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Required peer colleague who listened (strictly from group members) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="listener-select" className="text-xs font-bold text-stone-700 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-emerald-700" />
                <span>الزميل المستمع من أعضاء المقرأة *</span>
              </label>
              <span className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                حصريًا من أعضاء المجموعة
              </span>
            </div>
            <select
              id="listener-select"
              value={listenerId}
              onChange={(e) => setListenerId(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 transition outline-hidden text-xs"
            >
              <option value="" disabled>
                -- اختر الزميل المستمع من أعضاء المقرأة * --
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.phone})
                </option>
              ))}
            </select>
          </div>

          {/* Optional notes */}
          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              ملاحظات (اختياري)
            </label>
            <textarea
              id="recitation-notes-input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي ملاحظات شخصية أو مواضع تحتاج تثبيت..."
              className="w-full px-3.5 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs resize-none"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
            >
              إلغاء
            </button>
            <button
              id="submit-recitation-btn"
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'جاري التسجيل...' : 'تأكيد إتمام التسميع'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface RevisionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: { notes?: string; date?: string }) => Promise<void>;
  cycleInfo: CycleInfo;
  loading: boolean;
  targetDate?: string;
  targetDateLabel?: string;
  isMissedDay?: boolean;
  reviewStart?: number;
  reviewEnd?: number;
  reviewCount?: number;
}

export const RevisionModal: React.FC<RevisionModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  cycleInfo,
  loading,
  targetDate,
  targetDateLabel,
  isMissedDay = false,
  reviewStart,
  reviewEnd,
  reviewCount,
}) => {
  const [notes, setNotes] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      setNotes('');
      setConfirmed(true);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const actualStart = reviewStart ?? cycleInfo.review_start;
  const actualEnd = reviewEnd ?? cycleInfo.review_end;
  const actualCount = reviewCount ?? (actualEnd - actualStart + 1);

  const startInfo = getQuarterInfo(actualStart);
  const endInfo = getQuarterInfo(actualEnd);
  const revisionBounds = getRangeBounds(actualStart, actualEnd);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmed) return;
    const payload: { notes?: string; date?: string } = {
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(targetDate ? { date: targetDate } : {}),
    };
    await onSubmit(payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900">
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <div>
            <h2 className="text-lg font-bold text-stone-900 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-700" />
              {isMissedDay ? `تأكيد مراجعة متأخرة (${targetDateLabel || targetDate})` : 'تأكيد المراجعة الفردية لليوم'}
            </h2>
            <p className="text-xs text-stone-500">
              {isMissedDay ? `تسجيل إتمام ورد المراجعة الفائت ليوم ${targetDateLabel || targetDate}` : 'تسجيل إتمام ورد المراجعة اليومي لنفسك'}
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
          <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs text-emerald-900">
              <span>{isMissedDay ? 'الكمية المطلوبة لمراجعة هذا اليوم:' : 'الكمية المطلوبة لمراجعة اليوم:'}</span>
              <span className="font-bold text-emerald-950">
                {actualCount} {actualCount === 1 ? 'ربع واحد' : 'أرباع'}
              </span>
            </div>
            <div className="text-center py-2 bg-white rounded-lg border border-emerald-200/70">
              <span className="text-xs text-stone-500">من</span>{' '}
              <strong className="text-emerald-900 font-bold">الربع {actualStart}</strong>{' '}
              <span className="text-stone-400">({startInfo.surahName})</span>{' '}
              <span className="text-xs text-stone-500">إلى</span>{' '}
              <strong className="text-emerald-900 font-bold">الربع {actualEnd}</strong>{' '}
              <span className="text-stone-400">({endInfo.surahName})</span>
            </div>

            {/* بداية ونهاية مدى المراجعة (ابدأ من / توقف عند مع نص الآيات) */}
            <div className="text-xs bg-white border border-emerald-200/70 rounded-xl p-3 space-y-2 text-right">
              <div className="space-y-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-emerald-800 shrink-0">ابدأ من:</span>
                  <span className="font-bold text-stone-900">{revisionBounds.start.label}</span>
                  <span className="font-quran text-xs text-emerald-900 font-medium">
                    ﴿ {revisionBounds.start.ayahText}... ﴾
                  </span>
                </div>
              </div>
              <div className="border-t border-stone-100 pt-2 space-y-1">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-bold text-rose-700 shrink-0">توقف عند:</span>
                  <span className="font-bold text-stone-900">{revisionBounds.stop.label}</span>
                  <span className="font-quran text-xs text-stone-700 font-medium">
                    ﴿ {revisionBounds.stop.ayahText}{revisionBounds.stop.isEndNotice ? '' : '...'} ﴾
                  </span>
                </div>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-2.5 p-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 cursor-pointer transition">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded-sm text-emerald-700 focus:ring-emerald-500 border-stone-300"
            />
            <span className="text-xs text-stone-800 font-medium">
              أؤكد أنني أتممت مراجعة الكمية المحددة أعلاه كاملة بتركيز وإتقان.
            </span>
          </label>

          <div>
            <label className="block text-xs font-bold text-stone-700 mb-1.5">
              ملاحظة شخصية (اختياري)
            </label>
            <input
              id="revision-notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-emerald-600 transition outline-hidden text-xs"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
            >
              إلغاء
            </button>
            <button
              id="submit-revision-btn"
              type="submit"
              disabled={!confirmed || loading}
              className="px-5 py-2 text-xs font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'جاري الحفظ...' : isMissedDay ? 'تأكيد إتمام المراجعة المتأخرة' : 'تأكيد إتمام المراجعة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => Promise<void>;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrent(false);
      setShowNew(false);
      setErrorMsg('');
      setSuccessMsg('');
      setLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!currentPassword) {
      setErrorMsg('يرجى إدخال كلمة المرور الحالية');
      return;
    }
    if (!newPassword) {
      setErrorMsg('يرجى إدخال كلمة المرور الجديدة');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('كلمة المرور يجب أن تكون 6 أحرف أو أكثر');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ currentPassword, newPassword, confirmPassword });
      setSuccessMsg('تم تغيير كلمة المرور بنجاح');
      setTimeout(() => {
        onClose();
      }, 1100);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تغيير كلمة المرور');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] overflow-y-auto bg-stone-900/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl border border-stone-200 my-auto animate-in zoom-in-95 duration-150 relative max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="flex items-center justify-between pb-3.5 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-stone-900 text-sm">تغيير كلمة المرور</h3>
              <p className="text-[11px] text-stone-500">قم بإدخال كلمة المرور القديمة ثم الجديدة</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* الحقل الأول: كلمة المرور الحالية (القديمة) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="current-password-input" className="block text-xs font-bold text-stone-800">
                كلمة المرور الحالية (القديمة) *
              </label>
              <span className="text-[10px] text-stone-500 font-medium">مطلوبة للتحقق</span>
            </div>
            <div className="relative">
              <input
                id="current-password-input"
                name="current-password"
                type={showCurrent ? 'text' : 'password'}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="أدخل كلمة المرور الحالية هنا"
                className="w-full h-10 px-3.5 pl-10 text-xs sm:text-sm rounded-xl border border-stone-300 bg-stone-50/70 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-hidden transition text-stone-900 placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-1 rounded-md transition cursor-pointer"
                title={showCurrent ? 'إخفاء' : 'إظهار'}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* الحقل الثاني: كلمة المرور الجديدة */}
          <div className="space-y-1.5">
            <label htmlFor="new-password-input" className="block text-xs font-bold text-stone-800">
              كلمة المرور الجديدة *
            </label>
            <div className="relative">
              <input
                id="new-password-input"
                name="new-password"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="أدخل كلمة المرور الجديدة (6 أحرف على الأقل)"
                className="w-full h-10 px-3.5 pl-10 text-xs sm:text-sm rounded-xl border border-stone-300 bg-stone-50/70 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-hidden transition text-stone-900 placeholder:text-stone-400"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-1 rounded-md transition cursor-pointer"
                title={showNew ? 'إخفاء' : 'إظهار'}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* الحقل الثالث: تأكيد كلمة المرور الجديدة */}
          <div className="space-y-1.5">
            <label htmlFor="confirm-password-input" className="block text-xs font-bold text-stone-800">
              تأكيد كلمة المرور الجديدة *
            </label>
            <input
              id="confirm-password-input"
              name="confirm-password"
              type={showNew ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="أعد كتابة كلمة المرور الجديدة للتأكيد"
              className="w-full h-10 px-3.5 pl-10 text-xs sm:text-sm rounded-xl border border-stone-300 bg-stone-50/70 focus:bg-white focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-hidden transition text-stone-900 placeholder:text-stone-400"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition cursor-pointer"
            >
              إلغاء
            </button>
            <button
              id="submit-change-password-btn"
              type="submit"
              disabled={loading || !!successMsg}
              className="px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 rounded-xl shadow-xs transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
