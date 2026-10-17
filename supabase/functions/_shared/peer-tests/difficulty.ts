import mushafLinesData from '../data/mushafLines.json' with { type: 'json' };

/**
 * Deterministic, explainable "recitation difficulty" model computed from the Mushaf text itself
 * (ported unchanged from Mutqin Men). No network calls, no AI at runtime: same input always gives the same score.
 *
 * Two signals per ayah:
 *  1) similarity  - how much of the ayah is made of word-sequences that also appear in other ayahs
 *                   (mutashabihat / repeated phrases, e.g. the refrain of Surat Ar-Rahman).
 *  2) trap        - after this ayah, how many other places in the Quran end with the same last words
 *                   but continue differently (the classic "wrong continuation" mistake).
 */

type Row = { surah: number; ayah: number; text: string };
const ROWS = mushafLinesData as unknown as Row[];

const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeWord(w: string): string {
  return w
    .replace(MARKS, '')
    .replace(/[ٱأإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي]/g, '');
}

function toWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

const SHINGLE = 4;

interface AyahFeatures {
  words: number;
  score: number; // 0..1
}

let FEATURES: AyahFeatures[] | null = null;

function buildFeatures(): AyahFeatures[] {
  const n = ROWS.length;
  const words: string[][] = ROWS.map((r) => toWords(r.text));

  // 1) shingle document-frequency
  const df = new Map<string, number>();
  const shinglesOf = (ws: string[]): string[] => {
    if (ws.length === 0) return [];
    if (ws.length < SHINGLE) return ['#' + ws.join(' ')];
    const out: string[] = [];
    for (let i = 0; i + SHINGLE <= ws.length; i++) out.push(ws.slice(i, i + SHINGLE).join(' '));
    return out;
  };
  for (let i = 0; i < n; i++) {
    for (const s of new Set(shinglesOf(words[i]))) df.set(s, (df.get(s) || 0) + 1);
  }

  const weight = (d: number) => (d < 2 ? 0 : Math.min(1, Math.log2(d) / 3)); // d=2:.33 d=4:.67 d>=8:1

  const similarity: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const ws = words[i];
    if (ws.length === 0) continue;
    if (ws.length < SHINGLE) {
      similarity[i] = weight(df.get('#' + ws.join(' ')) || 1);
      continue;
    }
    const cover: number[] = new Array(ws.length).fill(0);
    for (let k = 0; k + SHINGLE <= ws.length; k++) {
      const w = weight(df.get(ws.slice(k, k + SHINGLE).join(' ')) || 1);
      for (let p = k; p < k + SHINGLE; p++) cover[p] = Math.max(cover[p], w);
    }
    similarity[i] = cover.reduce((a, b) => a + b, 0) / ws.length;
  }

  // 2) continuation traps
  const sameSurahNext = (i: number) => i + 1 < n && ROWS[i + 1].surah === ROWS[i].surah;
  const tail = (ws: string[]) => ws.slice(-3).join(' ');
  const head = (ws: string[]) => ws.slice(0, 3).join(' ');
  const byTail = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (words[i].length === 0) continue;
    const key = tail(words[i]);
    const arr = byTail.get(key);
    if (arr) arr.push(i);
    else byTail.set(key, [i]);
  }
  const trap: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!sameSurahNext(i) || words[i].length === 0) continue;
    const others = byTail.get(tail(words[i])) || [];
    const myNext = head(words[i + 1]);
    const divergent = new Set<string>();
    for (const j of others) {
      if (j === i || !sameSurahNext(j)) continue;
      const theirNext = head(words[j + 1]);
      if (theirNext !== myNext) divergent.add(theirNext);
    }
    trap[i] = Math.min(1, divergent.size / 4);
  }

  return ROWS.map((_, i) => ({
    words: words[i].length,
    score: 0.55 * similarity[i] + 0.45 * trap[i],
  }));
}

function features(): AyahFeatures[] {
  if (!FEATURES) FEATURES = buildFeatures();
  return FEATURES;
}

/** Word-weighted mean difficulty (0..1) of the verses [startIdx..endIdx] inclusive. */
export function passageScore(startIdx: number, endIdx: number): number {
  const f = features();
  let num = 0;
  let den = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    num += f[i].score * Math.max(1, f[i].words);
    den += Math.max(1, f[i].words);
  }
  return den === 0 ? 0 : num / den;
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard';

/** Cut-points (score) for a given passage-length, taken from the distribution over the whole Quran. */
const CUTS = new Map<number, { easyMax: number; hardMin: number }>();

export function levelCuts(
  ends: (startIdx: number) => number,
  key: number
): { easyMax: number; hardMin: number } {
  const hit = CUTS.get(key);
  if (hit) return hit;
  const scores: number[] = [];
  for (let s = 0; s < ROWS.length; s++) scores.push(passageScore(s, ends(s)));
  scores.sort((a, b) => a - b);
  const q = (p: number) => scores[Math.min(scores.length - 1, Math.floor(p * scores.length))];
  const cuts = { easyMax: q(0.4), hardMin: q(0.75) };
  CUTS.set(key, cuts);
  return cuts;
}

export function levelOf(score: number, cuts: { easyMax: number; hardMin: number }): DifficultyLevel {
  if (score >= cuts.hardMin) return 'hard';
  if (score <= cuts.easyMax) return 'easy';
  return 'medium';
}
