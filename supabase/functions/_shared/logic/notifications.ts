// In-app notifications (Sisters): DERIVED from the current program status, never stored as a source
// of truth. They read the results of the authoritative calculations (calculateMemberRequiredQuarter,
// calculateMemberRevisionStatus, calculateMemberDistantReviewStatus, computeMemberDelayStatus) and
// add no rule of their own, so a notification exists exactly while its condition does: catching up
// lowers or removes it, and the program date (05:00 Africa/Cairo) decides when a day becomes overdue.
//
// Each notification has a stable KEY: the same condition keeps the same key on every refresh (so the
// user's seen/archived state, stored per key in public.notification_states, maps back to it and no
// duplicate history accumulates), and a new situation gets a new key (a higher debt level, a new
// debt episode, another date). URGENT = the elimination-risk condition (3+ overdue days of Tasmi'a or
// normal review, for the member herself or in an admin's alerts); everything else is non-urgent.
// Same model as Mutqin for Men, with the Sisters' wording.
// Pure TypeScript (bundled by Vite and Deno).

import { addDays } from './programDate.ts';
import { formatArabicDateWithDayName } from './calculations.ts';
import { SEVERE_DELAY_THRESHOLD, type MemberDelayStatus } from './memberDelayStatus.ts';

/** Overdue days in one category that make the warning serious (and alert the admins). */
export const SERIOUS_DEBT_THRESHOLD = 3;

/** 1 day: light (yellow), 2 days: stronger (orange), 3 or more: serious (red). */
export type DebtLevel = 'light' | 'strong' | 'serious';

export function debtLevel(count: number): DebtLevel | null {
  if (count <= 0) return null;
  if (count >= SERIOUS_DEBT_THRESHOLD) return 'serious';
  return count === 2 ? 'strong' : 'light';
}

/** 3 or more overdue days: «3 أيام متأخرة» … «10 أيام متأخرة», «11 يومًا متأخرًا» … */
export function arabicLateDays(n: number): string {
  return n <= 10 ? `${n} أيام متأخرة` : `${n} يومًا متأخرًا`;
}

export type MemberNotificationKind =
  | 'tasmia-overdue'
  | 'revision-overdue'
  | 'distant-overdue'
  | 'rest-day'
  | 'distant-day'
  | 'rest-tomorrow'
  | 'distant-tomorrow';
export type NotificationTone = DebtLevel | 'info' | 'distant';

/** Where opening the notification leads on the member dashboard. */
export type MemberNotificationTarget =
  | { kind: 'tasmia'; quarter: number }
  | { kind: 'revision'; date: string }
  | { kind: 'distant'; assignmentId: string }
  | { kind: 'rest-day' }
  | { kind: 'overview' };

export interface MemberNotification {
  /** DOM-friendly id of the category (one per category, not per missed day). */
  id: string;
  /** Stable identity of this exact condition (seen/archived state is stored per key). */
  key: string;
  kind: MemberNotificationKind;
  tone: NotificationTone;
  /** Elimination-risk condition: opening the panel does not mark it seen. */
  urgent: boolean;
  title: string;
  body: string;
  note?: string;
  count?: number;
  target: MemberNotificationTarget;
}

export interface MemberNotificationInput {
  /** Scopes the keys (a member moved to another batch starts fresh there). */
  batchId: string;
  /** The program date (05:00 Africa/Cairo). */
  today: string;
  isActive: boolean;
  hasStarted: boolean;
  isCompleted: boolean;
  isRestDay: boolean;
  restDayNote?: string;
  /** calculateMemberRequiredQuarter: past missed quarters (one per program day) and the next one owed. */
  tasmia: { pastMissedCount: number; requiredQuarter: number };
  /** calculateMemberRevisionStatus: past program days with no review (oldest first). */
  revision: { pastMissedDates: string[] };
  /** calculateMemberDistantReviewStatus (active cycle). */
  distant: {
    overdue: { id: string; review_date: string }[];
    todayAssignment: { id: string; start_quarter: number; end_quarter: number; note?: string | null } | null;
    hasCompletedToday: boolean;
  };
  /** Tomorrow's (program date + 1) scheduled rest day / distant review, when one applies to her. */
  tomorrow?: {
    restDay?: { note?: string } | null;
    distant?: { id: string; start_quarter: number; end_quarter: number; note?: string | null } | null;
  };
}

