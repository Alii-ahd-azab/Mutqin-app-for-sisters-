// The 05:00 Africa/Cairo program date, «المراجعة البعيدة» in the program calendar, and the derived
// notifications (pure; no network). Every date below goes through programDate(), and every status
// through the same shared calculations the dashboards use; the notifications only read those results.
// Same cases as Mutqin for Men, with the Sisters' rules (no fresh start, «مؤهلة للإقصاء» at 3) and wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  membershipDate,
  nextProgramDayStart,
  programDate,
  programDayStart,
  PROGRAM_TIME_ZONE,
} from '../supabase/functions/_shared/logic/programDate.ts';
import {
  calculateCycleInfo,
  calculateMemberDistantReviewStatus,
  calculateMemberRequiredQuarter,
  calculateMemberRevisionStatus,
  getActiveCycleDates,
  getCurrentWeekRange,
  isPausedDate,
  joinedOnDateFromTimestamp,
} from '../supabase/functions/_shared/logic/calculations.ts';
import { computeMemberDelayStatus } from '../supabase/functions/_shared/logic/memberDelayStatus.ts';
import { buildProgramSettings } from '../supabase/functions/_shared/logic/programState.ts';
import { computeBatchDelays, computeMembersDelays } from '../supabase/functions/_shared/logic/batchDelays.ts';
import {
  buildBatchAdminAlerts,
  buildMemberNotifications,
  debtLevel,
  isUnread,
  SERIOUS_DEBT_THRESHOLD,
} from '../supabase/functions/_shared/logic/notifications.ts';
import { ALL_QUARTERS, distantReviewQuarterCount, getDistantReviewBounds, getQuarterInfo } from '../src/data/quranData.ts';
import mushafLines from '../supabase/functions/_shared/data/mushafLines.json' with { type: 'json' };
import type {
  DistantReviewAssignment,
  DistantReviewCompletion,
  GroupSettings,
  RecitationLog,
  RestDay,
  RevisionLog,
} from '../supabase/functions/_shared/logic/programTypes.ts';

// ---------------------------------------------------------------------------------------------
// Program date: 05:00 Africa/Cairo
// ---------------------------------------------------------------------------------------------

/** The instant of a Cairo wall-clock time, given Cairo's UTC offset on that day (+3 summer, +2 winter). */
const cairo = (date: string, time: string, offsetHours: 2 | 3) =>
  new Date(Date.parse(`${date}T${time}Z`) - offsetHours * 3600_000);

const BOUNDARY_CASES: [string, string][] = [
  ['00:00:00', 'previous'],
  ['02:00:00', 'previous'],
  ['04:30:00', 'previous'],
  ['04:59:59', 'previous'],
  ['05:00:00', 'new'],
  ['05:00:01', 'new'],
  ['12:00:00', 'new'],
  ['23:59:59', 'new'],
];

for (const [label, date, offset] of [
  ['summer (UTC+3, DST)', '2026-07-15', 3],
  ['winter (UTC+2)', '2026-01-15', 2],
  ['the example date 2026-10-28 (UTC+3)', '2026-10-28', 3],
  ['after DST ends, 2026-11-02 (UTC+2)', '2026-11-02', 2],
] as const) {
  test(`program date: the day changes at exactly 05:00 Cairo — ${label}`, () => {
    for (const [time, expected] of BOUNDARY_CASES) {
      const got = programDate(cairo(date, time, offset));
      assert.equal(got, expected === 'new' ? date : addDays(date, -1), `${date} ${time} Cairo`);
    }
  });
}

test('program date uses the Africa/Cairo rules, not a fixed UTC offset', () => {
  assert.equal(PROGRAM_TIME_ZONE, 'Africa/Cairo');
  // The same UTC time of day falls on different sides of 05:00 Cairo in summer and in winter.
  assert.equal(programDate(new Date('2026-07-15T02:30:00Z')), '2026-07-15'); // 05:30 Cairo (UTC+3)
  assert.equal(programDate(new Date('2026-01-15T02:30:00Z')), '2026-01-14'); // 04:30 Cairo (UTC+2)
  // Either fixed offset gets one of them wrong.
  const fixed = (iso: string, h: number) => new Date(Date.parse(iso) + (h - 5) * 3600_000).toISOString().slice(0, 10);
  assert.notEqual(fixed('2026-01-15T02:30:00Z', 3), programDate(new Date('2026-01-15T02:30:00Z')));
  assert.notEqual(fixed('2026-07-15T02:30:00Z', 2), programDate(new Date('2026-07-15T02:30:00Z')));
  // Start of a program day, in both offsets; the next start from any instant.
  assert.equal(programDayStart('2026-10-28').toISOString(), '2026-10-28T02:00:00.000Z');
  assert.equal(programDayStart('2026-01-15').toISOString(), '2026-01-15T03:00:00.000Z');
  assert.equal(nextProgramDayStart(cairo('2026-10-28', '04:59:59', 3)).toISOString(), '2026-10-28T02:00:00.000Z');
  assert.equal(nextProgramDayStart(cairo('2026-10-28', '05:00:00', 3)).toISOString(), '2026-10-29T02:00:00.000Z');
  // Across the end of DST (night of 29→30 October 2026) the next start is 05:00 standard time.
  assert.equal(nextProgramDayStart(new Date('2026-10-29T12:00:00Z')).toISOString(), '2026-10-30T03:00:00.000Z');
});

