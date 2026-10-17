// Peer-test question generator (ported from Mutqin Men; generation logic unchanged).
// Runs only inside the Edge Function: the Mushaf data never ships to the browser.
import mushafLinesData from '../data/mushafLines.json' with { type: 'json' };
import quranQuartersData from '../data/quranQuarters.json' with { type: 'json' };
import { passageScore, levelCuts, levelOf } from './difficulty.ts';
import type { DifficultyLevel } from './difficulty.ts';

export interface TestQuestion {
  question_number: number;
  start_surah: number;
  start_surah_name: string;
  start_ayah: number;
  start_text: string;
  start_page: number;
  start_line: number;
  end_surah: number;
  end_surah_name: string;
  end_ayah: number;
  end_text: string;
  end_page: number;
  end_line: number;
  target_lines: number;
  actual_lines: number;
  difficulty_level: DifficultyLevel;
  difficulty_score: number;
}

export interface MushafAyah {
  surah: number;
  ayah: number;
  surah_name: string;
  text: string;
  page: number;
  line_start: number;
  line_end: number;
  page_end: number;
}

export interface QuarterBoundary {
  quarter: number;
  juz: number;
  hizb?: number;
  quarterInHizb?: number;
  surahNumber: number;
  ayahNumber: number;
  surahName: string;
  ayahText?: string;
}

export const ALL_VERSES: MushafAyah[] = mushafLinesData as MushafAyah[];
export const ALL_QUARTERS: QuarterBoundary[] = quranQuartersData as QuarterBoundary[];

// Map (surah:ayah) -> verse index in ALL_VERSES
export const verseIndexMap = new Map<string, number>();
ALL_VERSES.forEach((v, idx) => {
  verseIndexMap.set(`${v.surah}:${v.ayah}`, idx);
});

export function getVerseByIndex(idx: number): MushafAyah | undefined {
  return ALL_VERSES[idx];
}

export function getVerseIndexBySurahAyah(surah: number, ayah: number): number | undefined {
  return verseIndexMap.get(`${surah}:${ayah}`);
}

/**
 * Returns the verse index for a given quarter's start.
 * Quarter 1 starts at index 0 (Al-Fatihah 1:1).
 */
export function getQuarterStartIndex(quarterNum: number): number {
  const q = Math.min(240, Math.max(1, quarterNum));
  if (q === 1) return 0;
  const quarterObj = ALL_QUARTERS[q - 1];
  if (!quarterObj) return 0;
  const idx = verseIndexMap.get(`${quarterObj.surahNumber}:${quarterObj.ayahNumber}`);
  return idx !== undefined ? idx : 0;
}

/**
 * Returns the verse index for a given quarter's end.
 * Quarter 240 ends at the end of the entire Quran (last verse index 6235).
 */
export function getQuarterEndIndex(quarterNum: number): number {
  const q = Math.min(240, Math.max(1, quarterNum));
  if (q >= 240) {
    return ALL_VERSES.length - 1;
  }
  // The end of quarter Q is the verse right before start of quarter Q+1
  const nextQStartIdx = getQuarterStartIndex(q + 1);
  return Math.max(0, nextQStartIdx - 1);
}

/**
 * Helper to compute absolute line number from page and line (15 lines per page).
 */
export function getAbsoluteLineStart(v: MushafAyah): number {
  return (v.page - 1) * 15 + v.line_start;
}

export function getAbsoluteLineEnd(v: MushafAyah): number {
  return (v.page_end - 1) * 15 + v.line_end;
}

/**
 * Estimate the total lines in the Madani Mushaf for the given quarter range.
 */
export function estimateRangeLines(rangeStart: number, rangeEnd: number): number {
  const startQuarter = Math.min(rangeStart, rangeEnd);
  const endQuarter = Math.max(rangeStart, rangeEnd);
  const minVerseIdx = getQuarterStartIndex(startQuarter);
  const maxVerseIdx = getQuarterEndIndex(endQuarter);

  const startVerse = ALL_VERSES[minVerseIdx];
  const endVerse = ALL_VERSES[maxVerseIdx];
  if (!startVerse || !endVerse) return 0;

  const startAbsLine = getAbsoluteLineStart(startVerse);
  const endAbsLine = getAbsoluteLineEnd(endVerse);
  return Math.max(1, endAbsLine - startAbsLine + 1);
}

/**
 * Finds the end verse for a question starting at `startVerseIdx` such that the recited
 * length equals or exceeds `targetLines` (or reaches maxAllowedVerseIdx).
 */
export function findQuestionEndVerse(
  startVerseIdx: number,
  targetLines: number,
  maxAllowedVerseIdx: number = ALL_VERSES.length - 1
): { endVerseIdx: number; actualLines: number } {
  const startVerse = ALL_VERSES[startVerseIdx];
  const startAbsLine = getAbsoluteLineStart(startVerse);

  let currentIdx = startVerseIdx;
  let endAbsLine = getAbsoluteLineEnd(startVerse);

  while (currentIdx < maxAllowedVerseIdx) {
    const linesCovered = endAbsLine - startAbsLine + 1;
    if (linesCovered >= targetLines) {
      break;
    }
    currentIdx++;
    endAbsLine = getAbsoluteLineEnd(ALL_VERSES[currentIdx]);
  }

  const actualLines = Math.max(1, endAbsLine - startAbsLine + 1);
  return {
    endVerseIdx: Math.min(currentIdx, maxAllowedVerseIdx),
    actualLines,
  };
}