const TONE_ORDER: Record<NotificationTone, number> = { serious: 0, strong: 1, light: 2, distant: 3, info: 4 };

/** «من بداية الربع X حتى بداية الربع Y»: the TO quarter is the stopping boundary (not reviewed). */
export function distantRangeLabel(start: number, end: number): string {
  return `من بداية الربع ${start} حتى بداية الربع ${end}`;
}

/**
 * A member's notifications: one per overdue category (Tasmi'a, normal review, distant review — never
 * merged into one number), today's schedule information (rest day, distant-review day) and
 * tomorrow's (rest day, distant review). Overdue warnings follow the dashboard's own delay alert:
 * only for an active member of a running program.
 */
export function buildMemberNotifications(input: MemberNotificationInput): MemberNotification[] {
  const out: MemberNotification[] = [];
  const b = input.batchId;
  const debtsApply = input.isActive && input.hasStarted && !input.isCompleted;

  if (debtsApply) {
    const n = input.tasmia.pastMissedCount;
    const level = debtLevel(n);
    if (level) {
      const q = input.tasmia.requiredQuarter;
      out.push({
        id: 'tasmia-overdue',
        // The debt episode is identified by its first missed quarter.
        key: `b:${b}:tasmia:${level}:q${q}`,
        kind: 'tasmia-overdue',
        tone: level,
        urgent: level === 'serious',
        count: n,
        title:
          level === 'light'
            ? 'لديكِ يوم تسميع متأخر'
            : level === 'strong'
            ? 'لديكِ يومان متأخران في التسميع'
            : `تنبيه شديد: لديكِ ${arabicLateDays(n)} في التسميع`,
        body:
          level === 'light'
            ? `الربع ${q} لم يُسمَّع في موعده، فبادري باستدراكه.`
            : level === 'strong'
            ? `بادري باستدراك التسميع قبل أن يتراكم، بدءًا من الربع ${q}.`
            : `أنتِ تقتربين من حد الاستبعاد. يرجى استدراك التسميع سريعًا بدءًا من الربع ${q} حتى لا تصبحي معرضة للاستبعاد.`,
        target: { kind: 'tasmia', quarter: q },
      });
    }

    const dates = input.revision.pastMissedDates;
    const rLevel = debtLevel(dates.length);
    if (rLevel) {
      const first = dates[0];
      const firstLabel = formatArabicDateWithDayName(first);
      out.push({
        id: 'revision-overdue',
        key: `b:${b}:revision:${rLevel}:${first}`,
        kind: 'revision-overdue',
        tone: rLevel,
        urgent: rLevel === 'serious',
        count: dates.length,
        title:
          rLevel === 'light'
            ? 'لديكِ يوم مراجعة متأخر'
            : rLevel === 'strong'
            ? 'لديكِ يومان متأخران في المراجعة'
            : `تنبيه شديد: لديكِ ${arabicLateDays(dates.length)} في المراجعة`,
        body:
          rLevel === 'light'
            ? `مراجعة ${firstLabel} لم تُؤكَّد بعد، فبادري باستدراكها.`
            : rLevel === 'strong'
            ? `بادري باستدراك المراجعة قبل أن تتراكم، بدءًا من مراجعة ${firstLabel}.`
            : `أنتِ تقتربين من حد الاستبعاد. يرجى استدراك المراجعة سريعًا بدءًا من مراجعة ${firstLabel} حتى لا تصبحي معرضة للاستبعاد.`,
        target: { kind: 'revision', date: first },
      });
    }

    // «المراجعة البعيدة»: its own debt, separate from the normal review (not part of the elimination
    // rule, so never urgent).
    const overdue = input.distant.overdue;
    if (overdue.length > 0) {
      const first = overdue[0];
      const firstLabel = formatArabicDateWithDayName(first.review_date);
      out.push({
        id: 'distant-overdue',
        key: `b:${b}:distant-overdue:${first.id}:${overdue.length}`,
        kind: 'distant-overdue',
        tone: overdue.length === 1 ? 'light' : 'strong',
        urgent: false,
        count: overdue.length,
        title:
          overdue.length === 1
            ? 'لديكِ مراجعة بعيدة متأخرة'
            : overdue.length === 2
            ? 'لديكِ مراجعتان بعيدتان متأخرتان'
            : `لديكِ ${overdue.length} ${overdue.length <= 10 ? 'مراجعات بعيدة متأخرة' : 'مراجعة بعيدة متأخرة'}`,
        body: `المراجعة البعيدة ليوم ${firstLabel} لم تُؤكَّد بعد. وهي مستقلة عن ورد المراجعة اليومي.`,
        target: { kind: 'distant', assignmentId: first.id },
      });
    }
  }

  if (input.hasStarted && input.isRestDay) {
    out.push({
      id: 'rest-day',
      key: `b:${b}:rest:${input.today}`,
      kind: 'rest-day',
      tone: 'info',
      urgent: false,
      title: 'اليوم يوم استدراك وراحة',
      body: 'اليوم راحة من التقدم المعتاد للبرنامج: لا ربع تسميع جديد ولا مراجعة يومية جديدة. وما كان عليكِ من أوراد متأخرة سابقة يبقى مطلوبًا للاستدراك.',
      note: input.restDayNote || undefined,
      target: { kind: 'rest-day' },
    });
  }

  const todayDistant = input.distant.todayAssignment;
  if (input.hasStarted && todayDistant) {
    out.push({
      id: 'distant-day',
      key: `b:${b}:distant-day:${todayDistant.id}`,
      kind: 'distant-day',
      tone: 'distant',
      urgent: false,
      title: 'اليوم مراجعة بعيدة',
      body: `المطلوب: ${distantRangeLabel(todayDistant.start_quarter, todayDistant.end_quarter)}. التقدم المعتاد للبرنامج (التسميع والمراجعة اليومية) متوقف اليوم.${
        input.distant.hasCompletedToday ? ' وقد أتممتِها اليوم، بارك الله فيكِ.' : ''
      }`,
      note: todayDistant.note || undefined,
      target: { kind: 'distant', assignmentId: todayDistant.id },
    });
  }

  // Tomorrow = the next program date (it starts at 05:00 Cairo).
  const tomorrow = addDays(input.today, 1);
  const tomorrowLabel = formatArabicDateWithDayName(tomorrow);
  if (input.tomorrow?.restDay) {
    out.push({
      id: 'rest-tomorrow',
      key: `b:${b}:rest-tomorrow:${tomorrow}`,
      kind: 'rest-tomorrow',
      tone: 'info',
      urgent: false,
      title: 'غدًا يوم راحة من التقدم المعتاد للبرنامج',
      body: `غدًا (${tomorrowLabel}) يوم استدراك وراحة: لا ربع تسميع جديد ولا مراجعة يومية جديدة، ويمكنكِ استدراك ما فاتكِ.`,
      note: input.tomorrow.restDay.note || undefined,
      target: { kind: 'overview' },
    });
  }
  const tDistant = input.tomorrow?.distant;
  if (tDistant) {
    out.push({
      id: 'distant-tomorrow',
      key: `b:${b}:distant-tomorrow:${tDistant.id}`,
      kind: 'distant-tomorrow',
      tone: 'distant',
      urgent: false,
      title: 'غدًا مراجعة بعيدة',
      body: `غدًا (${tomorrowLabel}) المطلوب: ${distantRangeLabel(tDistant.start_quarter, tDistant.end_quarter)}، بدل التقدم المعتاد للبرنامج.`,
      note: tDistant.note || undefined,
      target: { kind: 'overview' },
    });
  }

  return out.sort((a, c) => TONE_ORDER[a.tone] - TONE_ORDER[c.tone]);
}

