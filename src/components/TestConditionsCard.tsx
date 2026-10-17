import React from 'react';
import { PeerTest } from '../types';
import { getRangeBounds } from '../data/quranData';
import { PEER_DIFFICULTY_LABELS } from '../lib/peerTests';
import { Award, BookOpen, Layers, Sparkles, ShieldAlert, CheckCircle2, Info, RefreshCw } from 'lucide-react';

interface TestConditionsCardProps {
  test: PeerTest;
  className?: string;
}

// «شروط الاختبار» — the conditions set by the batch's admin.
export const TestConditionsCard: React.FC<TestConditionsCardProps> = ({ test, className = '' }) => {
  const bounds = getRangeBounds(test.range_start, test.range_end);
  const difficulty = PEER_DIFFICULTY_LABELS[test.difficulty] || PEER_DIFFICULTY_LABELS.any;
  const isMandatory = test.test_type === 'mandatory';
  const questionsLabel =
    test.questions_count === 1 ? 'سؤال واحد' : test.questions_count === 2 ? 'سؤالان' : `${test.questions_count} أسئلة`;

  return (
    <div className={`rounded-2xl bg-pink-50/60 border border-pink-100 p-4 text-xs text-stone-700 space-y-3.5 ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-pink-100 pb-2.5">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-rose-600" />
          <h4 className="font-bold text-sm text-stone-900">شروط الاختبار كما حدّدتها المشرفة</h4>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            isMandatory ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-green-50 text-green-800 border-green-200'
          }`}
        >
          {isMandatory ? 'اختبار إلزامي' : 'اختبار موصى به'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
        <div className="p-2.5 rounded-xl bg-white border border-pink-100 space-y-1">
          <div className="flex items-center gap-1.5 text-stone-500 font-medium">
            <BookOpen className="w-3.5 h-3.5 text-rose-500" />
            <span>نطاق الاختبار بالأرباع</span>
          </div>
          <div className="font-bold text-stone-900 text-xs">
            من الربع {test.range_start} إلى الربع {test.range_end}
          </div>
          <p className="text-[10px] text-stone-500 leading-snug">
            ابدأي من: {bounds.start.label}
            <br />
            توقفي عند: {bounds.stop.label}
          </p>
        </div>

        <div className="p-2.5 rounded-xl bg-white border border-pink-100 space-y-1">
          <div className="flex items-center gap-1.5 text-stone-500 font-medium">
            <Layers className="w-3.5 h-3.5 text-rose-500" />
            <span>عدد وطول الأسئلة</span>
          </div>
          <div className="font-bold text-stone-900 text-xs">
            {questionsLabel} • {test.lines_per_question} أسطر لكل سؤال
          </div>
          <p className="text-[10px] text-stone-500">يُحسب الطول تلقائيًا وفق أسطر مصحف المدينة (15 سطرًا في الصفحة).</p>
        </div>

        <div className="p-2.5 rounded-xl bg-white border border-pink-100 space-y-1">
          <div className="flex items-center gap-1.5 text-stone-500 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-rose-500" />
            <span>مستوى الصعوبة</span>
          </div>
          <div className="font-bold text-stone-900 text-xs">{difficulty.label}</div>
          <p className="text-[10px] text-stone-500">{difficulty.desc} (يُحسب من تشابه الآيات في المصحف).</p>
        </div>

        <div className="p-2.5 rounded-xl bg-white border border-pink-100 space-y-1">
          <div className="flex items-center gap-1.5 text-stone-500 font-medium">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
            <span>حد الأخطاء المسموح</span>
          </div>
          <div className="font-bold text-stone-900 text-xs">
            {test.max_errors !== null ? `${test.max_errors} أخطاء كحد أقصى` : 'بدون حد أقصى (للمتابعة فقط)'}
          </div>
          <p className="text-[10px] text-stone-500">
            {test.max_errors !== null
              ? 'تجاوز هذا الحد يعني عدم اجتياز المحاولة.'
              : 'تُسجَّل الأخطاء للتوثيق دون رسوب.'}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 pt-1 border-t border-pink-100 text-[11px] leading-relaxed">
        <div className="flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
          <div>
            <strong className="text-stone-900">شروط التأهل: </strong>
            <span>
              إتمام تسميع جميع أرباع النطاق (من الربع {test.range_start} إلى الربع {test.range_end})، وألا تكون العضوة مؤهلة
              للإقصاء بسبب تأخر التسميع أو المراجعة.
            </span>
          </div>
        </div>

        <div className="flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0 mt-0.5" />
          <div>
            <strong className="text-stone-900">نوع الاختبار وأثره: </strong>
            {isMandatory ? (
              <span>
                إلزامي: لا يمكن تسجيل تسميع أي ربع بعد الربع {test.range_end} قبل اجتياز هذا الاختبار، ما دام الاختبار معروضًا.
              </span>
            ) : (
              <span>موصى به: لقياس الإتقان، ولا يمنع تسجيل التسميع اليومي.</span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
          <div>
            <strong className="text-stone-900">إمكانية الإعادة: </strong>
            <span>في حال عدم الاجتياز يمكن إعادة المحاولة مع أي أخت من الدفعة حتى تحقيق النجاح.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
