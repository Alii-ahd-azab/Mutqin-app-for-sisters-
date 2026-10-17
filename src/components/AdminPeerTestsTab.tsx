import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Batch,
  PeerTest,
  PeerTestAttempt,
  PeerTestAttemptQuestion,
  PeerTestDifficulty,
  PeerTestQuestion,
  PeerTestType,
  PeerTestVisibility,
} from '../types';
import { api } from '../api/client';
import { getRangeBounds } from '../data/quranData';
import { PEER_DIFFICULTY_LABELS, PEER_LEVEL_STYLES } from '../lib/peerTests';
import { ACTION_TONE, ACTION_ICON, CONFIRM_TONE } from './actionButtonStyles';
import {
  Award,
  Plus,
  Pencil,
  Eye,
  EyeOff,
  Flag,
  ListChecks,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  History,
  ChevronDown,
  ChevronUp,
  CalendarClock,
} from 'lucide-react';

interface AdminPeerTestsTabProps {
  batch: Batch;
  cycleId: string;
  onChanged: () => void;
}

type FormState = {
  test_id?: string;
  title: string;
  range_start: number;
  range_end: number;
  questions_count: number;
  lines_per_question: number;
  has_max_errors: boolean;
  max_errors: number;
  test_type: PeerTestType;
  difficulty: PeerTestDifficulty;
  visibility: PeerTestVisibility;
  visible_from: string; // datetime-local
  visible_until: string; // datetime-local
};