test("program date ignores the device's time zone", () => {
  const saved = process.env.TZ;
  const instant = cairo('2026-10-28', '04:59:59', 3);
  const results = new Set<string>();
  try {
    for (const tz of ['Africa/Cairo', 'Asia/Riyadh', 'Europe/London', 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      process.env.TZ = tz;
      results.add(programDate(instant));
      results.add(programDate(new Date(instant.getTime() + 1000)));
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
  assert.deepEqual([...results].sort(), ['2026-10-27', '2026-10-28']);
});

test('stored membership dates keep their Makkah calendar date (no join date moves)', () => {
  // Join timestamps whose Cairo-05:00 date would be one day earlier.
  assert.equal(membershipDate('2026-09-19T21:02:47.654+00:00'), '2026-09-20');
  assert.equal(membershipDate('2026-09-18T23:23:15.158+00:00'), '2026-09-19');
  assert.equal(joinedOnDateFromTimestamp('2026-09-17T21:05:25.606+00:00'), '2026-09-18');
});

// ---------------------------------------------------------------------------------------------
// A small program: started 2026-10-20, every date-sensitive status read at a Cairo instant
// ---------------------------------------------------------------------------------------------

const START = '2026-10-20';
const settingsOf = (extra: Partial<GroupSettings> = {}): GroupSettings => ({
  id: 'c',
  start_date: START,
  total_quarters: 240,
  review_window: 8,
  current_cycle_number: 1,
  is_paused: false,
  paused_at: null,
  total_paused_days: 0,
  pause_periods: [],
  ...extra,
});
const rest = (date: string, note = ''): RestDay => ({ id: `r-${date}`, date, note, added_by_admin_id: 'a', created_at: '' });
const tasmia = (member: string, quarters: number[]): RecitationLog[] =>
  quarters.map((q) => ({ id: `t-${member}-${q}`, member_id: member, member_name: member, quarter_number: q, cycle_number: 1, date: START, created_at: '' }));
const reviews = (member: string, dates: string[]): RevisionLog[] =>
  dates.map((d) => ({ id: `v-${member}-${d}`, member_id: member, member_name: member, date: d, cycle_number: 1, review_start_quarter: 1, review_end_quarter: 1, created_at: '' }));
const assignment = (date: string, start: number, end: number, note?: string): DistantReviewAssignment => ({
  id: `d-${date}`,
  batch_id: 'b',
  cycle_id: 'c',
  review_date: date,
  start_quarter: start,
  end_quarter: end,
  note,
  created_at: '',
  updated_at: '',
});
const JOINED = '2026-10-19T12:00:00Z';

interface World {
  settings?: GroupSettings;
  restDays?: RestDay[];
  recitations?: RecitationLog[];
  revisions?: RevisionLog[];
  distant?: DistantReviewAssignment[];
  completions?: DistantReviewCompletion[];
  joinedAt?: string;
  isActive?: boolean;
}

/** The member dashboard's pipeline (MemberDashboard.tsx) at an instant, for member "m". */
function memberAt(instant: Date, w: World) {
  const settings = w.settings ?? settingsOf({ distant_review_dates: (w.distant ?? []).map((a) => a.review_date) });
  const restDays = w.restDays ?? [];
  const today = programDate(instant);
  const cycleInfo = calculateCycleInfo(settings, restDays, today);
  const activeDates = getActiveCycleDates(cycleInfo.start_date, today, restDays, settings);
  const joined = joinedOnDateFromTimestamp(w.joinedAt ?? JOINED);
  const quarter = calculateMemberRequiredQuarter('m', cycleInfo.quarter_of_day, w.recitations ?? []);
  const revision = calculateMemberRevisionStatus('m', activeDates, w.revisions ?? [], today, joined);
  const distant = calculateMemberDistantReviewStatus('m', cycleInfo.has_started ? w.distant ?? [] : [], w.completions ?? [], settings, restDays, today, joined);
  // Tomorrow's schedule, as MemberDashboard reads it.
  const tomorrow = addDays(today, 1);
  const tomorrowApplies = tomorrow >= cycleInfo.start_date && !isPausedDate(settings, tomorrow) && !(joined && tomorrow < joined);
  const tRest = tomorrowApplies ? restDays.find((r) => r.date === tomorrow) : undefined;
  const tDistant = tomorrowApplies && !tRest && (w.isActive ?? true) ? (w.distant ?? []).find((a) => a.review_date === tomorrow) : undefined;
  const notifications = buildMemberNotifications({
    batchId: 'b',
    today,
    isActive: w.isActive ?? true,
    hasStarted: cycleInfo.has_started,
    isCompleted: cycleInfo.is_completed,
    isRestDay: cycleInfo.is_rest_day,
    restDayNote: cycleInfo.rest_day_note,
    tasmia: { pastMissedCount: quarter.pastMissedQuartersCount, requiredQuarter: quarter.requiredQuarter },
    revision: { pastMissedDates: revision.pastMissedDates },
    distant: { overdue: distant.overdue, todayAssignment: distant.todayAssignment, hasCompletedToday: distant.hasCompletedToday },
    tomorrow: { restDay: tRest ? { note: tRest.note } : null, distant: tDistant ?? null },
  });
  return { today, cycleInfo, activeDates, quarter, revision, distant, notifications };
}
const kinds = (r: ReturnType<typeof memberAt>) => r.notifications.map((n) => `${n.kind}:${n.tone}${n.count ? ':' + n.count : ''}`);

const BEFORE = cairo('2026-10-28', '04:59:59', 3);
const AT = cairo('2026-10-28', '05:00:00', 3);
const datesUpTo = (last: string) => {
  const out: string[] = [];
  for (let d = START; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
};

test("05:00 Cairo: new Tasmi'a quarter and new review range appear at 05:00, not at midnight", () => {
  const at0000 = memberAt(cairo('2026-10-28', '00:00:00', 3), {});
  const before = memberAt(BEFORE, {});
  const at = memberAt(AT, {});
  assert.equal(at0000.today, '2026-10-27');
  assert.equal(before.cycleInfo.quarter_of_day, 8); // 20..27 October = days 1..8
  assert.equal(at0000.cycleInfo.quarter_of_day, 8);
  assert.equal(at.cycleInfo.quarter_of_day, 9);
  assert.deepEqual([before.cycleInfo.review_start, before.cycleInfo.review_end], [1, 8]);
  assert.deepEqual([at.cycleInfo.review_start, at.cycleInfo.review_end], [2, 9]);
});

test("05:00 Cairo: an unfinished day becomes overdue at 05:00 (Tasmi'a, review, notifications)", () => {
  const w: World = {
    recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7]), // quarter 8 (27 Oct) not recited
    revisions: reviews('m', datesUpTo('2026-10-26')), // 27 Oct not reviewed
    distant: [],
  };
  const before = memberAt(BEFORE, w);
  assert.equal(before.quarter.pastMissedQuartersCount, 0, 'quarter 8 is still today at 04:59:59');
  assert.equal(before.revision.pastMissedRevisionDaysCount, 0);
  assert.deepEqual(kinds(before), []);
  const at = memberAt(AT, w);
  assert.equal(at.quarter.pastMissedQuartersCount, 1);
  assert.deepEqual(at.revision.pastMissedDates, ['2026-10-27']);
  assert.deepEqual(kinds(at), ['tasmia-overdue:light:1', 'revision-overdue:light:1']);
});

test('05:00 Cairo: a rest day scheduled for 28 Oct becomes today at 05:00 (and its notification)', () => {
  const w: World = { restDays: [rest('2026-10-28', 'يوم استدراك')], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) };
  for (const instant of [cairo('2026-10-28', '00:01:00', 3), BEFORE]) {
    const r = memberAt(instant, w);
    assert.equal(r.cycleInfo.is_rest_day, false);
    assert.deepEqual(kinds(r), ['rest-tomorrow:info'], 'before 05:00 it is still tomorrow');
  }
  const at = memberAt(AT, w);
  assert.equal(at.cycleInfo.is_rest_day, true);
  assert.equal(at.cycleInfo.quarter_of_day, 8, 'no new quarter on the rest day');
  assert.equal(at.revision.isTodayProgramDay, false, 'no new review obligation on the rest day');
  assert.deepEqual(kinds(at), ['rest-day:info']);
  assert.equal(at.notifications[0].note, 'يوم استدراك');
  assert.deepEqual(at.notifications[0].target, { kind: 'rest-day' });
  assert.match(at.notifications[0].body, /عليكِ/);
});

test('05:00 Cairo: a distant-review day becomes today at 05:00; its notification shows the range and note', () => {
  const a = assignment('2026-10-28', 1, 9, 'راجعي جيدًا');
  const w: World = { distant: [a], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) };
  const before = memberAt(BEFORE, w);
  assert.equal(before.cycleInfo.is_distant_review_day, false);
  assert.equal(before.distant.todayAssignment, null);
  assert.deepEqual(kinds(before), ['distant-tomorrow:distant'], 'before 05:00 it is the notice for tomorrow');
  assert.match(before.notifications[0].body, /من بداية الربع 1 حتى بداية الربع 9/);
  assert.equal(before.notifications[0].note, 'راجعي جيدًا');
  const at = memberAt(AT, w);
  assert.equal(at.cycleInfo.is_distant_review_day, true);
  assert.equal(at.cycleInfo.quarter_of_day, 8, 'normal Tasmi\'a progression paused');
  assert.deepEqual([at.cycleInfo.review_start, at.cycleInfo.review_end], [1, 8], 'normal review progression paused');
  assert.equal(at.revision.isTodayProgramDay, false, 'no new normal review obligation');
  assert.deepEqual(kinds(at), ['distant-day:distant']);
  const n = at.notifications[0];
  assert.match(n.title, /اليوم مراجعة بعيدة/);
  assert.match(n.body, /المطلوب: من بداية الربع 1 حتى بداية الربع 9/);
  assert.equal(n.note, 'راجعي جيدًا');
  assert.deepEqual(n.target, { kind: 'distant', assignmentId: a.id });
  // Not completed by the next 05:00: its own overdue notification, separate from the normal review.
  const next = memberAt(cairo('2026-10-29', '05:00:00', 3), { ...w, revisions: reviews('m', datesUpTo('2026-10-28')), recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8, 9]) });
  assert.equal(next.cycleInfo.quarter_of_day, 9, 'the next day continues with quarter 9 (the distant day consumed none)');
  assert.deepEqual(kinds(next), ['distant-overdue:light:1']);
  assert.deepEqual(next.notifications[0].target, { kind: 'distant', assignmentId: a.id });
  assert.equal(next.revision.pastMissedRevisionDaysCount, 0, 'distant debt is not counted as normal review debt');
  const stillBefore = memberAt(cairo('2026-10-29', '04:59:59', 3), { ...w, revisions: reviews('m', datesUpTo('2026-10-27')) });
  assert.deepEqual(kinds(stillBefore), ['distant-day:distant'], 'not overdue before 05:00');
  // Completed: never owed again.
  const done = memberAt(cairo('2026-10-30', '12:00:00', 2), {
    ...w,
    completions: [{ id: 'x', assignment_id: a.id, member_id: 'm', completed_at: '', completed_on: '2026-10-29' }],
    recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    revisions: reviews('m', datesUpTo('2026-10-30')),
  });
  assert.deepEqual(kinds(done), []);
  assert.equal(done.distant.overdueCount, 0);
});