export type TestDifficulty = 'any' | 'mixed' | DifficultyLevel;

interface Candidate {
  start: number;
  end: number;
  lines: number;
  score: number;
  level: DifficultyLevel;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generates up to `questionsCount` questions inside [rangeStart..rangeEnd] (quarters).
 * Guarantees:
 *  - every question starts at the beginning of an ayah and ends at the end of an ayah, fully inside the range;
 *  - every question has at least `linesPerQuestion` lines whenever the range is long enough;
 *  - questions never overlap and are spread across the range, returned in Mushaf order;
 *  - optional difficulty targeting ('easy' | 'medium' | 'hard' | 'mixed' balanced | 'any' = pure random).
 * May return fewer than requested if the range cannot hold that many non-overlapping questions.
 */
export function generateTestQuestions(
  rangeStart: number,
  rangeEnd: number,
  questionsCount: number,
  linesPerQuestion: number,
  difficulty: TestDifficulty = 'any'
): TestQuestion[] {
  const lo = getQuarterStartIndex(Math.min(rangeStart, rangeEnd));
  const hi = getQuarterEndIndex(Math.max(rangeStart, rangeEnd));
  return generateQuestionsInVerseRange(lo, hi, questionsCount, linesPerQuestion, difficulty);
}

/** Same generator, but the range is given as verse indices [lo..hi] (used by personal tests: surah ranges). */
export function generateQuestionsInVerseRange(
  lo: number,
  hi: number,
  questionsCount: number,
  linesPerQuestion: number,
  difficulty: TestDifficulty = 'any'
): TestQuestion[] {
  const count = Math.max(1, Math.floor(questionsCount));
  const target = Math.max(1, Math.floor(linesPerQuestion));

  const endsFor = (s: number) => findQuestionEndVerse(s, target).endVerseIdx;
  const cuts = levelCuts(endsFor, target);

  // All passages that fit completely inside the range.
  let cands: Candidate[] = [];
  for (let s = lo; s <= hi; s++) {
    const { endVerseIdx, actualLines } = findQuestionEndVerse(s, target, hi);
    if (actualLines < target) continue; // would be cut short by the end of the range
    const score = passageScore(s, endVerseIdx);
    cands.push({ start: s, end: endVerseIdx, lines: actualLines, score, level: levelOf(score, cuts) });
  }
  if (cands.length === 0) {
    // Range is shorter than the requested size: one truncated question covering the whole range.
    const { endVerseIdx, actualLines } = findQuestionEndVerse(lo, target, hi);
    const score = passageScore(lo, endVerseIdx);
    cands = [{ start: lo, end: endVerseIdx, lines: actualLines, score, level: levelOf(score, cuts) }];
  }

  // Desired level for each question slot.
  const levels: (DifficultyLevel | null)[] = [];
  const order: DifficultyLevel[] = shuffle(['easy', 'medium', 'hard'] as DifficultyLevel[]);
  for (let i = 0; i < count; i++) {
    if (difficulty === 'any') levels.push(null);
    else if (difficulty === 'mixed') levels.push(order[i % 3]);
    else levels.push(difficulty);
  }

  const chosen: Candidate[] = [];
  const overlaps = (c: Candidate) => chosen.some((x) => !(c.end < x.start || c.start > x.end));
  const pick = (pool: Candidate[], want: DifficultyLevel | null): Candidate | null => {
    const free = pool.filter((c) => !overlaps(c));
    if (free.length === 0) return null;
    const wanted = want ? free.filter((c) => c.level === want) : free;
    const from = wanted.length > 0 ? wanted : free;
    return from[Math.floor(Math.random() * from.length)];
  };

  // Pass 1: one question per equal slice of the range, so the test covers the whole range.
  const span = hi - lo + 1;
  for (let i = 0; i < count; i++) {
    const segLo = Math.floor(lo + (i * span) / count);
    const segHi = Math.floor(lo + ((i + 1) * span) / count) - 1;
    const c = pick(
      cands.filter((x) => x.start >= segLo && x.end <= segHi),
      levels[i]
    );
    if (c) chosen.push(c);
  }
  // Pass 2: fill remaining slots anywhere there is still room.
  for (let i = chosen.length; i < count; i++) {
    const c = pick(cands, levels[i]);
    if (!c) break;
    chosen.push(c);
  }

  chosen.sort((a, b) => a.start - b.start);
  return chosen.map((c, i) => {
    const startV = ALL_VERSES[c.start];
    const endV = ALL_VERSES[c.end];
    return {
      question_number: i + 1,
      start_surah: startV.surah,
      start_surah_name: startV.surah_name,
      start_ayah: startV.ayah,
      start_text: startV.text,
      start_page: startV.page,
      start_line: startV.line_start,
      end_surah: endV.surah,
      end_surah_name: endV.surah_name,
      end_ayah: endV.ayah,
      end_text: endV.text,
      end_page: endV.page_end,
      end_line: endV.line_end,
      target_lines: target,
      actual_lines: c.lines,
      difficulty_level: c.level,
      difficulty_score: Math.round(c.score * 100),
    };
  });
}
