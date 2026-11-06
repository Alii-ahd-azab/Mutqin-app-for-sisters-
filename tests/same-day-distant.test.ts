// Turning TODAY into a «المراجعة البعيدة» day, on the shared calendar (pure; no network). The database
// move itself is covered by tests/db.test.ts; `convert` below applies the same rule to in-memory rows:
// the rows of the cancelled program day leave the live tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCycleInfo,
  calculateMemberDistantReviewStatus,
  calculateMemberRequiredQuarter,
  calculateMemberRevisionStatus,
  getActiveCycleDates,
  joinedOnDateFromTimestamp,
  programDayOfDate,
} from '../supabase/functions/_shared/logic/calculations.ts';
import { computeMemberDelayStatus, SEVERE_DELAY_THRESHOLD } from '../supabase/functions/_shared/logic/memberDelayStatus.ts';
import { buildProgramSettings, revisionDateForProgramDay } from '../supabase/functions/_shared/logic/programState.ts';
import { addDays } from '../supabase/functions/_shared/logic/programDate.ts';
import type { RestDay, RevisionLog } from '../supabase/functions/_shared/logic/programTypes.ts';

const START = '2026-10-19';
const TODAY = '2026-11-06'; // program day 19 when nothing is off
const TOMORROW = addDays(TODAY, 1);
const YESTERDAY = addDays(TODAY, -1);
const cycle = { id: 'c', starts_on: START, cycle_number: 1 };

const restOf = (dates: string[]): RestDay[] => dates.map((date) => ({ id: date, date, note: '', added_by_admin_id: '', created_at: '' }));
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

interface World {
  distant?: string[];
  rest?: string[];
  pauses?: { paused_on: string; resumed_on: string | null }[];
}
const calendar = (w: World = {}) => ({ settings: buildProgramSettings(cycle, w.pauses ?? [], w.distant ?? []), restDays: restOf(w.rest ?? []) });

/** A member's status on a date, exactly as the dashboards and the Edge Functions read it. */
function statusOn(date: string, member: { tasmia: number[]; reviewDays: number[]; joinedOn?: string }, w: World = {}) {
  const { settings, restDays } = calendar(w);
  const info = calculateCycleInfo(settings, restDays, date);
  const active = getActiveCycleDates(START, date, restDays, settings);
  const revisions = member.reviewDays.map((d) => ({ member_id: 'm', date: revisionDateForProgramDay(active, d, `${date}T08:00:00Z`) })) as RevisionLog[];
  const recitations = member.tasmia.map((q) => ({ member_id: 'm', quarter_number: q }));
  return {
    info,
    active,
    quarter: calculateMemberRequiredQuarter('m', info.quarter_of_day, recitations),
    revision: calculateMemberRevisionStatus('m', active, revisions, date, member.joinedOn),
    delay: computeMemberDelayStatus({ memberId: 'm', quarterOfDay: info.quarter_of_day, activeCycleDates: active, recitations, revisions, todayDate: date, joinedOnDate: member.joinedOn }),
  };
}

/** What the conversion does to one member's rows (the database moves them to voided_daily_records). */
const convert = (m: { tasmia: number[]; reviewDays: number[] }, cancelledDay: number) => ({
  tasmia: m.tasmia.filter((q) => q !== cancelledDay),
  reviewDays: m.reviewDays.filter((d) => d !== cancelledDay),
});

const CONVERTED: World = { distant: [TODAY] };
const sisterA = { tasmia: range(19), reviewDays: range(19) }; // submitted today's normal work
const sisterB = { tasmia: range(18), reviewDays: range(18) }; // did nothing today

test('A. a future distant-review day is unchanged: today and the days before it keep their numbers', () => {
  const w: World = { distant: [addDays(TODAY, 3)] };
  const { settings, restDays } = calendar(w);
  assert.equal(calculateCycleInfo(settings, restDays, TODAY).cycle_day, 19);
  assert.equal(calculateCycleInfo(settings, restDays, addDays(TODAY, 2)).cycle_day, 21);
  assert.equal(calculateCycleInfo(settings, restDays, addDays(TODAY, 3)).cycle_day, 21);
  assert.equal(calculateCycleInfo(settings, restDays, addDays(TODAY, 4)).cycle_day, 22);
});

test('programDayOfDate: the cancelled day is today\'s program day; null when today is not active', () => {
  const { settings, restDays } = calendar();
  assert.equal(programDayOfDate(START, TODAY, restDays, settings), 19);
  const rest = calendar({ rest: [TODAY] });
  assert.equal(programDayOfDate(START, TODAY, rest.restDays, rest.settings), null);
  const paused = calendar({ pauses: [{ paused_on: TODAY, resumed_on: null }] });
  assert.equal(programDayOfDate(START, TODAY, paused.restDays, paused.settings), null);
  const distant = calendar(CONVERTED);
  assert.equal(programDayOfDate(START, TODAY, distant.restDays, distant.settings), null);
});

