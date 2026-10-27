// Shared with the Edge Functions (single copy of the quarter boundaries).
import quartersJson from '../../supabase/functions/_shared/data/quranQuarters.json';

export interface QuarterDetail {
  number: number;
  juz: number;
  hizb: number;
  quarterInHizb: number; // 1, 2, 3, or 4
  surahName: string;
  surahNumber: number;
  ayahStart: number;
  // Mushaf page of the quarter's opening ayah (derived from mushafLines.json)
  page: number;
  ayahText: string;
}

export interface QuarterBound {
  surahName: string;
  surahNumber: number;
  ayahNumber: number;
  ayahText: string;
  label: string; // e.g. "سورة البقرة - الآية 26"
  isEndNotice?: boolean;
}

export interface QuarterBoundsResult {
  start: QuarterBound;
  stop: QuarterBound;
}

export const ALL_QUARTERS: QuarterDetail[] = quartersJson.map((item) => ({
  number: item.quarter,
  juz: item.juz,
  hizb: item.hizb,
  quarterInHizb: item.quarterInHizb,
  surahName: item.surahName,
  surahNumber: item.surahNumber,
  ayahStart: item.ayahNumber,
  page: item.page,
  ayahText: item.ayahText,
}));

/**
 * Returns exact data for a specific quarter number (1-240).
 * Quarter 1 starts at Surah Al-Baqarah Ayah 1 as configured for this program.
 * Quarters 2-240 exactly match the official King Fahd Complex / standard mushaf division.
 */
export function getQuarterInfo(quarterNum: number): QuarterDetail {
  const q = Math.min(240, Math.max(1, quarterNum));
  const found = ALL_QUARTERS[q - 1];
  if (found) {
    return found;
  }
  // Fallback if index out of range
  return ALL_QUARTERS[0];
}

/**
 * Returns "ابدأ من" and "توقف عند" for a single quarter (used in Recitation).
 * - "ابدأ من": The exact start of this quarter (Surah and Ayah).
 * - "توقف عند": The start of the next quarter (or end of Quran for quarter 240).
 */
export function getQuarterBounds(quarterNum: number): QuarterBoundsResult {
  const current = getQuarterInfo(quarterNum);

  const start: QuarterBound = {
    surahName: current.surahName,
    surahNumber: current.surahNumber,
    ayahNumber: current.ayahStart,
    ayahText: current.ayahText,
    label: `سورة ${current.surahName} - الآية ${current.ayahStart}`,
  };

  if (current.number < 240) {
    const nextQ = getQuarterInfo(current.number + 1);
    const stop: QuarterBound = {
      surahName: nextQ.surahName,
      surahNumber: nextQ.surahNumber,
      ayahNumber: nextQ.ayahStart,
      ayahText: nextQ.ayahText,
      label: `سورة ${nextQ.surahName} - الآية ${nextQ.ayahStart}`,
    };
    return { start, stop };
  }

  // Quarter 240 (last quarter of the Holy Quran)
  const stop: QuarterBound = {
    surahName: 'الناس',
    surahNumber: 114,
    ayahNumber: 6,
    ayahText: 'مِنَ ٱلْجِنَّةِ وَٱلنَّاسِ',
    label: 'سورة الناس - الآية 6 (ختام المصحف الشريف)',
    isEndNotice: true,
  };

  return { start, stop };
}

/**
 * Returns "ابدأ من" and "توقف عند" for a range of quarters (used in Revision).
 * - "ابدأ من": Start of the first quarter in the range (startQuarter).
 * - "توقف عند": Start of the quarter immediately following the end of the range (endQuarter + 1).
 * If endQuarter >= 240, stops at Surah An-Nas Ayah 6 (ختام المصحف الشريف).
 */
export function getRangeBounds(startQuarter: number, endQuarter: number): QuarterBoundsResult {
  const first = getQuarterInfo(startQuarter);

  const start: QuarterBound = {
    surahName: first.surahName,
    surahNumber: first.surahNumber,
    ayahNumber: first.ayahStart,
    ayahText: first.ayahText,
    label: `سورة ${first.surahName} - الآية ${first.ayahStart}`,
  };

  const clampedEnd = Math.max(startQuarter, Math.min(240, endQuarter));

  if (clampedEnd < 240) {
    const nextQ = getQuarterInfo(clampedEnd + 1);
    const stop: QuarterBound = {
      surahName: nextQ.surahName,
      surahNumber: nextQ.surahNumber,
      ayahNumber: nextQ.ayahStart,
      ayahText: nextQ.ayahText,
      label: `سورة ${nextQ.surahName} - الآية ${nextQ.ayahStart}`,
    };
    return { start, stop };
  }

  // Clamped end is 240
  const stop: QuarterBound = {
    surahName: 'الناس',
    surahNumber: 114,
    ayahNumber: 6,
    ayahText: 'مِنَ ٱلْجِنَّةِ وَٱلنَّاسِ',
    label: 'سورة الناس - الآية 6 (ختام المصحف الشريف)',
    isEndNotice: true,
  };

  return { start, stop };
}

/**
 * «المراجعة البعيدة» range: «من الربع X» starts at the beginning of quarter X and «إلى الربع Y» is
 * the stopping boundary — the BEGINNING of quarter Y (Y itself is not reviewed). Only for distant
 * reviews; the daily review keeps getRangeBounds (end quarter included).
 */
export function getDistantReviewBounds(fromQuarter: number, toQuarter: number): QuarterBoundsResult {
  const bound = (q: QuarterDetail): QuarterBound => ({
    surahName: q.surahName,
    surahNumber: q.surahNumber,
    ayahNumber: q.ayahStart,
    ayahText: q.ayahText,
    label: `سورة ${q.surahName} - الآية ${q.ayahStart}`,
  });
  return { start: bound(getQuarterInfo(fromQuarter)), stop: bound(getQuarterInfo(toQuarter)) };
}

/** Number of quarters reviewed in a distant-review range (the TO quarter is the boundary). */
export function distantReviewQuarterCount(fromQuarter: number, toQuarter: number): number {
  return Math.max(0, toQuarter - fromQuarter);
}
