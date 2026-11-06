// Peer-test candidate rules (pure; no network): overdue self-revision never blocks a candidate; only
// overdue Tasmi'a does. Delay statuses come from the same shared code the Edge Function uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateCandidate, isPeerTestLive, nextTasmiaQuarter, tasmiaDelayReason } from '../supabase/functions/_shared/peer-tests/eligibility.ts';
import { computeMemberDelayStatus } from '../supabase/functions/_shared/logic/memberDelayStatus.ts';

const TODAY = '2026-10-30';
const DATES = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const TEST = { range_start: 1, range_end: 5 };

/** A member on program day 30 with these overdue counts (quarters 1..5 of the range always recited). */
function member(overdueTasmia: number, overdueRevision: number) {
  const missedQuarters = new Set(Array.from({ length: overdueTasmia }, (_, i) => 6 + i));
  const quarters = Array.from({ length: 30 }, (_, i) => i + 1).filter((q) => !missedQuarters.has(q));
  const recitations = quarters.map((q) => ({ member_id: 'm', quarter_number: q }));
  const missedDates = new Set(DATES.slice(0, overdueRevision));
  const revisions = DATES.filter((d) => !missedDates.has(d)).map((date) => ({ member_id: 'm', date }));
  const delay = computeMemberDelayStatus({ memberId: 'm', quarterOfDay: 30, activeCycleDates: DATES, recitations, revisions, todayDate: TODAY });
  return { delay, completedQuarters: new Set(quarters) };
}
const evaluate = (t: number, r: number, hasPassed = false) => evaluateCandidate({ test: TEST, hasPassed, ...member(t, r) });

test('1. no overdue Tasmi\'a, no overdue revision → eligible', () => {
  assert.deepEqual(evaluate(0, 0).reasons, []);
  assert.equal(evaluate(0, 0).is_eligible, true);
});

for (const days of [1, 3, 5, 20]) {
  test(`2-4. no overdue Tasmi'a + ${days} overdue revision day(s) → still eligible`, () => {
    const e = evaluate(0, days);
    assert.equal(member(0, days).delay.missedRevisionDaysCount, days);
    assert.equal(e.is_eligible, true);
    assert.deepEqual(e.reasons, []);
  });
}

test('5. Tasmi\'a overdue enough to violate the rule (3+) → blocked; below it → not blocked', () => {
  const e = evaluate(3, 0);
  assert.equal(e.is_eligible, false);
  assert.deepEqual(e.reasons, ['مؤهلة للإقصاء بسبب تأخر التسميع (3 أرباع فائتة)']);
  assert.equal(evaluate(2, 0).is_eligible, true);
});

test('6. both overdue → blocked because of Tasmi\'a, and the reason does not mention revision', () => {
  const e = evaluate(4, 6);
  assert.equal(e.is_eligible, false);
  assert.equal(e.reasons.length, 1);
  assert.match(e.reasons[0], /تأخر التسميع \(4 أرباع فائتة\)/);
  assert.doesNotMatch(e.reasons.join(), /المراجعة/);
  assert.equal(tasmiaDelayReason(member(0, 9).delay), null);
});

test('is_eliminable still reports the general status (it is information, not a block)', () => {
  const e = evaluate(0, 5);
  assert.equal(e.is_eliminable, true);
  assert.equal(e.is_eligible, true);
});

test('7. examiner rule is unchanged: it does not read any delay status', () => {
  const src = fs.readFileSync('supabase/functions/peer-tests/index.ts', 'utf8').replace(/\r\n/g, '\n');
  const fn = src.slice(src.indexOf('function requireExaminer'), src.indexOf('function requireManager'));
  assert.ok(fn.length > 0);
  assert.doesNotMatch(fn, /delay|evaluateCandidate/i);
  assert.match(fn, /caller\.role !== 'member' \|\| caller\.memberBatchId !== cycle\.batch_id/);
  assert.match(fn, /isPeerTestLive\(test\)/);
});

test('8. range completion is unchanged: a missing range quarter blocks, whatever the delays', () => {
  const m = member(0, 0);
  m.completedQuarters.delete(3);
  const e = evaluateCandidate({ test: TEST, hasPassed: false, ...m });
  assert.equal(e.is_eligible, false);
  assert.equal(e.missing_quarters, 1);
  assert.match(e.reasons[0], /لم تُتمّ تسميع جميع أرباع النطاق/);
});

test('9. already passed is unchanged: blocks a new attempt', () => {
  const e = evaluate(0, 5, true);
  assert.equal(e.is_eligible, false);
  assert.equal(e.has_passed, true);
  assert.deepEqual(e.reasons, ['سبق لها اجتياز هذا الاختبار']);
});

test('all three checkpoints (candidates, start, submit) go through evaluateCandidate', () => {
  const src = fs.readFileSync('supabase/functions/peer-tests/index.ts', 'utf8');
  assert.equal(src.match(/evaluateCandidate\(\{/g)?.length, 3);
});

test('mandatory-test Tasmi\'a blocking and the live window are unchanged', () => {
  assert.equal(nextTasmiaQuarter(member(0, 0).delay, 30), 31);
  assert.equal(nextTasmiaQuarter(member(3, 5).delay, 30), 6);
  assert.equal(isPeerTestLive({ status: 'published', visible_from: null, visible_until: null }), true);
  assert.equal(isPeerTestLive({ status: 'hidden', visible_from: null, visible_until: null }), false);
});

test('the conditions shown to members no longer list revision delay as a block', () => {
  const src = fs.readFileSync('src/components/TestConditionsCard.tsx', 'utf8');
  assert.doesNotMatch(src, /تأخر التسميع أو المراجعة/);
  assert.match(src, /ولا يمنع تأخر المراجعة الذاتية من دخول الاختبار/);
});
