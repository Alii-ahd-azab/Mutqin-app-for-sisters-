import React, { useEffect, useState } from 'react';
import { BookMarked, CheckCircle2, Clock, ChevronLeft, ChevronRight, UserX } from 'lucide-react';
import { DistantReviewAssignment } from '../types';
import { formatArabicDateWithDayName, MemberDistantReviewStatus } from '../lib/calculations';
import { DistantRangePreview, distantRangeText } from './DistantReviewAdminSection';

interface Props {
  status: MemberDistantReviewStatus;
  today: string;
  isActive: boolean;
  onComplete: (assignmentId: string) => Promise<string>;
  // Opened from a notification: show this assignment (nonce: each click counts).
  focus?: { assignmentId: string; nonce: number } | null;
  highlight?: boolean;
}

/**
 * Member card «المراجعة البعيدة»: today's assigned review and every missed one, each its own
 * obligation (never merged), with ◀ ▶ navigation when several are owed.
 */
export const DistantReviewMemberCard: React.FC<Props> = ({ status, today, isActive, onComplete, focus, highlight }) => {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // The assignment awaiting the member's confirmation (nothing is sent before «نعم، تأكيد الإتمام»).
  const [confirming, setConfirming] = useState<DistantReviewAssignment | null>(null);

  const items: DistantReviewAssignment[] =
    status.outstanding.length > 0 ? status.outstanding : status.todayAssignment ? [status.todayAssignment] : [];

  useEffect(() => {
    if (!focus) return;
    const at = items.findIndex((a) => a.id === focus.assignmentId);
    if (at >= 0) setIndex(at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  if (items.length === 0) return message ? <p className="text-xs text-emerald-700 font-bold text-center">{message}</p> : null;

  const i = Math.min(index, items.length - 1);
  const item = items[i];
  const isOverdue = item.review_date < today;
  const completed = status.completionByAssignment.has(item.id);
  const dateLabel = formatArabicDateWithDayName(item.review_date);

  const confirm = async () => {
    const target = confirming;
    if (!target || busy) return; // one request per confirmation, never a double submission
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setMessage(await onComplete(target.id));
      setIndex(0);
    } catch (e: any) {
      setError(e?.message || 'تعذر حفظ إتمام المراجعة البعيدة');
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <div
      id="distant-review-card"
      className={`${highlight ? 'notification-focus ' : ''}bg-white rounded-3xl border ${isOverdue ? 'border-amber-300 ring-1 ring-amber-200/60' : 'border-fuchsia-300 ring-1 ring-fuchsia-200/60'} shadow-sm p-6 space-y-4`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${isOverdue ? 'bg-amber-100 text-amber-800' : 'bg-fuchsia-100 text-fuchsia-700'}`}>
            {isOverdue ? <Clock className="w-5 h-5" /> : <BookMarked className="w-5 h-5" />}
          </div>
          <div>
            <h3 id="distant-review-title" className="font-bold text-stone-900 text-base">
              {isOverdue ? `مراجعة بعيدة متأخرة — ${dateLabel}` : 'المراجعة البعيدة'}
            </h3>
            <p className="text-xs text-stone-500">
              {isOverdue ? 'مراجعة بعيدة مجدولة فاتكِ تأكيدها في موعدها' : 'مراجعة خاصة حددتها المشرفة لهذا اليوم بدل التقدم المعتاد'}
            </p>
          </div>
        </div>
        {completed ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            تم الإنجاز
          </span>
        ) : isOverdue ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
            <Clock className="w-3.5 h-3.5 text-amber-700" />
            مراجعة بعيدة متأخرة
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-stone-100 text-stone-700 border border-stone-200">
            <Clock className="w-3.5 h-3.5 text-stone-600" />
            لم تُؤكَّد بعد اليوم
          </span>
        )}
      </div>

      {items.length > 1 && (
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-2.5 flex items-center justify-between gap-2">
          <span id="distant-review-counter" className="px-2 py-0.5 rounded-md bg-white border border-amber-200 shadow-2xs text-xs text-amber-950 font-bold">
            {i + 1} من {items.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              id="distant-prev"
              type="button"
              onClick={() => setIndex(Math.max(0, i - 1))}
              disabled={i === 0}
              title="السابق"
              className="p-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              id="distant-next"
              type="button"
              onClick={() => setIndex(Math.min(items.length - 1, i + 1))}
              disabled={i === items.length - 1}
              title="التالي"
              className="p-1.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="text-xs text-stone-600 flex flex-wrap gap-x-3 gap-y-1">
        <span>
          موعدها: <strong className="text-stone-900">{dateLabel}</strong>
        </span>
      </div>

      <div className="bg-stone-50 p-3 rounded-2xl border border-stone-200/70 flex items-center justify-between text-center">
        <div className="flex-1">
          <div className="text-[10px] text-stone-400">من بداية الربع</div>
          <div id="distant-review-from" className="text-lg font-bold text-stone-900">{item.start_quarter}</div>
        </div>
        <div className="text-stone-300 text-sm">◀ ◀</div>
        <div className="flex-1">
          <div className="text-[10px] text-stone-400">حتى بداية الربع</div>
          <div id="distant-review-to" className="text-lg font-bold text-stone-900">{item.end_quarter}</div>
        </div>
      </div>

      <DistantRangePreview start={item.start_quarter} end={item.end_quarter} />

      {item.note && (
        <p id="distant-review-note-text" className="text-xs bg-amber-50 border border-amber-200 text-amber-950 rounded-xl px-3 py-2">
          <strong>ملاحظة المشرفة:</strong> {item.note}
        </p>
      )}

      {!isActive ? (
        <button disabled className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 bg-rose-50 text-rose-700 border border-rose-200 cursor-not-allowed">
          <UserX className="w-4 h-4" />
          <span>حسابكِ مُقصًى حاليًا — لا يمكن تأكيد المراجعة البعيدة</span>
        </button>
      ) : completed ? (
        <div id="distant-review-completed-status" className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 bg-emerald-50 text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>تم تأكيد المراجعة البعيدة لهذا اليوم بفضل الله</span>
        </div>
      ) : (
        <button
          id="complete-distant-review-btn"
          onClick={() => {
            setError('');
            setConfirming(item);
          }}
          disabled={busy}
          className={`w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-xs transition flex items-center justify-center gap-2 text-white cursor-pointer disabled:opacity-60 ${
            isOverdue ? 'bg-amber-700 hover:bg-amber-800' : 'bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600'
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{isOverdue ? `تأكيد إتمام المراجعة البعيدة (متأخرة — ${dateLabel})` : 'تأكيد إتمام المراجعة البعيدة'}</span>
        </button>
      )}
      {message && <p className="text-xs text-emerald-700 font-bold text-center">{message}</p>}
      {error && <p className="text-xs text-rose-600 font-bold text-center">{error}</p>}

      {confirming && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 flex items-center justify-center p-4" onMouseDown={(ev) => ev.target === ev.currentTarget && !busy && setConfirming(null)}>
          <div id="distant-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="distant-confirm-title" className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-pink-100 p-5 space-y-4">
            <h3 id="distant-confirm-title" className="font-bold text-stone-900 text-base">
              هل أنتِ متأكدة من إتمام المراجعة البعيدة المطلوبة؟
            </h3>
            <div className="text-xs text-stone-700 bg-pink-50/60 border border-pink-100 rounded-xl p-3 space-y-1">
              <p>
                الموعد: <strong>{formatArabicDateWithDayName(confirming.review_date)}</strong>
                {confirming.review_date < today && <span className="text-amber-800"> (متأخرة)</span>}
              </p>
              <p>
                المطلوب: <strong>{distantRangeText(confirming.start_quarter, confirming.end_quarter)}</strong>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                id="distant-confirm-yes"
                type="button"
                onClick={confirm}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 disabled:opacity-60 cursor-pointer disabled:cursor-wait"
              >
                {busy ? 'جاري الحفظ...' : 'نعم، تأكيد الإتمام'}
              </button>
              <button
                id="distant-confirm-cancel"
                type="button"
                onClick={() => setConfirming(null)}
                disabled={busy}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 disabled:opacity-60 cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