test('C/D. today goes back to day N (18), tomorrow becomes exactly N+1 (19), and the day after N+2', () => {
  assert.equal(statusOn(TODAY, sisterB).info.cycle_day, 19, 'before the conversion');
  const today = statusOn(TODAY, sisterB, CONVERTED);
  assert.equal(today.info.cycle_day, 18);
  assert.equal(today.info.quarter_of_day, 18);
  assert.equal(today.info.is_distant_review_day, true);
  assert.equal(today.revision.isTodayProgramDay, false);
  assert.equal(statusOn(TOMORROW, sisterB, CONVERTED).info.cycle_day, 19);
  assert.equal(statusOn(addDays(TOMORROW, 1), sisterB, CONVERTED).info.cycle_day, 20);
});

test('same-day conversion equals a date configured beforehand: same calendar every day', () => {
  // The calendar only knows the date; when the row was created makes no difference.
  for (let d = YESTERDAY; d <= addDays(TODAY, 5); d = addDays(d, 1)) {
    const { settings, restDays } = calendar(CONVERTED);
    assert.equal(calculateCycleInfo(settings, restDays, d).cycle_day, getActiveCycleDates(START, d, restDays, settings).length, d);
  }
});

test('E. Sister A\'s Tasmi\'a of the cancelled day stops counting: quarter 19 is owed on the next active day', () => {
  const a = convert(sisterA, 19);
  const today = statusOn(TODAY, a, CONVERTED);
  assert.equal(today.quarter.allCompletedUpToToday, true, 'not ahead and not behind today');
  assert.equal(today.quarter.pastMissedQuartersCount, 0);
  const tomorrow = statusOn(TOMORROW, a, CONVERTED);
  assert.equal(tomorrow.quarter.requiredQuarter, 19);
  assert.equal(tomorrow.quarter.hasCompletedToday, false);
  assert.equal(tomorrow.quarter.pastMissedQuartersCount, 0, 'owed as today\'s quarter, not as a debt');
});

test('without the move Sister A would look finished tomorrow (why the rows must leave)', () => {
  const tomorrow = statusOn(TOMORROW, sisterA, CONVERTED);
  assert.equal(tomorrow.quarter.hasCompletedToday, true);
  assert.equal(tomorrow.revision.hasReviewedToday, true);
});

test('F. Sister A\'s review of the cancelled day does not satisfy the next active day', () => {
  const a = convert(sisterA, 19);
  assert.equal(statusOn(TODAY, a, CONVERTED).revision.hasReviewedToday, false);
  const tomorrow = statusOn(TOMORROW, a, CONVERTED);
  assert.equal(tomorrow.revision.isTodayProgramDay, true);
  assert.equal(tomorrow.revision.hasReviewedToday, false);
  assert.equal(tomorrow.revision.pastMissedRevisionDaysCount, 0);
});

test('G. Sister B (did nothing) has no normal obligation today and no debt from it', () => {
  const today = statusOn(TODAY, sisterB, CONVERTED);
  assert.equal(today.quarter.allCompletedUpToToday, true);
  assert.deepEqual(today.revision.missedDates, []);
  const tomorrow = statusOn(TOMORROW, sisterB, CONVERTED);
  assert.equal(tomorrow.quarter.requiredQuarter, 19);
  assert.deepEqual(tomorrow.revision.pastMissedDates, []);
});

test('A and B are in the same state after the conversion', () => {
  for (const d of [TODAY, TOMORROW]) {
    assert.deepEqual(statusOn(d, convert(sisterA, 19), CONVERTED).delay, statusOn(d, sisterB, CONVERTED).delay, d);
  }
});

test('H/I. no fake missed day and no severe-delay increase, even if tomorrow passes unfinished', () => {
  const before = statusOn(TODAY, { tasmia: range(16), reviewDays: range(16) });
  assert.equal(before.delay.missedQuartersCount, 2, 'quarters 17, 18 before the conversion');
  const after = statusOn(TODAY, { tasmia: range(16), reviewDays: range(16) }, CONVERTED);
  assert.ok(after.delay.missedQuartersCount <= before.delay.missedQuartersCount);
  assert.ok(after.delay.missedRevisionDaysCount <= before.delay.missedRevisionDaysCount);
  assert.equal(after.delay.isSeverelyBehind, false);
  assert.ok(!after.active.includes(TODAY));
  // Two days later she owes exactly the days that exist: today is never one of them.
  const later = statusOn(addDays(TODAY, 2), convert(sisterA, 19), CONVERTED);
  assert.ok(!later.delay.missedRevisionDates.includes(TODAY));
  assert.ok(later.delay.missedQuartersCount < SEVERE_DELAY_THRESHOLD);
});

test('catch-up work of earlier days keeps counting', () => {
  // Quarter 15 recited today as catch-up has a different number from the cancelled day.
  const m = convert({ tasmia: [...range(14), 15], reviewDays: range(18) }, 19);
  assert.ok(m.tasmia.includes(15));
  assert.equal(statusOn(TODAY, m, CONVERTED).quarter.requiredQuarter, 16);
});

