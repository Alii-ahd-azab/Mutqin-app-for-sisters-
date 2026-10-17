import React, { useState } from 'react';
import { PeerTest } from '../types';
import { PEER_DIFFICULTY_LABELS } from '../lib/peerTests';
import { TestConditionsCard } from './TestConditionsCard';
import { Award, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';

interface PeerTestCardProps {
  test: PeerTest;
  hasPassed: boolean;
  isBlocked: boolean;
  onStart: () => void;
}

// Member dashboard card for the batch's live peer test.
export const PeerTestCard: React.FC<PeerTestCardProps> = ({ test, hasPassed, isBlocked, onStart }) => {
  const [showConditions, setShowConditions] = useState(false);
  const isMandatory = test.test_type === 'mandatory';

  return (
    <div className="rounded-3xl bg-gradient-to-l from-pink-50 via-white to-rose-50 border border-pink-200 p-5 shadow-2xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 mt-0.5 border border-rose-200">
            <Award className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  isMandatory ? 'bg-rose-50 text-rose-800 border-rose-200' : 'bg-green-50 text-green-800 border-green-200'
                }`}
              >
                {isMandatory ? 'اختبار إلزامي' : 'اختبار موصى به'}
              </span>
              <span className="text-xs font-bold text-stone-900">
                {test.title || `اختبار الأرباع (${test.range_start} ⟵ ${test.range_end})`}
              </span>
              {test.difficulty !== 'any' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-pink-50 text-pink-800 border border-pink-200">
                  الصعوبة: {PEER_DIFFICULTY_LABELS[test.difficulty]?.label}
                </span>
              )}
              {hasPassed && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-50 text-green-800 border border-green-200">
                  ✓ اجتزتِ هذا الاختبار بنجاح
                </span>
              )}
            </div>
            <p className="text-xs text-stone-600 leading-relaxed max-w-xl">
              اختبار الأرباع ({test.range_start} ⟵ {test.range_end}) بنظام تقييم الزميلات: اختبري إحدى أخواتكِ المستوفيات للشروط،
              ويولّد النظام الأسئلة ويحتسب الأخطاء وفق أسطر مصحف المدينة.
            </p>
          </div>
        </div>

        <button
          onClick={onStart}
          className="w-full sm:w-auto shrink-0 px-5 py-2.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-500 hover:from-pink-700 hover:to-rose-600 text-white font-bold text-xs shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
        >
          <Award className="w-4 h-4" />
          <span>بدء اختبار أخت</span>
        </button>
      </div>

      <div className="pt-2 border-t border-pink-100 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowConditions((prev) => !prev)}
          className="self-start text-[11px] font-bold text-rose-800 hover:text-rose-950 flex items-center gap-1.5 transition cursor-pointer"
        >
          <span>{showConditions ? 'إخفاء شروط الاختبار' : 'عرض شروط الاختبار'}</span>
          {showConditions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showConditions && <TestConditionsCard test={test} />}
      </div>

      {isBlocked && (
        <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-950 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold block">مطلوب اجتياز الاختبار الإلزامي لمواصلة التسميع</span>
            <p className="text-[11px] text-rose-800 leading-relaxed mt-0.5">
              لقد أتممتِ أرباع النطاق ({test.range_start} إلى {test.range_end})، ولا يمكن تسجيل تسميع الأرباع التالية قبل اجتياز هذا
              الاختبار. اطلبي من إحدى أخواتكِ في الدفعة إجراء الاختبار لكِ.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