test('distant review: Monday quarter N, Tuesday distant review (still N), Wednesday quarter N + 1 (no normal program day consumed)', () => {
  const start = '2026-09-03';
  const settings = settingsOf({ start_date: start, distant_review_dates: ['2026-10-06'] });
  const monday = '2026-10-05';
  const day = (d: string) => calculateCycleInfo(settings, [], d);
  const q = day(monday).quarter_of_day;
  assert.equal(day('2026-10-06').quarter_of_day, q, 'Tuesday: still the previous quarter');
  assert.equal(day('2026-10-06').is_distant_review_day, true);
  assert.equal(day('2026-10-07').quarter_of_day, q + 1, 'Wednesday: the next quarter');
  assert.ok(!getActiveCycleDates(start, '2026-10-07', [], settings).includes('2026-10-06'));
  // Week statistics do not expect a recitation on the distant-review day either.
  assert.ok(!getCurrentWeekRange('2026-10-07', start, [], settings.distant_review_dates).activeRecitationDaysThisWeek.includes('2026-10-06'));
});

test('05:00 Cairo: pause dates follow the program date', () => {
  const settings = settingsOf({ is_paused: true, paused_at: '2026-10-28', pause_periods: [{ from: '2026-10-28', until: null }] });
  assert.equal(isPausedDate(settings, programDate(BEFORE)), false);
  assert.equal(isPausedDate(settings, programDate(AT)), true);
  const at = memberAt(AT, { settings, recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) });
  assert.equal(at.cycleInfo.quarter_of_day, 8, 'the paused day adds no quarter');
  assert.deepEqual(kinds(at), [], 'no false overdue on a paused day');
});

