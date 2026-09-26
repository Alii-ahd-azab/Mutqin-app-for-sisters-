import React from 'react';
import { Award, Sparkles, HeartHandshake } from 'lucide-react';

interface CelebrationBannerProps {
  currentCycle: number;
  isAdmin: boolean;
  onFactoryResetClick?: () => void;
}

export const CelebrationBanner: React.FC<CelebrationBannerProps> = ({
  currentCycle,
  isAdmin,
  onFactoryResetClick,
}) => {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-rose-800 via-pink-900 to-rose-950 text-white p-6 sm:p-8 shadow-lg border border-pink-300/30 text-center my-6">
      <div className="relative z-10 max-w-2xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-pink-400/20 text-pink-200 border border-pink-300/40 text-sm font-semibold">
          <Sparkles className="w-4 h-4 text-pink-300" />
          <span>مبارك الختمة المباركة — تمام 240 ربعًا</span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold font-quran text-pink-100">
          ﴿ وَرَتِّلِ الْقُرْآنَ تَرْتِيلًا ﴾
        </h2>

        <p className="text-pink-100 text-sm sm:text-base leading-relaxed">
          هنيئاً لكنّ بفضل الله وتوفيقه إتمام ختم كتاب الله العزيز حفظاً ومراجعة لكامل المصحف الشريف (الدورة رقم {currentCycle}). نسأل الله أن يجعله شفيعاً وحجة لكنّ لا عليكنّ.
        </p>

        <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs border border-white/20 text-xs sm:text-sm text-pink-200 inline-block">
          خطة التقدم متجمدة حاليًا عند حالة "مكتملة"، ويمكن للمشرفة بدء دورة جديدة عبر خيار "إعادة الضبط".
        </div>

        {isAdmin && onFactoryResetClick && (
          <div className="pt-2">
            <button
              onClick={onFactoryResetClick}
              className="px-6 py-2.5 rounded-xl bg-pink-400 hover:bg-pink-300 text-rose-950 font-bold text-sm shadow-md transition transform active:scale-95 cursor-pointer"
            >
              بدء دورة ختمة جديدة الآن (إعادة الضبط)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const RestDayBanner: React.FC<{ note?: string }> = ({ note }) => {
  return (
    <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 sm:p-5 mb-6 text-amber-900 flex items-start gap-3 shadow-xs">
      <div className="p-2.5 bg-amber-100 rounded-xl text-amber-800 shrink-0 mt-0.5">
        <HeartHandshake className="w-5 h-5" />
      </div>
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-sm sm:text-base text-amber-950">
            اليوم يوم استدراك وراحة للمجموعة
          </h3>
          <span className="text-[11px] px-2.5 py-0.5 bg-amber-200/80 text-amber-900 rounded-full font-bold">
            التسجيل والاستدراك متاح
          </span>
        </div>
        <p className="text-xs sm:text-sm text-amber-900 leading-relaxed">
          {note ? (
            <span className="block font-medium mb-1">المناسبة / الملاحظة: {note}</span>
          ) : null}
          خطة التقدم اليومي للمجموعة متوقفة في هذا اليوم ولا يُحتسب ضمن الـ 240 يومًا (رقم ربع اليوم للمجموعة لا يتقدم). 
          <strong> أزرار وفورم تسجيل التسميع والمراجعة فعّالة بشكل طبيعي تمامًا</strong> لجميع الأعضاء لتعويض أي أرباع سابقة متأخرة تباعًا حتى ربع آخر يوم نشاط للمجموعة.
        </p>
      </div>
    </div>
  );
};

export const PauseBanner: React.FC<{ pausedAt?: string | null }> = ({ pausedAt }) => {
  return (
    <div className="rounded-2xl bg-orange-50 border-2 border-orange-300 p-4 sm:p-5 mb-6 text-orange-950 flex items-start gap-3 shadow-sm">
      <div className="p-2.5 bg-orange-100 rounded-xl text-orange-700 shrink-0 mt-0.5">
        <Sparkles className="w-5 h-5 text-orange-600" />
      </div>
      <div className="space-y-1 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-bold text-sm sm:text-base text-orange-950">
            البرنامج متوقف مؤقتًا من قِبل المشرف
          </h3>
          <span className="text-[11px] px-2.5 py-0.5 bg-orange-200/80 text-orange-900 rounded-full font-bold">
            متجمد مؤقتًا • التسجيل متاح
          </span>
        </div>
        <p className="text-xs sm:text-sm text-orange-900 leading-relaxed">
          تجمّد عدّاد أيام الدورة الـ 240 ورقم ربع اليوم للمجموعة طوال فترة الإيقاف.
          <strong> أزرار وفورم تسجيل التسميع والمراجعة تظل فعّالة ومتاحة بشكل طبيعي تمامًا</strong> لأي عضو يرغب في استدراك وتعويض أرباعه الفائتة بالترتيب حتى ربع آخر يوم نشاط قبل التجميد.
          {pausedAt && <span className="block mt-1 font-semibold text-orange-950">تاريخ بدء الإيقاف: {pausedAt}</span>}
        </p>
      </div>
    </div>
  );
};
