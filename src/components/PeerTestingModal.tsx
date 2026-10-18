import React, { useEffect, useState } from 'react';
import { PeerTest, PeerTestAttempt, PeerTestCandidate, PeerTestQuestion, User } from '../types';
import { api } from '../api/client';
import { PEER_LEVEL_STYLES } from '../lib/peerTests';
import { TestConditionsCard } from './TestConditionsCard';
import { Award, Users, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronUp, ArrowRight, X } from 'lucide-react';

interface PeerTestingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  test: PeerTest;
  onCompleted: () => void;
}

// The examiner (logged-in member) chooses a sister, the server generates the
// questions, the examiner counts errors, and the server records the result.
export const PeerTestingModal: React.FC<PeerTestingModalProps> = ({ isOpen, onClose, currentUser, test, onCompleted }) => {
  const [candidates, setCandidates] = useState<PeerTestCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [selected, setSelected] = useState<PeerTestCandidate | null>(null);

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PeerTestQuestion[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [errors, setErrors] = useState<number[]>([]);
  const [questionNotes, setQuestionNotes] = useState<string[]>([]);
  const [overallNotes, setOverallNotes] = useState('');
  const [expanded, setExpanded] = useState<number | null>(0);
  // Examiner's own tracking of asked questions (local only, never submitted).
  // A done question stays done; "revealed" only lifts the dimming while it is open.
  const [doneQuestions, setDoneQuestions] = useState<boolean[]>([]);
  const [revealedQuestions, setRevealedQuestions] = useState<boolean[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [result, setResult] = useState<PeerTestAttempt | null>(null);

  const resetSession = () => {
    setSelected(null);
    setAttemptId(null);
    setQuestions([]);
    setErrors([]);
    setQuestionNotes([]);
    setOverallNotes('');
    setExpanded(0);
    setDoneQuestions([]);
    setRevealedQuestions([]);
  };

  const loadCandidates = async () => {
    setLoadingCandidates(true);
    setErrorMsg('');
    try {
      const res = await api.peerTestCandidates(test.id);
      setCandidates(res.candidates.filter((c) => c.id !== currentUser.id));
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر تحميل قائمة الأخوات');
    } finally {
      setLoadingCandidates(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      resetSession();
      setResult(null);
      setSubmitting(false);
      loadCandidates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, test.id]);

  if (!isOpen) return null;

  const handleStart = async (candidate: PeerTestCandidate) => {
    setSelected(candidate);
    setLoadingQuestions(true);
    setErrorMsg('');
    try {
      const res = await api.peerTestStart(test.id, candidate.id);
      setAttemptId(res.attempt_id);
      setQuestions(res.questions);
      setErrors(new Array(res.questions.length).fill(0));
      setQuestionNotes(new Array(res.questions.length).fill(''));
      setDoneQuestions(new Array(res.questions.length).fill(false));
      setRevealedQuestions(new Array(res.questions.length).fill(false));
      setExpanded(0);
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر بدء الاختبار');
      setSelected(null);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const changeErrors = (idx: number, delta: number) => {
    setErrors((prev) => {
      const next = [...prev];
      next[idx] = Math.min(99, Math.max(0, (next[idx] || 0) + delta));
      return next;
    });
  };

  const setFlag = (setter: React.Dispatch<React.SetStateAction<boolean[]>>, idx: number, value: boolean) => {
    setter((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  // First press marks the question done and dims it. There is no undo.
  const markQuestionDone = (idx: number) => {
    setFlag(setDoneQuestions, idx, true);
    setFlag(setRevealedQuestions, idx, false);
  };

  const doneCount = doneQuestions.filter(Boolean).length;

  const totalErrors = errors.reduce((sum, e) => sum + (e || 0), 0);
  const hasMax = test.max_errors !== null;
  const wouldPass = !hasMax || totalErrors <= (test.max_errors ?? 0);

  const handleSubmit = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const res = await api.peerTestSubmit({
        attempt_id: attemptId,
        errors,
        question_notes: questionNotes.map((n) => n.trim().slice(0, 300)),
        notes: overallNotes.trim() ? overallNotes.trim().slice(0, 300) : undefined,
      });
      setResult(res.attempt);
      onCompleted();
    } catch (err: any) {
      setErrorMsg(err?.message || 'تعذر اعتماد نتيجة الاختبار');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl border border-stone-200 max-w-2xl w-full p-6 shadow-2xl space-y-5 my-8 max-h-[90vh] flex flex-col text-stone-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-stone-100 pb-4 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-rose-50 text-rose-600">
                <Award className="w-5 h-5" />
              </span>
              <h3 className="font-bold text-lg text-stone-900">اختبار الزميلات (Peer Testing)</h3>
            </div>
            <p className="text-xs text-stone-500">
              نطاق الاختبار: <strong>من الربع {test.range_start} إلى الربع {test.range_end}</strong> • {test.questions_count}{' '}
              أسئلة ({test.lines_per_question} أسطر لكل سؤال)
            </p>
          </div>
          <button onClick={handleClose} className="p-2 text-stone-400 hover:text-stone-700 rounded-xl hover:bg-stone-100 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 space-y-5 pl-1">
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {result ? (
            <div className="py-8 text-center space-y-5">
              <div
                className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center ${
                  result.status === 'passed' ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-700'
                }`}
              >
                {result.status === 'passed' ? <CheckCircle2 className="w-10 h-10" /> : <XCircle className="w-10 h-10" />}
              </div>
              <div className="space-y-1">
                <h4 className="text-xl font-bold text-stone-900">
                  {result.status === 'passed' ? 'اجتازت الاختبار بنجاح وإتقان، بارك الله فيها!' : 'تم تسجيل النتيجة (لم تجتز الاختبار)'}
                </h4>
                <p className="text-xs text-stone-500">
                  العضوة المُختبَرة: <strong>{result.candidate_name_snapshot}</strong> • المُختبِرة: <strong>{currentUser.name}</strong>
                </p>
              </div>
              <div className="inline-flex items-center gap-4 p-4 rounded-2xl bg-stone-50 border border-stone-200 text-xs">
                <div>
                  <span className="text-stone-400 block text-[11px]">مجموع الأخطاء</span>
                  <span className="text-lg font-bold font-mono text-stone-800">{result.total_errors}</span>
                </div>
                {result.max_errors_snapshot !== null && (
                  <div>
                    <span className="text-stone-400 block text-[11px]">الحد الأقصى المسموح</span>
                    <span className="text-lg font-bold font-mono text-stone-800">{result.max_errors_snapshot}</span>
                  </div>
                )}
                <div>
                  <span className="text-stone-400 block text-[11px]">النتيجة الرسمية</span>
                  <span className={`font-bold text-xs ${result.status === 'passed' ? 'text-green-700' : 'text-rose-700'}`}>
                    {result.status === 'passed' ? 'ناجحة ومعتمدة' : 'تحتاج استدراكًا'}
                  </span>
                </div>
              </div>
              <div className="pt-2">
                <button
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl bg-stone-800 hover:bg-stone-900 text-white font-bold text-xs shadow-xs"
                >
                  إغلاق النافذة
                </button>
              </div>
            </div>
          ) : !selected ? (
            /* Step 1: choose a sister */
            <div className="space-y-4">
              <TestConditionsCard test={test} />

              <div>
                <h4 className="font-bold text-sm text-stone-900 flex items-center gap-2">
                  <Users className="w-4 h-4 text-rose-600" />
                  <span>اختاري الأخت التي ترغبين في اختبارها:</span>
                </h4>
                <p className="text-xs text-stone-500 mt-0.5">تظهر عضوات دفعتكِ مع بيان استيفاء كل منهن لشروط الاختبار.</p>
              </div>

              {loadingCandidates ? (
                <div className="py-12 text-center text-xs text-stone-400">جاري فحص استيفاء الأخوات للشروط...</div>
              ) : candidates.length === 0 ? (
                <div className="p-8 text-center space-y-2 rounded-2xl bg-stone-50 border border-stone-200">
                  <Users className="w-8 h-8 text-stone-300 mx-auto" />
                  <p className="text-xs text-stone-600 font-bold">لا توجد أخوات أخريات نشطات في الدفعة حاليًا.</p>
                </div>
              ) : (
                <div className="divide-y divide-stone-100 border border-stone-200 rounded-2xl overflow-hidden">
                  {candidates.map((c) => (
                    <div
                      key={c.id}
                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition ${
                        c.is_eligible ? 'bg-white hover:bg-pink-50/40' : 'bg-stone-50/60'
                      }`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-stone-900 text-sm">{c.name}</span>
                          {c.has_passed && (
                            <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-800 border border-green-200 text-[10px] font-bold">
                              سبق لها الاجتياز
                            </span>
                          )}
                        </div>
                        {!c.is_eligible &&
                          c.reasons
                            .filter((r) => !(c.has_passed && r.startsWith('سبق لها')))
                            .map((r, i) => (
                              <p key={i} className="text-[11px] text-amber-800 font-medium">
                                • {r}
                              </p>
                            ))}
                      </div>
                      <div className="shrink-0">
                        {c.is_eligible ? (
                          <button
                            onClick={() => handleStart(c)}
                            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold text-xs transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>بدء اختبار الأخت</span>
                            <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                          </button>
                        ) : (
                          <span className="text-[11px] text-stone-500 font-medium px-2 py-1 bg-stone-100 rounded-lg inline-block">
                            {c.has_passed ? 'سبق لها الاجتياز' : 'غير مستوفية للشروط'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Step 2: questions and error counting */
            <div className="space-y-5">
              <div className="p-3.5 rounded-2xl bg-pink-50/70 border border-pink-100 flex items-center justify-between gap-3 text-xs">
                <div>
                  <span className="text-rose-900/70 block text-[11px]">أنتِ تختبرين الآن أختكِ:</span>
                  <span className="font-bold text-rose-950 text-sm">{selected.name}</span>
                </div>
                {!submitting && (
                  <button
                    type="button"
                    onClick={resetSession}
                    className="text-[11px] text-stone-500 hover:text-stone-800 underline font-medium"
                  >
                    تغيير الأخت
                  </button>
                )}
              </div>

              {loadingQuestions ? (
                <div className="py-12 text-center text-xs text-stone-400">جاري توليد أسئلة الاختبار من مصحف المدينة...</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-stone-700">الأسئلة المولّدة ({questions.length} أسئلة):</span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${
                          questions.length > 0 && doneCount === questions.length
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-stone-100 text-stone-600 border-stone-200'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        تم سؤال {doneCount} من {questions.length}
                      </span>
                    </div>
                    <span className="text-stone-500 text-[11px]">
                      مجموع الأخطاء حتى الآن: <strong className="font-mono text-stone-900">{totalErrors}</strong>
                    </span>
                  </div>

                  {questions.map((q, idx) => {
                    const isOpen = expanded === idx;
                    const count = errors[idx] || 0;
                    const level = PEER_LEVEL_STYLES[q.difficulty_level];
                    const isDone = Boolean(doneQuestions[idx]);
                    // Done cards are dimmed unless the examiner has reopened one to look at it again.
                    const isDimmed = isDone && !(isOpen && revealedQuestions[idx]);
                    return (
                      <div
                        key={q.question_number}
                        // Any click on a done card lifts its dimming; the click itself still goes through.
                        onClickCapture={() => {
                          if (isDone && !revealedQuestions[idx]) setFlag(setRevealedQuestions, idx, true);
                        }}
                        className={`rounded-2xl border overflow-hidden shadow-2xs transition ${
                          isDimmed ? 'border-emerald-100 bg-stone-50/60' : isDone ? 'border-emerald-200 bg-white' : 'border-stone-200 bg-white'
                        }`}
                      >
                        <div
                          onClick={() => setExpanded(isOpen ? null : idx)}
                          className={`p-3.5 cursor-pointer flex items-center justify-between gap-3 text-xs select-none ${
                            isDimmed ? 'bg-stone-50/40 hover:bg-stone-100/60' : 'bg-stone-50 hover:bg-stone-100/80'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0 ${
                                isDone ? 'bg-emerald-600' : 'bg-rose-600'
                              }`}
                            >
                              {q.question_number}
                            </span>
                            <div className={`space-y-0.5 min-w-0 transition-opacity ${isDimmed ? 'opacity-60' : ''}`}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-stone-900">
                                  السؤال {q.question_number}: {q.start_surah_name} [آية {q.start_ayah}] ⟵ {q.end_surah_name} [آية {q.end_ayah}]
                                </span>
                                {level && (
                                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${level.className}`}>{level.label}</span>
                                )}
                                <span className="text-[10px] text-stone-600 bg-stone-200/70 px-1.5 py-0.5 rounded-md font-mono">
                                  {q.actual_lines} أسطر
                                </span>
                              </div>
                              <span className="text-[11px] text-stone-500 block">
                                الصفحة {q.start_page} (سطر {q.start_line}) إلى الصفحة {q.end_page} (سطر {q.end_line})
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {isDone ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                تم السؤال
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markQuestionDone(idx);
                                }}
                                className="px-2 py-0.5 rounded-full text-[11px] font-bold text-pink-700 bg-white border border-pink-200 hover:bg-pink-50 transition cursor-pointer"
                              >
                                تم السؤال
                              </button>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                count === 0 ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {count} أخطاء
                            </span>
                            {isOpen ? <ChevronUp className="w-4 h-4 text-stone-400" /> : <ChevronDown className="w-4 h-4 text-stone-400" />}
                          </div>
                        </div>

                        {isOpen && (
                          <div
                            className={`p-4 space-y-4 border-t border-stone-100 transition-opacity ${
                              isDimmed ? 'bg-stone-50/40 opacity-60' : 'bg-white'
                            }`}
                          >
                            <div className="space-y-2 p-3.5 rounded-xl bg-pink-50/50 border border-pink-100">
                              <p className="text-[11px] text-rose-900 font-bold">
                                اطلبي من الأخت التلاوة من بداية هذه الآية حتى نهاية الآية المحددة:
                              </p>
                              <div className="space-y-1 text-xs text-stone-800">
                                <div>
                                  <span className="text-rose-700 font-bold ml-1.5">ابدئي من:</span>
                                  <span className="font-quran text-sm text-stone-900">{q.start_text}</span>
                                  <span className="text-[11px] text-stone-400 mr-2">
                                    ({q.start_surah_name} - الآية {q.start_ayah})
                                  </span>
                                </div>
                                <div className="pt-1 border-t border-pink-100">
                                  <span className="text-rose-700 font-bold ml-1.5">توقفي عند نهاية:</span>
                                  <span className="font-quran text-sm text-stone-900">{q.end_text}</span>
                                  <span className="text-[11px] text-stone-400 mr-2">
                                    ({q.end_surah_name} - الآية {q.end_ayah})
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 pt-1">
                              <span className="text-xs font-bold text-stone-700">تسجيل أخطاء هذا السؤال:</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => changeErrors(idx, -1)}
                                  disabled={count <= 0 || submitting}
                                  className="w-8 h-8 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold text-sm flex items-center justify-center disabled:opacity-30"
                                >
                                  -
                                </button>
                                <span className="w-8 text-center font-bold font-mono text-base text-stone-900">{count}</span>
                                <button
                                  type="button"
                                  onClick={() => changeErrors(idx, 1)}
                                  disabled={submitting}
                                  className="w-8 h-8 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold text-sm flex items-center justify-center disabled:opacity-30"
                                >
                                  +
                                </button>
                              </div>
                            </div>

                            <input
                              type="text"
                              placeholder="ملاحظة حول أداء الأخت في هذا السؤال (اختياري)..."
                              value={questionNotes[idx] || ''}
                              maxLength={300}
                              onChange={(e) => {
                                const value = e.target.value;
                                setQuestionNotes((prev) => {
                                  const next = [...prev];
                                  next[idx] = value;
                                  return next;
                                });
                              }}
                              className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded-xl bg-stone-50 outline-hidden"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-bold text-stone-800">النتيجة الإجمالية المحتسبة:</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-stone-600">
                          إجمالي الأخطاء: <strong className="font-mono text-stone-900">{totalErrors}</strong>
                        </span>
                        {hasMax && (
                          <span
                            className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              wouldPass ? 'bg-green-50 text-green-800' : 'bg-rose-50 text-rose-800'
                            }`}
                          >
                            {wouldPass ? 'مستوفية للاجتياز' : 'تجاوزت حد الأخطاء'}
                          </span>
                        )}
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      maxLength={300}
                      placeholder="ملاحظات ختامية للأخت حول الاختبار كله (اختياري)..."
                      value={overallNotes}
                      onChange={(e) => setOverallNotes(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-stone-200 rounded-xl bg-white outline-hidden"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {selected && !result && (
          <div className="border-t border-stone-100 pt-4 flex items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={resetSession}
              disabled={submitting}
              className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-bold disabled:opacity-50"
            >
              رجوع لاختيار أخت أخرى
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || loadingQuestions || !attemptId}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold text-xs shadow-xs transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{submitting ? 'جاري الإرسال...' : 'إرسال واعتماد نتيجة الاختبار'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