test('global pause: a distant-review date inside a pause creates no obligation and is not counted twice', () => {
  const a = assignment('2026-10-24', 1, 5);
  const settings = settingsOf({ pause_periods: [{ from: '2026-10-23', until: '2026-10-26' }], distant_review_dates: [a.review_date] });
  const r = memberAt(cairo('2026-10-28', '12:00:00', 3), { settings, distant: [a], recitations: tasmia('m', [1, 2, 3, 4, 5, 6]), revisions: reviews('m', ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-26', '2026-10-27', '2026-10-28']) });
  // 20,21,22,26,27,28 are the active days: program days 1..6
  assert.equal(r.cycleInfo.quarter_of_day, 6);
  assert.equal(r.cycleInfo.distant_review_days_count, 0);
  assert.equal(r.distant.overdueCount, 0);
  assert.deepEqual(kinds(r), []);
});

// ---------------------------------------------------------------------------------------------
// Member notification levels (per category, never merged)
// ---------------------------------------------------------------------------------------------

const NOON = cairo('2026-10-28', '12:00:00', 3); // program day 9 (quarters 1..9, 20..28 October)
const allQuarters = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const allDates = datesUpTo('2026-10-28');
const without = <T,>(list: T[], ...drop: T[]) => list.filter((x) => !drop.includes(x));

test("member: 0 overdue → no warning; 1 → light (yellow); 2 → stronger (orange); 3 → serious (red) — Tasmi'a", () => {
  assert.deepEqual(kinds(memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', allDates) })), []);
  const one = memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 5)), revisions: reviews('m', allDates) });
  assert.deepEqual(kinds(one), ['tasmia-overdue:light:1']);
  assert.equal(one.notifications[0].title, 'لديكِ يوم تسميع متأخر');
  assert.match(one.notifications[0].body, /فبادري/);
  assert.deepEqual(one.notifications[0].target, { kind: 'tasmia', quarter: 5 });
  const two = memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 5, 6)), revisions: reviews('m', allDates) });
  assert.deepEqual(kinds(two), ['tasmia-overdue:strong:2']);
  assert.equal(two.notifications[0].title, 'لديكِ يومان متأخران في التسميع');
  const three = memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 5, 6, 7)), revisions: reviews('m', allDates) });
  assert.deepEqual(kinds(three), ['tasmia-overdue:serious:3']);
  assert.equal(three.notifications[0].title, 'تنبيه شديد: لديكِ 3 أيام متأخرة في التسميع');
  assert.match(three.notifications[0].body, /أنتِ تقتربين من حد الاستبعاد/);
  assert.match(three.notifications[0].body, /معرضة للاستبعاد/);
  // Today's own quarter (9) is not overdue during the day.
  assert.deepEqual(kinds(memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 9)), revisions: reviews('m', allDates) })), []);
});