/** An admin's alert (batch admin: her batches; master admin: the batches she follows). */
export interface BatchAdminAlert {
  id: string;
  /** Stable identity: batch, member, category and the debt episode (first missed day). */
  key: string;
  /** Admin alerts are always the urgent elimination-risk condition. */
  urgent: true;
  batchId: string;
  batchName: string;
  memberId: string;
  memberName: string;
  phone: string;
  category: 'tasmia' | 'revision';
  count: number;
  /** The existing «مؤهلة للإقصاء» rule (SEVERE_DELAY_THRESHOLD) — unchanged. */
  eligibleForExclusion: boolean;
}

const CATEGORY_LABEL: Record<BatchAdminAlert['category'], string> = { tasmia: 'التسميع', revision: 'المراجعة' };

/** Title/body of an admin alert (also its history snapshot). */
export function adminAlertText(a: BatchAdminAlert): { title: string; body: string } {
  return { title: a.memberName, body: `${a.phone} • ${a.batchName} • ${arabicLateDays(a.count)} في ${CATEGORY_LABEL[a.category]}` };
}

/**
 * Serious alerts of one batch: active members with 3 or more overdue days in Tasmi'a or in the normal
 * review (each category on its own). Fewer days never alert. `delays` comes from
 * computeMemberDelayStatus (computeBatchDelays), the same status the admin dashboard shows.
 */
