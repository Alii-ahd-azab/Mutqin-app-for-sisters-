import React from 'react';
import { Sparkles, Quote } from 'lucide-react';
import { sanitizeThoughtHtml, isThoughtContentEmpty } from '../lib/sanitizeHtml';

interface DailyThoughtCardProps {
  thoughtHtml?: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export const DailyThoughtCard: React.FC<DailyThoughtCardProps> = ({
  thoughtHtml,
  updatedAt,
  updatedBy,
}) => {
  // If no thought is saved or content is completely empty (after stripping tags/spaces),
  // hide the section entirely — do not show empty card or orphan header!
  if (!thoughtHtml || isThoughtContentEmpty(thoughtHtml)) {
    return null;
  }

  const safeHtml = sanitizeThoughtHtml(thoughtHtml);
  if (isThoughtContentEmpty(safeHtml)) {
    return null;
  }

  return (
    <div
      id="daily-thought-card"
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-pink-50/70 via-white to-rose-50/40 border border-pink-200/80 p-5 sm:p-6 shadow-xs transition hover:shadow-md animate-in fade-in duration-300"
    >
      {/* Decorative Quranic/Islamic ambient watermark icon */}
      <div className="pointer-events-none absolute -left-4 -bottom-4 text-pink-500/10">
        <Quote className="w-28 h-28 transform -scale-x-100" />
      </div>

      <div className="relative z-10 space-y-3">
        {/* Top badge / title */}
        <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-pink-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-pink-100 text-pink-700 flex items-center justify-center font-bold shadow-2xs">
              <Sparkles className="w-4 h-4 text-pink-600" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-rose-950 font-quran flex items-center gap-1.5">
                <span>خاطرة اليوم</span>
              </h3>
            </div>
          </div>

          <span className="text-[11px] font-medium text-pink-800/80 bg-pink-50 px-2.5 py-1 rounded-full border border-pink-200">
            تذكرة من إشراف المقرأة
          </span>
        </div>

        {/* Formatted Content with Admin's rich formatting styles */}
        <div
          dir="rtl"
          className="text-stone-900 leading-relaxed font-sans break-words selection:bg-amber-200 text-base"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />

        {/* Footer if updatedAt exists */}
        {updatedAt && (
          <div className="pt-1 flex items-center justify-end text-[10px] text-stone-400">
            <span>
              نُشرت بتاريخ: {new Date(updatedAt).toLocaleDateString('ar-EG', { dateStyle: 'medium' })}
              {updatedBy ? ` • ${updatedBy}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