test('member: the same three levels for the normal review, with the oldest missed day as target', () => {
  const at = (missing: string[]) => memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, ...missing)) });
  assert.deepEqual(kinds(at([])), []);
  const one = at(['2026-10-24']);
  assert.deepEqual(kinds(one), ['revision-overdue:light:1']);
  assert.equal(one.notifications[0].title, 'لديكِ يوم مراجعة متأخر');
  assert.deepEqual(one.notifications[0].target, { kind: 'revision', date: '2026-10-24' });
  assert.deepEqual(kinds(at(['2026-10-24', '2026-10-21'])), ['revision-overdue:strong:2']);
  const three = at(['2026-10-24', '2026-10-21', '2026-10-26']);
  assert.deepEqual(kinds(three), ['revision-overdue:serious:3']);
  assert.equal(three.notifications[0].title, 'تنبيه شديد: لديكِ 3 أيام متأخرة في المراجعة');
  assert.deepEqual(three.notifications[0].target, { kind: 'revision', date: '2026-10-21' });
});

test("member: Tasmi'a and review are separate (1 + 2 → two notifications, never \"3\")", () => {
  const r = memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 3)), revisions: reviews('m', without(allDates, '2026-10-22', '2026-10-25')) });
  assert.deepEqual(kinds(r), ['revision-overdue:strong:2', 'tasmia-overdue:light:1']);
  assert.ok(r.notifications.every((n) => n.tone !== 'serious'));
});

test('member: catching up lowers the level, completing everything removes the warning', () => {
  const missing = ['2026-10-21', '2026-10-24', '2026-10-26'];
  const levels = [3, 2, 1, 0].map((n) => {
    const r = memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, ...missing.slice(0, n))) });
    return kinds(r).join(',');
  });
  assert.deepEqual(levels, ['revision-overdue:serious:3', 'revision-overdue:strong:2', 'revision-overdue:light:1', '']);
  // Same condition → same key on every refresh; a new level → a new key (a new, unread notification).
  const a = memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, ...missing)) });
  const again = memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, ...missing)) });
  const b = memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, ...missing.slice(0, 2))) });
  assert.equal(a.notifications[0].key, again.notifications[0].key);
  assert.equal(a.notifications[0].id, b.notifications[0].id);
  assert.notEqual(a.notifications[0].key, b.notifications[0].key);
});

test('member: join date — review days before joining her batch are never notified', () => {
  const r = memberAt(NOON, { joinedAt: '2026-10-26T08:00:00Z', recitations: tasmia('m', allQuarters), revisions: reviews('m', ['2026-10-26', '2026-10-27', '2026-10-28']) });
  assert.deepEqual(kinds(r), []);
  // A distant review dated before she joined is not owed either.
  const d = memberAt(NOON, { joinedAt: '2026-10-26T08:00:00Z', distant: [assignment('2026-10-24', 1, 5)], recitations: tasmia('m', allQuarters), revisions: reviews('m', ['2026-10-26', '2026-10-27', '2026-10-28']) });
  assert.equal(d.distant.overdueCount, 0);
});

test('member: rest, pause and distant-review dates create no false normal overdue', () => {
  const restDays = [rest('2026-10-22'), rest('2026-10-25')];
  const settings = settingsOf({ pause_periods: [{ from: '2026-10-23', until: '2026-10-24' }], distant_review_dates: ['2026-10-26'] });
  const r = memberAt(NOON, {
    settings,
    restDays,
    distant: [assignment('2026-10-26', 1, 5)],
    completions: [{ id: 'x', assignment_id: 'd-2026-10-26', member_id: 'm', completed_at: '', completed_on: '2026-10-26' }],
    // 20,21,24,27,28 are the active days: program days 1..5
    recitations: tasmia('m', [1, 2, 3, 4, 5]),
    revisions: reviews('m', ['2026-10-20', '2026-10-21', '2026-10-24', '2026-10-27', '2026-10-28']),
  });
  assert.equal(r.cycleInfo.quarter_of_day, 5);
  assert.deepEqual(kinds(r), []);
});

test('member: an inactive (excluded) member gets no overdue warnings; schedule information remains', () => {
  const r = memberAt(AT, { isActive: false, restDays: [rest('2026-10-28')], recitations: [], revisions: [] });
  assert.deepEqual(kinds(r), ['rest-day:info']);
});