export function buildBatchAdminAlerts(
  batch: { id: string; name: string },
  members: { id: string; name: string; phone: string }[],
  delays: Map<string, MemberDelayStatus>
): BatchAdminAlert[] {
  const out: BatchAdminAlert[] = [];
  for (const m of members) {
    const d = delays.get(m.id);
    if (!d) continue;
    const categories: [BatchAdminAlert['category'], number, string | number | undefined][] = [
      ['tasmia', d.missedQuartersCount, d.missedQuarters[0]],
      ['revision', d.missedRevisionDaysCount, d.missedRevisionDates[0]],
    ];
    for (const [category, count, first] of categories) {
      if (count < SERIOUS_DEBT_THRESHOLD) continue;
      out.push({
        id: `${batch.id}:${m.id}:${category}`,
        key: `alert:${batch.id}:${m.id}:${category}:${first ?? ''}`,
        urgent: true,
        batchId: batch.id,
        batchName: batch.name,
        memberId: m.id,
        memberName: m.name,
        phone: m.phone,
        category,
        count,
        eligibleForExclusion: count >= SEVERE_DELAY_THRESHOLD,
      });
    }
  }
  return out.sort((a, b) => b.count - a.count || a.memberName.localeCompare(b.memberName, 'ar'));
}

/** Persisted interaction state of one notification key (public.notification_states). */
export interface NotificationState {
  key: string;
  kind: string;
  tone: string;
  urgent: boolean;
  title: string;
  body: string;
  seenAt: string | null;
  archivedAt: string | null;
}

/**
 * Unread rule: an URGENT notification counts until it is clicked (archived); a non-urgent one until
 * the panel was opened while it showed (seen) or it was clicked. Archived notifications leave the
 * active list (they stay in «عرض كل التنبيهات»).
 */
export function isUnread(n: { key: string; urgent: boolean }, state?: Pick<NotificationState, 'seenAt' | 'archivedAt'>): boolean {
  if (state?.archivedAt) return false;
  return n.urgent || !state?.seenAt;
}

export function isArchived(n: { key: string }, states: Map<string, Pick<NotificationState, 'archivedAt'>>): boolean {
  return !!states.get(n.key)?.archivedAt;
}
