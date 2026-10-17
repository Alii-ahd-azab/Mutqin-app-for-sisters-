// Peer-testing rules (pure functions, unit-tested; used by the Edge Function).
// Two rules are deliberately SEPARATE:
//   * a CANDIDATE must have completed the whole range, must not have passed
//     already, and must not be «مؤهلة للإقصاء»;
//   * an EXAMINER only needs to be an active member of the test's batch —
//     being «مؤهلة للإقصاء» does NOT prevent her from examining others.

import type { MemberDelayStatus } from '../logic/memberDelayStatus.ts';

export interface PeerTestRow {
  id: string;
  cycle_id: string;
  title: string;
  range_start: number;
  range_end: number;
  questions_count: number;
  lines_per_question: number;
  max_errors: number | null;
  test_type: 'mandatory' | 'recommended';
  difficulty: 'any' | 'easy' | 'medium' | 'hard' | 'mixed';
  status: 'draft' | 'published' | 'hidden' | 'finished';
  visible_from: string | null;
  visible_until: string | null;
}

/** Published and inside its show window (same rule as the database). */
export function isPeerTestLive(
  test: Pick<PeerTestRow, 'status' | 'visible_from' | 'visible_until'>,
  now: Date = new Date()
): boolean {
  if (test.status !== 'published') return false;
  const t = now.getTime();
  if (test.visible_from && Date.parse(test.visible_from) > t) return false;
  if (test.visible_until && Date.parse(test.visible_until) <= t) return false;
  return true;
}

/** Arabic reason when a member is «مؤهلة للإقصاء», otherwise null. */
export function eliminationReason(delay: MemberDelayStatus): string | null {
  if (delay.isSeverelyBehindRecitation && delay.isSeverelyBehindRevision) {
    return `مؤهلة للإقصاء بسبب تأخر التسميع (${delay.missedQuartersCount} أرباع فائتة) والمراجعة (${delay.missedRevisionDaysCount} أيام فائتة)`;
  }
  if (delay.isSeverelyBehindRecitation) {
    return `مؤهلة للإقصاء بسبب تأخر التسميع (${delay.missedQuartersCount} أرباع فائتة)`;
  }
  if (delay.isSeverelyBehindRevision) {
    return `مؤهلة للإقصاء بسبب تأخر المراجعة (${delay.missedRevisionDaysCount} أيام فائتة)`;
  }
  return null;
}

/** Quarters of the test range the member has not recited yet. */
export function missingRangeQuarters(
  test: Pick<PeerTestRow, 'range_start' | 'range_end'>,
  completedQuarters: Set<number>
): number[] {
  const missing: number[] = [];
  for (let q = test.range_start; q <= test.range_end; q++) {
    if (!completedQuarters.has(q)) missing.push(q);
  }
  return missing;
}

export interface CandidateEvaluation {
  is_eligible: boolean;
  reasons: string[];
  has_passed: boolean;
  missing_quarters: number;
  is_eliminable: boolean;
}

export function evaluateCandidate(input: {
  test: Pick<PeerTestRow, 'range_start' | 'range_end'>;
  completedQuarters: Set<number>;
  hasPassed: boolean;
  delay: MemberDelayStatus;
}): CandidateEvaluation {
  const reasons: string[] = [];

  if (input.hasPassed) {
    reasons.push('سبق لها اجتياز هذا الاختبار');
  }

  const missing = missingRangeQuarters(input.test, input.completedQuarters);
  if (missing.length > 0) {
    reasons.push(
      `لم تُتمّ تسميع جميع أرباع النطاق بعد (متبقٍ ${missing.length} من الأرباع ${input.test.range_start} إلى ${input.test.range_end})`
    );
  }

  const elimination = eliminationReason(input.delay);
  if (elimination) {
    reasons.push(elimination);
  }

  return {
    is_eligible: reasons.length === 0,
    reasons,
    has_passed: input.hasPassed,
    missing_quarters: missing.length,
    is_eliminable: input.delay.isSeverelyBehind,
  };
}

/**
 * The quarter the member would recite next: her first missing quarter,
 * or tomorrow's quarter when she is fully caught up.
 */
export function nextTasmiaQuarter(delay: MemberDelayStatus, quarterOfDay: number): number {
  return delay.allCompletedUpToToday ? quarterOfDay + 1 : delay.requiredQuarter;
}
