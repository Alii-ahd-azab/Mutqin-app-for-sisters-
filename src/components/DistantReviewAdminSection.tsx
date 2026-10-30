import React, { useMemo, useState } from 'react';
import { BookMarked, Plus, Pencil, Trash2, X, CalendarDays, Users } from 'lucide-react';
import {
  DistantReviewAssignment,
  DistantReviewCompletion,
  DistantReviewInput,
  GroupSettings,
  RestDay,
  User,
} from '../types';
import { distantReviewQuarterCount, getDistantReviewBounds, getQuarterInfo } from '../data/quranData';
import { addDays, formatArabicDateWithDayName, isDistantReviewOwed, isPausedDate, joinedOnDateFromTimestamp } from '../lib/calculations';
import { QuarterPicker } from './QuarterPicker';

/** «من بداية الربع X حتى بداية الربع Y»: the TO quarter is the stopping boundary (not reviewed). */
export const distantRangeText = (start: number, end: number) => `من بداية الربع ${start} حتى بداية الربع ${end}`;

/** «المراجعة المطلوبة» preview: beginning of the FROM quarter → beginning of the TO quarter. */
export const DistantRangePreview: React.FC<{ start: number; end: number; id?: string }> = ({ start, end, id }) => {
  const bounds = getDistantReviewBounds(start, end);
  const count = distantReviewQuarterCount(start, end);
  return (
    <div id={id} className="p-3 rounded-2xl bg-fuchsia-50/70 border border-fuchsia-200 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="font-bold text-fuchsia-950">المراجعة المطلوبة</span>
        <span className="text-[11px] font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
          {count} {count === 1 ? 'ربع واحد' : count === 2 ? 'ربعان' : 'أرباع'}
        </span>
      </div>
      <p className="font-bold text-stone-900">
        {distantRangeText(start, end)}
        <span className="text-stone-500 font-normal"> ({getQuarterInfo(start).surahName} ← {getQuarterInfo(end).surahName})</span>
      </p>
      <div className="bg-white p-2.5 rounded-xl border border-stone-200/80 space-y-1.5">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-bold text-pink-700 shrink-0">ابدئي من:</span>
          <span className="font-bold text-stone-900">بداية الربع {start} — {bounds.start.label}</span>
          <span className="font-quran text-pink-900">﴿ {bounds.start.ayahText}... ﴾</span>
        </div>
        <div className="flex items-baseline gap-1.5 flex-wrap border-t border-stone-100 pt-1.5">
          <span className="font-bold text-rose-700 shrink-0">توقفي عند:</span>
          <span className="font-bold text-stone-900">بداية الربع {end} — {bounds.stop.label}</span>
          <span className="font-quran text-rose-700">﴿ {bounds.stop.ayahText}... ﴾</span>
        </div>
      </div>
    </div>
  );
};

interface Props {
  cycleId: string;
  today: string;
  settings: GroupSettings;
  restDays: RestDay[];
  users: User[];
  assignments: DistantReviewAssignment[];
  completions: DistantReviewCompletion[];
  onCreate: (payload: DistantReviewInput) => Promise<string>;
  onUpdate: (id: string, payload: DistantReviewInput) => Promise<string>;
  onDelete: (id: string) => Promise<string>;
  loading: boolean;
}

/**
 * Admin section «المراجعة البعيدة»: create ONE dated day at a time (no recurrence, no bulk), edit or
 * delete it while it is still in the future, and see today/past days with completion statistics.
 */