test('member: several missed distant reviews are one separate notification with a count; each stays its own obligation', () => {
  const w: World = {
    distant: [assignment('2026-10-22', 1, 4), assignment('2026-10-24', 5, 9)],
    recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7]),
    revisions: reviews('m', allDates),
  };
  const r = memberAt(NOON, w);
  assert.deepEqual(kinds(r), ['distant-overdue:strong:2']);
  assert.equal(r.notifications[0].title, 'لديكِ مراجعتان بعيدتان متأخرتان');
  assert.deepEqual(r.notifications[0].target, { kind: 'distant', assignmentId: 'd-2026-10-22' });
  assert.deepEqual(r.distant.overdue.map((a) => a.id), ['d-2026-10-22', 'd-2026-10-24']);
  // Completing one settles exactly that one.
  const one = memberAt(NOON, { ...w, completions: [{ id: 'x', assignment_id: 'd-2026-10-24', member_id: 'm', completed_at: '', completed_on: '2026-10-28' }] });
  assert.deepEqual(one.distant.overdue.map((a) => a.id), ['d-2026-10-22']);
  // Another member's completion does not count for her.
  const other = memberAt(NOON, { ...w, completions: [{ id: 'y', assignment_id: 'd-2026-10-24', member_id: 'other', completed_at: '', completed_on: '2026-10-28' }] });
  assert.equal(other.distant.overdueCount, 2);
});

test('debt levels: thresholds', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 12].map(debtLevel), [null, 'light', 'strong', 'serious', 'serious', 'serious']);
  assert.equal(SERIOUS_DEBT_THRESHOLD, 3);
});

// ---------------------------------------------------------------------------------------------
// Batch / master admin alerts: only at 3 or more, per category, per batch
// ---------------------------------------------------------------------------------------------

const member = (id: string, name: string, phone: string) => ({ id, name, phone, joined_at: JOINED });

function batchAlertsAt(
  instant: Date,
  members: ReturnType<typeof member>[],
  recitations: RecitationLog[],
  revisions: RevisionLog[],
  batch = { id: 'A', name: 'الدفعة أ' }
) {
  const today = programDate(instant);
  const settings = settingsOf();
  const cycleInfo = calculateCycleInfo(settings, [], today);
  const activeDates = getActiveCycleDates(settings.start_date, today, [], settings);
  return buildBatchAdminAlerts(batch, members, computeMembersDelays(members, cycleInfo, activeDates, recitations, revisions, today));
}

test('batch admin: no alert at 1 or 2 missed days; one alert per category at 3+ with name and phone', () => {
  const members = [
    member('one', 'عضوة يوم', '01000000001'),
    member('two', 'عضوة يومين', '01000000002'),
    member('t3', 'عائشة أحمد', '01012345678'),
    member('r3', 'خديجة محمود', '01087654321'),
    member('both', 'مريم علي', '01011112222'),
  ];
  const recitations = [
    ...tasmia('one', without(allQuarters, 2)),
    ...tasmia('two', without(allQuarters, 2, 3)),
    ...tasmia('t3', without(allQuarters, 2, 3, 4)),
    ...tasmia('r3', allQuarters),
    ...tasmia('both', without(allQuarters, 1, 2, 3, 4)),
  ];
  const revisions = [
    ...reviews('one', allDates),
    ...reviews('two', without(allDates, '2026-10-21', '2026-10-22')),
    ...reviews('t3', allDates),
    ...reviews('r3', without(allDates, '2026-10-21', '2026-10-22', '2026-10-23')),
    ...reviews('both', without(allDates, '2026-10-21', '2026-10-22', '2026-10-23')),
  ];
  const alerts = batchAlertsAt(NOON, members, recitations, revisions);
  assert.deepEqual(
    alerts.map((a) => `${a.memberName}|${a.phone}|${a.category}|${a.count}|${a.eligibleForExclusion}`).sort(),
    [
      'خديجة محمود|01087654321|revision|3|true',
      'عائشة أحمد|01012345678|tasmia|3|true',
      'مريم علي|01011112222|revision|3|true',
      'مريم علي|01011112222|tasmia|4|true',
    ]
  );
  assert.ok(alerts.every((a) => a.batchId === 'A' && a.batchName === 'الدفعة أ' && a.urgent));
  // The same rule as the dashboards' «مؤهلة للإقصاء» (Sisters: 3+).
  const d = computeMemberDelayStatus({ memberId: 't3', quarterOfDay: 9, activeCycleDates: allDates, recitations, revisions, todayDate: '2026-10-28', joinedOnDate: '2026-10-19' });
  assert.equal(d.isSeverelyBehindRecitation, true);
});

test('batch admin: the alert appears at 05:00 Cairo and disappears when the member catches up below 3', () => {
  const members = [member('m3', 'عائشة أحمد', '01012345678')];
  const revisions = reviews('m3', allDates);
  // Quarters 6 and 7 missed; quarter 8 (27 Oct) still open at 04:59:59 on 28 Oct.
  const recs = tasmia('m3', [1, 2, 3, 4, 5]);
  assert.deepEqual(batchAlertsAt(BEFORE, members, recs, revisions), []);
  assert.deepEqual(batchAlertsAt(AT, members, recs, revisions).map((a) => `${a.category}:${a.count}`), ['tasmia:3']);
  assert.deepEqual(batchAlertsAt(AT, members, tasmia('m3', [1, 2, 3, 4, 5, 6]), revisions), [], 'below 3 again → no alert');
});