const EMPTY_FORM: FormState = {
  title: '',
  range_start: 1,
  range_end: 8,
  questions_count: 5,
  lines_per_question: 8,
  has_max_errors: true,
  max_errors: 3,
  test_type: 'mandatory',
  difficulty: 'any',
  visibility: 'draft',
  visible_from: '',
  visible_until: '',
};

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusInfo(test: PeerTest): { label: string; className: string } {
  const now = Date.now();
  if (test.status === 'finished') return { label: 'منتهٍ نهائيًا', className: 'bg-stone-100 text-stone-600 border-stone-200' };
  if (test.status === 'draft') return { label: 'مسودة', className: 'bg-stone-50 text-stone-600 border-stone-200' };
  if (test.status === 'hidden') return { label: 'مخفي', className: 'bg-stone-100 text-stone-700 border-stone-200' };
  if (test.visible_from && Date.parse(test.visible_from) > now) {
    return { label: `مجدول • يظهر ${formatDateTime(test.visible_from)}`, className: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  }
  if (test.visible_until && Date.parse(test.visible_until) <= now) {
    return { label: 'انتهت فترة العرض', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  }
  return { label: 'ظاهر الآن', className: 'bg-green-50 text-green-700 border-green-200' };
}

function formFromTest(test: PeerTest): FormState {
  const now = Date.now();
  let visibility: PeerTestVisibility = 'draft';
  if (test.status === 'hidden') visibility = 'hidden';
  else if (test.status === 'published') {
    visibility = test.visible_from && Date.parse(test.visible_from) > now ? 'schedule' : 'now';
  }
  return {
    test_id: test.id,
    title: test.title,
    range_start: test.range_start,
    range_end: test.range_end,
    questions_count: test.questions_count,
    lines_per_question: test.lines_per_question,
    has_max_errors: test.max_errors !== null,
    max_errors: test.max_errors ?? 3,
    test_type: test.test_type,
    difficulty: test.difficulty,
    visibility,
    visible_from: toLocalInput(test.visible_from),
    visible_until: toLocalInput(test.visible_until),
  };
}

const inputClass =
  'w-full px-3 py-2 rounded-xl border border-stone-200 bg-stone-50 focus:bg-white focus:border-rose-400 transition outline-hidden text-xs';

export const AdminPeerTestsTab: React.FC<AdminPeerTestsTabProps> = ({ batch, cycleId, onChanged }) => {
  const [tests, setTests] = useState<PeerTest[]>([]);
  const [attempts, setAttempts] = useState<PeerTestAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [busyTestId, setBusyTestId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'show'; test: PeerTest; blocked: { id: string; name: string }[] }
    | { kind: 'finish'; test: PeerTest }
    | null
  >(null);

  const [preview, setPreview] = useState<{ test: PeerTest; questions: PeerTestQuestion[] } | null>(null);
  const [previewError, setPreviewError] = useState('');

  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);
  const [attemptQuestions, setAttemptQuestions] = useState<Record<string, PeerTestAttemptQuestion[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { tests: list } = await api.getPeerTests(cycleId);
      setTests(list);
      const { attempts: atts } = await api.getPeerTestAttempts(list.map((t) => t.id));
      setAttempts(atts.filter((a) => a.status === 'passed' || a.status === 'failed'));
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل الاختبارات');
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (message: string) => {
    setSuccessMsg(message);
    setTimeout(() => setSuccessMsg(''), 5000);
  };

  const afterChange = async (message: string) => {
    await load();
    onChanged();
    flash(message);
  };

  const testTitle = useMemo(() => {
    const map = new Map(tests.map((t) => [t.id, t.title]));
    return (id: string) => map.get(id) || '';
  }, [tests]);

  // ----- form -----
  const openNew = () => {
    setForm({ ...EMPTY_FORM });
    setFormError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || saving) return;
    setFormError('');
    if (form.range_start < 1 || form.range_end > 240 || form.range_start > form.range_end) {
      setFormError('يرجى اختيار نطاق صحيح بين الربع 1 والربع 240 (البداية قبل النهاية)');
      return;
    }
    if (form.visibility === 'schedule' && !form.visible_from) {
      setFormError('يرجى تحديد موعد بدء العرض');
      return;
    }
    setSaving(true);
    try {
      const res = await api.adminSavePeerTest({
        batch_id: batch.id,
        test_id: form.test_id,
        title: form.title.trim(),
        range_start: form.range_start,
        range_end: form.range_end,
        questions_count: form.questions_count,
        lines_per_question: form.lines_per_question,
        max_errors: form.has_max_errors ? form.max_errors : null,
        test_type: form.test_type,
        difficulty: form.difficulty,
        visibility: form.visibility,
        visible_from: form.visibility === 'now' ? null : fromLocalInput(form.visible_from),
        visible_until: fromLocalInput(form.visible_until),
      });
      setForm(null);
      await afterChange(res.message);
    } catch (err: any) {
      setFormError(err?.message || 'تعذر حفظ الاختبار');
    } finally {
      setSaving(false);
    }
  };

  // ----- status actions -----
  const requestShow = async (test: PeerTest) => {
    setErrorMsg('');
    if (test.test_type !== 'mandatory') {
      await runStatus(test, 'show');
      return;
    }
    setBusyTestId(test.id);
    try {
      const impact = await api.adminPeerTestImpact(test.id);
      setConfirm({ kind: 'show', test, blocked: impact.blocked_members });
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر حساب أثر الاختبار');
    } finally {
      setBusyTestId(null);
    }
  };

  const runStatus = async (test: PeerTest, action: 'show' | 'hide' | 'finish') => {
    setBusyTestId(test.id);
    setErrorMsg('');
    try {
      const res = await api.adminSetPeerTestStatus(test.id, action);
      setConfirm(null);
      await afterChange(res.message);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحديث حالة الاختبار');
      setConfirm(null);
    } finally {
      setBusyTestId(null);
    }
  };

  const openPreview = async (test: PeerTest) => {
    setPreviewError('');
    setBusyTestId(test.id);
    try {
      const res = await api.adminPreviewPeerTest(test.id);
      setPreview({ test, questions: res.questions });
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر توليد عيّنة الأسئلة');
    } finally {
      setBusyTestId(null);
    }
  };

  const toggleAttempt = async (attempt: PeerTestAttempt) => {
    if (expandedAttempt === attempt.id) {
      setExpandedAttempt(null);
      return;
    }
    setExpandedAttempt(attempt.id);
    if (!attemptQuestions[attempt.id]) {
      try {
        const res = await api.getPeerTestAttemptQuestions(attempt.id);
        setAttemptQuestions((prev) => ({ ...prev, [attempt.id]: res.questions }));
      } catch {
        setAttemptQuestions((prev) => ({ ...prev, [attempt.id]: [] }));
      }
    }
  };

  const formBounds = form ? getRangeBounds(Math.max(1, Math.min(240, form.range_start || 1)), Math.max(1, Math.min(240, form.range_end || 1))) : null;
  const actionBtn = 'px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1 transition cursor-pointer whitespace-nowrap disabled:opacity-50';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-base text-stone-900 flex items-center gap-2">
            <Award className="w-5 h-5 text-rose-600" />
            <span>اختبار الزميلات في «{batch.name}»</span>
          </h3>
          <p className="text-xs text-stone-500 mt-0.5">
            حدّدي نطاق الأرباع وعدد الأسئلة وأسطر كل سؤال، ثم أظهري الاختبار الآن أو جدوليه أو أخفيه.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition" title="تحديث">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={openNew}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold text-xs shadow-xs transition flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>إنشاء اختبار</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Tests list */}
      <div className="bg-white rounded-3xl border border-stone-200 p-5 shadow-2xs space-y-3">
        <h4 className="font-bold text-sm text-stone-900 flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-rose-600" />
          <span>اختبارات الدورة الحالية ({tests.length})</span>
        </h4>

        {!loading && tests.length === 0 && (
          <p className="text-xs text-stone-400 py-6 text-center">لا توجد اختبارات بعد لهذه الدفعة. أنشئي أول اختبار من الزر بالأعلى.</p>
        )}

        <div className="divide-y divide-stone-100">
          {tests.map((test) => {
            const info = statusInfo(test);
            const busy = busyTestId === test.id;
            const finished = test.status === 'finished';
            const passedCount = attempts.filter((a) => a.test_id === test.id && a.status === 'passed').length;
            return (
              <div key={test.id} className="py-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-stone-900 text-sm">{test.title}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${info.className}`}>{info.label}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        test.test_type === 'mandatory' ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-green-50 text-green-800 border-green-200'
                      }`}
                    >
                      {test.test_type === 'mandatory' ? 'إلزامي' : 'موصى به'}
                    </span>
                  </div>
                  <p className="text-[11px] text-stone-500">
                    الأرباع {test.range_start} ⟵ {test.range_end} • {test.questions_count} أسئلة × {test.lines_per_question} أسطر •{' '}
                    {test.max_errors !== null ? `حد الأخطاء ${test.max_errors}` : 'بدون حد أخطاء'} • الصعوبة:{' '}
                    {PEER_DIFFICULTY_LABELS[test.difficulty]?.label} • اجتازته {passedCount}
                    {test.visible_until && !finished && ` • ينتهي العرض ${formatDateTime(test.visible_until)}`}
                  </p>
                </div>

                {!finished && (
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    <button onClick={() => { setForm(formFromTest(test)); setFormError(''); }} disabled={busy} className={`${actionBtn} ${ACTION_TONE.edit}`}>
                      <Pencil className={`w-3.5 h-3.5 ${ACTION_ICON.edit}`} />
                      <span>تعديل</span>
                    </button>
                    {info.label === 'ظاهر الآن' ? (
                      <button onClick={() => runStatus(test, 'hide')} disabled={busy} className={`${actionBtn} ${ACTION_TONE.batches}`}>
                        <EyeOff className={`w-3.5 h-3.5 ${ACTION_ICON.batches}`} />
                        <span>إخفاء</span>
                      </button>
                    ) : (
                      <button onClick={() => requestShow(test)} disabled={busy} className={`${actionBtn} ${ACTION_TONE.reactivate}`}>
                        <Eye className={`w-3.5 h-3.5 ${ACTION_ICON.reactivate}`} />
                        <span>إظهار الآن</span>
                      </button>
                    )}
                    <button onClick={() => openPreview(test)} disabled={busy} className={`${actionBtn} ${ACTION_TONE.move}`}>
                      <ListChecks className={`w-3.5 h-3.5 ${ACTION_ICON.move}`} />
                      <span>معاينة أسئلة</span>
                    </button>
                    <button onClick={() => setConfirm({ kind: 'finish', test })} disabled={busy} className={`${actionBtn} ${ACTION_TONE.delete}`}>
                      <Flag className={`w-3.5 h-3.5 ${ACTION_ICON.delete}`} />
                      <span>إنهاء نهائي</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Results history */}
      <div className="bg-white rounded-3xl border border-stone-200 p-5 shadow-2xs space-y-3">
        <h4 className="font-bold text-sm text-stone-900 flex items-center gap-2">
          <History className="w-4 h-4 text-rose-600" />
          <span>نتائج الاختبارات المنفّذة ({attempts.length})</span>
        </h4>
        {!loading && attempts.length === 0 && <p className="text-xs text-stone-400 py-4 text-center">لم تُسجَّل نتائج بعد.</p>}
        <div className="divide-y divide-stone-100">
          {attempts.map((a) => {
            const open = expandedAttempt === a.id;
            const qs = attemptQuestions[a.id];
            return (
              <div key={a.id} className="py-2.5 text-xs">
                <button onClick={() => toggleAttempt(a)} className="w-full flex items-center justify-between gap-3 text-right">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-stone-900">{a.candidate_name_snapshot}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          a.status === 'passed' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {a.status === 'passed' ? 'اجتازت' : 'لم تجتز'}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500">
                      {testTitle(a.test_id)} • المُختبِرة: {a.examiner_name_snapshot} • {a.attempt_date} • الأخطاء: {a.total_errors}
                      {a.max_errors_snapshot !== null && ` / ${a.max_errors_snapshot}`}
                    </p>
                  </div>
                  {open ? <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />}
                </button>
                {open && (
                  <div className="mt-2 p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
                    {!qs ? (
                      <p className="text-[11px] text-stone-400">جاري التحميل...</p>
                    ) : (
                      qs.map((q) => (
                        <div key={q.question_number} className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="text-stone-700">
                            {q.question_number}. {q.start_surah_name} [{q.start_ayah}] ⟵ {q.end_surah_name} [{q.end_ayah}] • {q.actual_lines} أسطر
                            {q.notes && <span className="text-stone-500"> — {q.notes}</span>}
                          </span>
                          <span className="font-mono font-bold text-stone-900 shrink-0">{q.errors_count ?? 0} أخطاء</span>
                        </div>
                      ))
                    )}
                    {a.notes && <p className="text-[11px] text-stone-600 pt-1 border-t border-stone-200">ملاحظات: {a.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Create / edit form */}
      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
              <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
                <Award className="w-5 h-5 text-rose-600" />
                {form.test_id ? 'تعديل الاختبار' : 'إنشاء اختبار جديد'}
              </h2>
              <button onClick={() => !saving && setForm(null)} className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs overflow-y-auto">
              {formError && <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">{formError}</div>}

              <div>
                <label className="block font-bold text-stone-700 mb-1">عنوان الاختبار (اختياري)</label>
                <input
                  type="text"
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={`اختبار الأرباع (${form.range_start} - ${form.range_end})`}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">من الربع *</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={form.range_start}
                    onChange={(e) => setForm({ ...form, range_start: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">إلى الربع *</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={form.range_end}
                    onChange={(e) => setForm({ ...form, range_end: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
              </div>
              {formBounds && (
                <p className="text-[11px] text-stone-500 -mt-2 leading-relaxed">
                  ابدأي من: {formBounds.start.label} • توقفي عند: {formBounds.stop.label}
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">عدد الأسئلة *</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.questions_count}
                    onChange={(e) => setForm({ ...form, questions_count: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">عدد الأسطر لكل سؤال *</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={form.lines_per_question}
                    onChange={(e) => setForm({ ...form, lines_per_question: Number(e.target.value) })}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">نوع الاختبار</label>
                  <select
                    value={form.test_type}
                    onChange={(e) => setForm({ ...form, test_type: e.target.value as PeerTestType })}
                    className={inputClass}
                  >
                    <option value="mandatory">إلزامي (يوقف التسميع بعد النطاق حتى الاجتياز)</option>
                    <option value="recommended">موصى به (لا يوقف التسميع)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">مستوى الصعوبة</label>
                  <select
                    value={form.difficulty}
                    onChange={(e) => setForm({ ...form, difficulty: e.target.value as PeerTestDifficulty })}
                    className={inputClass}
                  >
                    {Object.entries(PEER_DIFFICULTY_LABELS).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
                <label className="flex items-center gap-2 font-bold text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.has_max_errors}
                    onChange={(e) => setForm({ ...form, has_max_errors: e.target.checked })}
                  />
                  تحديد حد أقصى للأخطاء
                </label>
                {form.has_max_errors && (
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.max_errors}
                    onChange={(e) => setForm({ ...form, max_errors: Number(e.target.value) })}
                    className={inputClass}
                  />
                )}
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-stone-700">ظهور الاختبار للعضوات</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(
                    [
                      ['draft', 'مسودة'],
                      ['now', 'إظهار الآن'],
                      ['schedule', 'جدولة'],
                      ['hidden', 'مخفي'],
                    ] as [PeerTestVisibility, string][]
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => setForm({ ...form, visibility: value })}
                      className={`px-3 py-2 rounded-xl border font-bold transition ${
                        form.visibility === value ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-stone-200 bg-stone-50 text-stone-600 hover:bg-stone-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(form.visibility === 'schedule' || form.visibility === 'now') && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {form.visibility === 'schedule' && (
                      <div>
                        <label className="block text-stone-600 mb-1 flex items-center gap-1">
                          <CalendarClock className="w-3.5 h-3.5" /> يبدأ العرض في *
                        </label>
                        <input
                          type="datetime-local"
                          value={form.visible_from}
                          onChange={(e) => setForm({ ...form, visible_from: e.target.value })}
                          className={inputClass}
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-stone-600 mb-1 flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5" /> ينتهي العرض في (اختياري)
                      </label>
                      <input
                        type="datetime-local"
                        value={form.visible_until}
                        onChange={(e) => setForm({ ...form, visible_until: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-stone-500 leading-relaxed">
                  الاختبار الإلزامي يوقف تسميع ما بعد الربع {form.range_end} فقط أثناء ظهوره. لا يمكن أن يظهر اختباران في الوقت نفسه لهذه
                  الدفعة.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  disabled={saving}
                  className="px-4 py-2 font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 font-bold rounded-xl text-white bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 shadow-xs transition disabled:opacity-50"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ الاختبار'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Show (with impact) / finish confirmation */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-stone-200 p-6 space-y-4 text-stone-900">
            <h3 className="font-bold text-base">
              {confirm.kind === 'show' ? 'تأكيد إظهار الاختبار الإلزامي' : 'تأكيد إنهاء الاختبار نهائيًا'}
            </h3>
            {confirm.kind === 'show' ? (
              <div className="text-xs text-stone-600 leading-relaxed space-y-2">
                <p>
                  سيظهر «{confirm.test.title}» الآن لعضوات الدفعة، ولن تتمكن من لم تجتزه من تسميع ما بعد الربع {confirm.test.range_end}.
                </p>
                <p className="font-bold text-rose-800">
                  {confirm.blocked.length > 0
                    ? `سيتوقف تسميع ${confirm.blocked.length} عضوات فورًا حتى اجتياز الاختبار.`
                    : 'لن يتوقف تسميع أي عضوة فورًا.'}
                </p>
                {confirm.blocked.length > 0 && (
                  <p className="text-[11px] text-stone-500">{confirm.blocked.map((m) => m.name).join('، ')}</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-stone-600 leading-relaxed">
                سيُخفى «{confirm.test.title}» نهائيًا ولا يمكن إعادة إظهاره، ويُرفع أي إيقاف للتسميع مرتبط به. تبقى النتائج المسجّلة محفوظة.
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                onClick={() => setConfirm(null)}
                disabled={busyTestId !== null}
                className="px-4 py-2 text-xs font-semibold text-stone-600 hover:bg-stone-100 rounded-xl transition"
              >
                إلغاء
              </button>
              <button
                onClick={() => runStatus(confirm.test, confirm.kind === 'show' ? 'show' : 'finish')}
                disabled={busyTestId !== null}
                className={`px-5 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition disabled:opacity-50 ${
                  confirm.kind === 'show' ? 'bg-emerald-700 hover:bg-emerald-800' : CONFIRM_TONE.delete
                }`}
              >
                {busyTestId ? 'جاري التنفيذ...' : confirm.kind === 'show' ? 'إظهار الآن' : 'تأكيد الإنهاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sample questions preview */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden text-stone-900 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
              <div>
                <h3 className="font-bold text-base">معاينة عيّنة أسئلة (للمشرفة فقط)</h3>
                <p className="text-xs text-stone-500">{preview.test.title} • تتغير الأسئلة في كل اختبار فعلي</p>
              </div>
              <button onClick={() => setPreview(null)} className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-2 overflow-y-auto text-xs">
              {previewError && <p className="text-rose-700">{previewError}</p>}
              {preview.questions.map((q) => {
                const level = PEER_LEVEL_STYLES[q.difficulty_level];
                return (
                  <div key={q.question_number} className="p-3 rounded-xl border border-stone-200 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-5 h-5 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                        {q.question_number}
                      </span>
                      <span className="font-bold">
                        {q.start_surah_name} [آية {q.start_ayah}] ⟵ {q.end_surah_name} [آية {q.end_ayah}]
                      </span>
                      {level && <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${level.className}`}>{level.label}</span>}
                      <span className="text-[10px] text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded-md font-mono">{q.actual_lines} أسطر</span>
                    </div>
                    <p className="text-[11px] text-stone-500">
                      الصفحة {q.start_page} (سطر {q.start_line}) إلى الصفحة {q.end_page} (سطر {q.end_line})
                    </p>
                    <p className="font-quran text-sm text-stone-800">{q.start_text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