export const DistantReviewAdminSection: React.FC<Props> = ({
  cycleId,
  today,
  settings,
  restDays,
  users,
  assignments,
  completions,
  onCreate,
  onUpdate,
  onDelete,
  loading,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const minDate = addDays(today, 1);
  // «إلى الربع» is where the review stops (its beginning), so it must come after «من الربع».
  const rangeValid = from !== null && to !== null && from >= 1 && to <= 240 && from < to;

  const reset = () => {
    setEditingId(null);
    setDate('');
    setFrom(null);
    setTo(null);
    setNote('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!date) return setError('يرجى تحديد تاريخ المراجعة البعيدة');
    if (date < minDate) return setError('يجب أن يكون تاريخ المراجعة البعيدة في المستقبل (بعد اليوم).');
    if (from === null || to === null) return setError('يرجى اختيار «من الربع» و«إلى الربع»');
    if (!rangeValid) return setError('نطاق الأرباع غير صالح: «إلى الربع» هو موضع التوقف (بداية ذلك الربع)، فيجب أن يكون بعد «من الربع» وضمن 1–240.');
    if (assignments.some((a) => a.cycle_id === cycleId && a.review_date === date && a.id !== editingId)) {
      return setError('يوجد يوم مراجعة بعيدة مجدول في هذا التاريخ بالفعل.');
    }
    setBusy(true);
    try {
      const payload = { review_date: date, start_quarter: from, end_quarter: to, note: note.trim() };
      setMessage(editingId ? await onUpdate(editingId, payload) : await onCreate(payload));
      reset();
    } catch (err: any) {
      setError(err?.message || 'تعذر حفظ يوم المراجعة البعيدة');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (a: DistantReviewAssignment) => {
    setError('');
    setMessage('');
    setConfirmDeleteId(null);
    setEditingId(a.id);
    setDate(a.review_date);
    setFrom(a.start_quarter);
    setTo(a.end_quarter);
    setNote(a.note || '');
  };

  const remove = async (a: DistantReviewAssignment) => {
    setError('');
    setMessage('');
    setBusy(true);
    try {
      setMessage(await onDelete(a.id));
      if (editingId === a.id) reset();
    } catch (err: any) {
      setError(err?.message || 'تعذر حذف يوم المراجعة البعيدة');
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  };

  const activeMembers = useMemo(() => users.filter((u) => u.role === 'member' && u.is_active), [users]);

  const current = useMemo(() => assignments.filter((a) => a.cycle_id === cycleId), [assignments, cycleId]);
  const archived = useMemo(
    () => assignments.filter((a) => a.cycle_id !== cycleId).sort((a, b) => b.review_date.localeCompare(a.review_date)),
    [assignments, cycleId]
  );
  // Upcoming first (soonest first), then today, then history (most recent first).
  const ordered = useMemo(() => {
    const future = current.filter((a) => a.review_date > today).sort((a, b) => a.review_date.localeCompare(b.review_date));
    const rest = current.filter((a) => a.review_date <= today).sort((a, b) => b.review_date.localeCompare(a.review_date));
    return [...future, ...rest];
  }, [current, today]);

  const statsOf = (a: DistantReviewAssignment) => {
    const done = new Set(completions.filter((c) => c.assignment_id === a.id).map((c) => c.member_id));
    const owed = activeMembers.filter((m) =>
      isDistantReviewOwed(a, settings, restDays, today, joinedOnDateFromTimestamp(m.batch_joined_at))
    );
    return { owed: owed.length, completed: owed.filter((m) => done.has(m.id)).length, totalCompletions: done.size };
  };

  return (
    <div id="distant-review-section" className="bg-white rounded-3xl border border-stone-200 p-6 shadow-2xs space-y-4">
      <div>
        <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
          <BookMarked className="w-5 h-5 text-pink-600" />
          <span>المراجعة البعيدة</span>
        </h3>
        <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">
          يوم تحددينه يدويًا يتوقف فيه التقدم المعتاد للبرنامج (لا ربع تسميع جديد ولا مراجعة يومية جديدة)، ويُطلب من كل عضوة مراجعة نطاق تختارينه من المصحف.
          كل يوم يُضاف منفردًا بتاريخه.
        </p>
      </div>

      <form id="distant-review-form" onSubmit={submit} className="p-4 rounded-2xl bg-stone-50 border border-stone-200/80 space-y-3">
        {editingId && (
          <div className="flex items-center justify-between gap-2 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <span>تعديل يوم المراجعة البعيدة</span>
            <button type="button" onClick={reset} className="p-1 rounded-lg hover:bg-amber-100 cursor-pointer" title="إلغاء التعديل">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="distant-review-date" className="block text-xs font-bold text-stone-700 mb-1">
              تاريخ المراجعة البعيدة *
            </label>
            <input
              id="distant-review-date"
              type="date"
              min={minDate}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white outline-hidden"
            />
          </div>
          <QuarterPicker
            id="distant-from"
            label="الربع"
            tone="from"
            value={from}
            max={239}
            onChange={(q) => {
              setFrom(q);
              if (to !== null && to <= q) setTo(null);
            }}
          />
          <QuarterPicker id="distant-to" label="الربع" tone="to" value={to} min={(from ?? 1) + 1} onChange={setTo} />
        </div>
        <div>
          <label htmlFor="distant-review-note" className="block text-xs font-bold text-stone-700 mb-1">
            ملاحظة (اختياري)
          </label>
          <input
            id="distant-review-note"
            type="text"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: مراجعة ما سبق قبل الاختبار"
            className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white outline-hidden"
          />
        </div>

        {rangeValid && <DistantRangePreview id="distant-review-preview" start={from!} end={to!} />}

        <div className="flex flex-wrap items-center gap-2">
          <button
            id="add-distant-review-btn"
            type="submit"
            disabled={busy || loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{editingId ? 'حفظ التعديل' : 'إضافة يوم مراجعة بعيدة'}</span>
          </button>
          {editingId && (
            <button type="button" onClick={reset} className="px-4 py-2 rounded-xl border border-stone-300 text-xs font-bold cursor-pointer">
              إلغاء
            </button>
          )}
        </div>
        {error && <p id="distant-review-error" className="text-xs text-rose-600 font-medium">{error}</p>}
        {message && <p id="distant-review-msg" className="text-xs text-emerald-700 font-medium">{message}</p>}
      </form>

      <div className="divide-y divide-stone-100 border-t border-stone-100 pt-2" id="distant-review-list">
        {ordered.length === 0 ? (
          <p className="text-xs text-stone-400 py-4 text-center">لم تتم جدولة أي يوم مراجعة بعيدة في هذه الدورة بعد</p>
        ) : (
          ordered.map((a) => {
            const isFuture = a.review_date > today;
            const isToday = a.review_date === today;
            // A pause or a rest day on that date does not cancel the distant review (it still applies).
            const offDay = isPausedDate(settings, a.review_date) || restDays.some((r) => r.date === a.review_date);
            const stats = isFuture ? null : statsOf(a);
            return (
              <div key={a.id} id={`distant-review-item-${a.review_date}`} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CalendarDays className="w-4 h-4 text-pink-600 shrink-0" />
                    <span className="font-bold text-stone-900">{formatArabicDateWithDayName(a.review_date)}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        isFuture
                          ? 'bg-pink-50 text-pink-800 border-pink-200'
                          : isToday
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-stone-100 text-stone-600 border-stone-200'
                      }`}
                    >
                      {isFuture ? 'قادم' : isToday ? 'اليوم' : 'مضى'}
                    </span>
                    {offDay && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200">
                        تبقى مطلوبة رغم الإيقاف/الراحة
                      </span>
                    )}
                  </div>
                  <p className="text-stone-700">
                    <strong>{distantRangeText(a.start_quarter, a.end_quarter)}</strong>
                    <span className="text-stone-500">
                      {' '}
                      ({getQuarterInfo(a.start_quarter).surahName} ← {getQuarterInfo(a.end_quarter).surahName})
                    </span>
                  </p>
                  {a.note && <p className="text-stone-500">ملاحظة: {a.note}</p>}
                  {stats && (
                    <p className="text-emerald-800 font-bold flex items-center gap-1" id={`distant-review-stats-${a.review_date}`}>
                      <Users className="w-3.5 h-3.5" />
                      <span>
                        {stats.completed} / {stats.owed} أتممن المراجعة
                      </span>
                      {stats.owed - stats.completed > 0 && (
                        <span className="text-amber-800 font-normal">• متبقٍ {stats.owed - stats.completed}</span>
                      )}
                    </p>
                  )}
                </div>
                {isFuture ? (
                  confirmDeleteId === a.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-rose-700 font-bold">حذف هذا اليوم؟</span>
                      <button
                        id={`confirm-delete-distant-${a.review_date}`}
                        onClick={() => remove(a)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg bg-rose-700 text-white font-bold cursor-pointer disabled:opacity-50"
                      >
                        نعم، احذفي
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)} className="px-3 py-1.5 rounded-lg border border-stone-300 cursor-pointer">
                        إلغاء
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        id={`edit-distant-${a.review_date}`}
                        onClick={() => startEdit(a)}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 flex items-center gap-1 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>تعديل</span>
                      </button>
                      <button
                        id={`delete-distant-${a.review_date}`}
                        onClick={() => setConfirmDeleteId(a.id)}
                        className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-stone-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>حذف</span>
                      </button>
                    </div>
                  )
                ) : (
                  <span className="text-[11px] text-stone-400 shrink-0">عرض فقط (محفوظ في السجل)</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {archived.length > 0 && (
        <div className="border-t border-stone-100 pt-2">
          <button onClick={() => setShowArchived((s) => !s)} className="text-xs font-bold text-pink-700 cursor-pointer">
            {showArchived ? 'إخفاء' : 'عرض'} أيام المراجعة البعيدة في الدورات السابقة ({archived.length})
          </button>
          {showArchived && (
            <div className="divide-y divide-stone-100 mt-2">
              {archived.map((a) => (
                <div key={a.id} className="py-2 text-xs text-stone-600 flex flex-wrap gap-x-3">
                  <span className="font-bold text-stone-800">{formatArabicDateWithDayName(a.review_date)}</span>
                  <span>
                    {distantRangeText(a.start_quarter, a.end_quarter)}
                  </span>
                  <span className="text-emerald-700">{completions.filter((c) => c.assignment_id === a.id).length} أتممن المراجعة</span>
                  {a.note && <span className="text-stone-500">ملاحظة: {a.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