test("batch admin: alerts are computed per batch from that batch's own members", () => {
  const a = batchAlertsAt(NOON, [member('x', 'عضوة أ', '010')], tasmia('x', [1, 2, 3, 4, 5]), reviews('x', allDates), { id: 'A', name: 'أ' });
  const b = batchAlertsAt(NOON, [member('y', 'عضوة ب', '011')], tasmia('y', allQuarters), reviews('y', allDates), { id: 'B', name: 'ب' });
  assert.deepEqual(a.map((x) => x.memberId), ['x']);
  assert.deepEqual(b, []);
});

test('other batches (loaded rows): program-day review identity follows the calendar with distant-review days', () => {
  // Program days: 20,21 → 1,2; 22 distant; 23 → 3. A review of program day 3 credits the 23rd.
  const program = {
    cycle: { id: 'c', batch_id: 'A', cycle_number: 1, starts_on: START },
    settings: buildProgramSettings({ id: 'c', starts_on: START, cycle_number: 1 }, [], ['2026-10-22']),
    restDays: [] as RestDay[],
    members: [member('m', 'عضوة', '010')],
    tasmia: [1, 2, 3].map((q) => ({ user_id: 'm', quarter_number: q })),
    reviews: [1, 2, 3].map((d) => ({ user_id: 'm', program_day: d, confirmed_at: '2026-10-23T08:00:00Z' })),
  };
  const r = computeBatchDelays(program, '2026-10-24');
  assert.deepEqual(r.activeDates, ['2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24']);
  assert.equal(r.cycleInfo.quarter_of_day, 4);
  assert.deepEqual(r.delayById.get('m')!.missedRevisionDates, []);
  assert.equal(r.delayById.get('m')!.missedQuartersCount, 0);
});

// ---------------------------------------------------------------------------------------------
// Urgency, stable keys and the unread rule
// ---------------------------------------------------------------------------------------------

test('urgent = the 3+ elimination-risk debt only; everything else is non-urgent', () => {
  const r = memberAt(NOON, {
    recitations: tasmia('m', without(allQuarters, 3, 4, 5)),
    revisions: reviews('m', without(allDates, '2026-10-22')),
    restDays: [rest('2026-10-29', 'غدًا')],
    distant: [assignment('2026-10-24', 1, 4)],
  });
  const byKind = Object.fromEntries(r.notifications.map((n) => [n.kind, n.urgent]));
  assert.deepEqual(byKind, { 'tasmia-overdue': true, 'revision-overdue': false, 'distant-overdue': false, 'rest-tomorrow': false });
  const tomorrow = r.notifications.find((n) => n.kind === 'rest-tomorrow')!;
  assert.equal(tomorrow.title, 'غدًا يوم راحة من التقدم المعتاد للبرنامج');
  assert.equal(tomorrow.note, 'غدًا');
  const alerts = batchAlertsAt(NOON, [member('x', 'عضوة', '010')], tasmia('x', [1, 2, 3, 4, 5]), reviews('x', allDates));
  assert.ok(alerts.length === 1 && alerts[0].urgent === true);
});

test('keys: one key per condition (no duplicates across refreshes), a new key for a new situation', () => {
  const at = (missing: number[]) =>
    memberAt(NOON, { recitations: tasmia('m', without(allQuarters, ...missing)), revisions: reviews('m', allDates) }).notifications[0]?.key;
  assert.equal(at([4, 5, 6]), at([4, 5, 6]));
  assert.equal(at([4, 5, 6]), 'b:b:tasmia:serious:q4');
  assert.equal(at([4, 5, 6, 7]), at([4, 5, 6]), 'still serious, same episode: same key (3 → 4 days)');
  assert.notEqual(at([5, 6]), at([4, 5, 6]), 'caught up below 3: a different notification');
  const k = (recs: number[]) => batchAlertsAt(NOON, [member('x', 'عضوة', '010')], tasmia('x', recs), reviews('x', allDates))[0]?.key;
  assert.equal(k([1, 2, 3, 4, 5]), 'alert:A:x:tasmia:6');
  assert.equal(k([1, 2, 3, 4]), 'alert:A:x:tasmia:5');
  const r = memberAt(AT, { restDays: [rest('2026-10-28')], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) });
  assert.equal(r.notifications[0].key, 'b:b:rest:2026-10-28');
  const t = memberAt(BEFORE, { restDays: [rest('2026-10-28')], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) });
  assert.equal(t.notifications[0].key, 'b:b:rest-tomorrow:2026-10-28');
});

test('unread rule: opening the panel (seen) reads non-urgent ones only; clicking (archived) reads everything', () => {
  const urgent = { key: 'u', urgent: true };
  const normal = { key: 'n', urgent: false };
  assert.equal(isUnread(urgent, undefined), true);
  assert.equal(isUnread(normal, undefined), true);
  const seen = { seenAt: '2026-10-28T03:00:00Z', archivedAt: null };
  assert.equal(isUnread(urgent, seen), true, 'urgent stays unread when the panel is merely opened');
  assert.equal(isUnread(normal, seen), false);
  const archived = { seenAt: '2026-10-28T03:00:00Z', archivedAt: '2026-10-28T03:01:00Z' };
  assert.equal(isUnread(urgent, archived), false);
  assert.equal(isUnread(normal, archived), false);
  // Badge example: urgent 3-day warning + a rest-day notice → 2; after opening the panel → 1.
  const items = [urgent, normal];
  assert.equal(items.filter((i) => isUnread(i, undefined)).length, 2);
  assert.equal(items.filter((i) => isUnread(i, seen)).length, 1);
});

