// THE single definition of a member's delay status, including
// «مؤهلة للإقصاء» (eligible for elimination). Used by the admin dashboard,
// the member dashboard and the peer-tests Edge Function, so the rule can
// never drift between the UI and the server.
// Pure TypeScript only (bundled by both Vite and Deno).

import {
  calculateMemberRequiredQuarter,
  calculateMemberRevisionStatus,
} from './calculations.ts';
import type { RevisionLog } from './programTypes.ts';

/** Missed PAST items (today excluded) that make a member severely behind. */
export const SEVERE_DELAY_THRESHOLD = 3;

export interface MemberDelayStatus {
  requiredQuarter: number;
  isBehind: boolean;
  allCompletedUpToToday: boolean;
  missedQuarters: number[];
  missedQuartersCount: number;
  missedRevisionDaysCount: number;
  missedRevisionDates: string[];
  isSeverelyBehindRecitation: boolean;
  isSeverelyBehindRevision: boolean;
  /** «مؤهلة للإقصاء»: severely behind in Tasmi'a, revision, or both. */
  isSeverelyBehind: boolean;
  severeReasons: ('recitation' | 'revision')[];
}

export interface MemberDelayInput {
  memberId: string;
  quarterOfDay: number;
  activeCycleDates: string[];
  recitations: {
    member_id?: string;
    reciter_id?: string;
    quarter_number: number;
  }[];
  revisions: Pick<RevisionLog, 'member_id' | 'date'>[];
  todayDate: string;
  /** Join date in her current batch: revision days before it are not owed. */
  joinedOnDate?: string;
}

export function computeMemberDelayStatus(
  input: MemberDelayInput
): MemberDelayStatus {
  const quarterStatus = calculateMemberRequiredQuarter(
    input.memberId,
    input.quarterOfDay,
    input.recitations
  );

  const revStatus = calculateMemberRevisionStatus(
    input.memberId,
    input.activeCycleDates,
    input.revisions as RevisionLog[],
    input.todayDate,
    input.joinedOnDate
  );

  const missedQuartersCount = quarterStatus.pastMissedQuartersCount;
  const missedRevisionDaysCount = revStatus.pastMissedRevisionDaysCount;
  const isSeverelyBehindRecitation = missedQuartersCount >= SEVERE_DELAY_THRESHOLD;
  const isSeverelyBehindRevision = missedRevisionDaysCount >= SEVERE_DELAY_THRESHOLD;

  const severeReasons: ('recitation' | 'revision')[] = [];
  if (isSeverelyBehindRecitation) severeReasons.push('recitation');
  if (isSeverelyBehindRevision) severeReasons.push('revision');

  return {
    requiredQuarter: quarterStatus.requiredQuarter,
    isBehind: quarterStatus.isBehind,
    allCompletedUpToToday: quarterStatus.allCompletedUpToToday,
    missedQuarters: quarterStatus.pastMissedQuarters,
    missedQuartersCount,
    missedRevisionDaysCount,
    missedRevisionDates: revStatus.pastMissedDates,
    isSeverelyBehindRecitation,
    isSeverelyBehindRevision,
    isSeverelyBehind: isSeverelyBehindRecitation || isSeverelyBehindRevision,
    severeReasons,
  };
}