test('J. the distant review itself is owed today, also by a member who submitted normal work', () => {
  const { settings, restDays } = calendar(CONVERTED);
  const a = { id: 'd', batch_id: 'b', cycle_id: 'c', review_date: TODAY, start_quarter: 1, end_quarter: 9, created_at: '', updated_at: '' };
  const s = calculateMemberDistantReviewStatus('m', [a], [], settings, restDays, TODAY);
  assert.equal(s.todayAssignment?.id, 'd');
  assert.equal(s.hasCompletedToday, false);
  assert.deepEqual(calculateMemberDistantReviewStatus('m', [a], [], settings, restDays, TOMORROW).overdue.map((x) => x.id), ['d']);
});

test('K. converting a rest or paused day cancels no program day and keeps the calendar', () => {
  for (const w of [{ rest: [TODAY] }, { pauses: [{ paused_on: TODAY, resumed_on: TOMORROW }] }] as World[]) {
    const plain = calendar(w);
    const both = calendar({ ...w, distant: [TODAY] });
    assert.equal(programDayOfDate(START, TODAY, plain.restDays, plain.settings), null);
    for (const d of [TODAY, TOMORROW]) {
      assert.equal(calculateCycleInfo(both.settings, both.restDays, d).cycle_day, calculateCycleInfo(plain.settings, plain.restDays, d).cycle_day, d);
    }
    assert.equal(calculateCycleInfo(both.settings, both.restDays, TODAY).is_distant_review_day, true);
  }
});

test('K. earlier rest days and pauses shift the cancelled day correctly', () => {
  const w: World = { rest: ['2026-10-25'], pauses: [{ paused_on: '2026-10-28', resumed_on: '2026-10-30' }] };
  const { settings, restDays } = calendar(w);
  assert.equal(programDayOfDate(START, TODAY, restDays, settings), 16);
  const conv = calendar({ ...w, distant: [TODAY] });
  assert.equal(calculateCycleInfo(conv.settings, conv.restDays, TODAY).cycle_day, 15);
  assert.equal(calculateCycleInfo(conv.settings, conv.restDays, TOMORROW).cycle_day, 16);
});

test('L. a member who joined today: nothing owed before joining, tomorrow\'s review is owed', () => {
  const joinedOn = joinedOnDateFromTimestamp(`${TODAY}T09:00:00Z`);
  assert.equal(joinedOn, TODAY);
  const m = { tasmia: range(18), reviewDays: [], joinedOn };
  assert.deepEqual(statusOn(TODAY, m, CONVERTED).revision.missedDates, []);
  assert.deepEqual(statusOn(TOMORROW, m, CONVERTED).revision.pastMissedDates, []);
  assert.deepEqual(statusOn(TOMORROW, m, CONVERTED).revision.missedDates, [TOMORROW]);
  // A distant review of today is owed by her (she had joined by then).
  const { settings, restDays } = calendar(CONVERTED);
  const a = { id: 'd', batch_id: 'b', cycle_id: 'c', review_date: TODAY, start_quarter: 1, end_quarter: 9, created_at: '', updated_at: '' };
  assert.equal(calculateMemberDistantReviewStatus('m', [a], [], settings, restDays, TODAY, joinedOn).todayAssignment?.id, 'd');
});

test('the cycle\'s first day converted: program day 1 is owed on the next active day', () => {
  const start = TODAY;
  const settings = buildProgramSettings({ ...cycle, starts_on: start }, [], [TODAY]);
  assert.deepEqual(getActiveCycleDates(start, TODAY, [], settings), []);
  assert.equal(calculateCycleInfo(settings, [], addDays(TODAY, 1)).cycle_day, 1);
  assert.deepEqual(getActiveCycleDates(start, addDays(TODAY, 1), [], settings), [addDays(TODAY, 1)]);
});

test('one source of truth: the program day always equals the number of active dates, on mixed calendars', () => {
  const dates = Array.from({ length: 40 }, (_, i) => addDays(START, i));
  // A deterministic spread of rest, distant and pause dates, overlapping on purpose.
  for (let seed = 1; seed <= 25; seed++) {
    const pick = (k: number) => dates.filter((_, i) => (i * seed + k) % 7 === 0);
    const rest = pick(1);
    const distant = pick(2);
    const pausedOn = dates[seed % 30];
    const w: World = { rest, distant, pauses: [{ paused_on: pausedOn, resumed_on: addDays(pausedOn, 1 + (seed % 3)) }] };
    const { settings, restDays } = calendar(w);
    for (const d of dates) {
      const active = getActiveCycleDates(START, d, restDays, settings);
      assert.equal(calculateCycleInfo(settings, restDays, d).cycle_day, Math.max(1, active.length), `seed ${seed} ${d}`);
    }
  }
});