test('05:00 Cairo: "tomorrow" is the next program date (at 00:30 Cairo the 28th is still tomorrow)', () => {
  const w: World = { restDays: [rest('2026-10-28')], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7]), revisions: reviews('m', datesUpTo('2026-10-26')) };
  assert.deepEqual(kinds(memberAt(cairo('2026-10-28', '00:30:00', 3), w)), ['rest-tomorrow:info']);
  assert.deepEqual(kinds(memberAt(cairo('2026-10-27', '04:59:59', 3), w)), [], 'on program date 26 the 28th is not tomorrow');
  const paused = memberAt(cairo('2026-10-27', '12:00:00', 3), { ...w, settings: settingsOf({ is_paused: true, paused_at: '2026-10-27', pause_periods: [{ from: '2026-10-27', until: null }] }) });
  assert.ok(!paused.notifications.some((n) => n.kind === 'rest-tomorrow'), 'no tomorrow notice while the program is paused');
});

test('feminine wording: no masculine member-facing strings in the notifications', () => {
  const all = [
    ...memberAt(NOON, { recitations: tasmia('m', without(allQuarters, 3, 4, 5)), revisions: reviews('m', without(allDates, '2026-10-22')), restDays: [rest('2026-10-29')], distant: [assignment('2026-10-24', 1, 4)] }).notifications,
    ...memberAt(NOON, { recitations: tasmia('m', allQuarters), revisions: reviews('m', without(allDates, '2026-10-21', '2026-10-24', '2026-10-26')) }).notifications,
    ...memberAt(AT, { restDays: [rest('2026-10-28')], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) }).notifications,
    ...memberAt(AT, { distant: [assignment('2026-10-28', 1, 9)], completions: [{ id: 'x', assignment_id: 'd-2026-10-28', member_id: 'm', completed_at: '', completed_on: '2026-10-28' }], recitations: tasmia('m', [1, 2, 3, 4, 5, 6, 7, 8]), revisions: reviews('m', datesUpTo('2026-10-27')) }).notifications,
  ];
  const text = all.map((x) => `${x.title} ${x.body}`).join(' ');
  for (const masculine of [/لديك /, /\bأنت /, /فبادر /, /بادر /, /تصبح /, /معرض /, /عليك /, /يمكنك /, /فاتك[^ِ]/, /فيك[.\s]/, /أتممتها/])
    assert.doesNotMatch(text, masculine, String(masculine));
  for (const feminine of [/لديكِ/, /أنتِ تقتربين/, /معرضة/, /بادري/, /عليكِ/, /أتممتِها/, /فيكِ/]) assert.match(text, feminine, String(feminine));
});

// ---------------------------------------------------------------------------------------------
// Quran quarters for «المراجعة البعيدة»
// ---------------------------------------------------------------------------------------------

test('quarter metadata: juz, hizb, Mushaf page (from mushafLines.json) and ayah for all 240 quarters', () => {
  assert.equal(ALL_QUARTERS.length, 240);
  assert.deepEqual(ALL_QUARTERS.map((q) => q.number), Array.from({ length: 240 }, (_, i) => i + 1));
  const pageOf = new Map((mushafLines as { surah: number; ayah: number; page: number }[]).map((a) => [`${a.surah}:${a.ayah}`, a.page]));
  for (const q of ALL_QUARTERS) {
    assert.ok(q.juz >= 1 && q.juz <= 30 && q.hizb >= 1 && q.hizb <= 60, `quarter ${q.number}`);
    assert.equal(q.page, pageOf.get(`${q.surahNumber}:${q.ayahStart}`), `page of quarter ${q.number}`);
  }
  assert.deepEqual([ALL_QUARTERS[8].juz, ALL_QUARTERS[8].hizb, ALL_QUARTERS[8].page, ALL_QUARTERS[8].ayahStart], [2, 3, 22, 142]);
  for (let i = 1; i < 240; i++) assert.ok(ALL_QUARTERS[i].page >= ALL_QUARTERS[i - 1].page);
});

test('TO quarter is the stopping boundary: from 1 to 9 stops at the BEGINNING of quarter 9 (8 quarters)', () => {
  const b = getDistantReviewBounds(1, 9);
  assert.equal(b.start.ayahNumber, getQuarterInfo(1).ayahStart);
  assert.equal(b.start.surahName, getQuarterInfo(1).surahName);
  assert.equal(b.stop.ayahNumber, getQuarterInfo(9).ayahStart, 'stop at the beginning of quarter 9');
  assert.notEqual(b.stop.ayahNumber, getQuarterInfo(10).ayahStart, 'not at quarter 10');
  assert.equal(distantReviewQuarterCount(1, 9), 8);
  assert.equal(distantReviewQuarterCount(1, 240), 239);
});
