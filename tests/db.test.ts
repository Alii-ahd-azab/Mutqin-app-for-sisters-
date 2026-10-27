// Database tests of the three ported features on the Sisters production SCHEMA (local PGlite; never
// production): 05:00 Africa/Cairo program date (JS ↔ SQL parity), «المراجعة البعيدة» (guards, RPCs,
// RLS, completion identity), notification state and master-admin follows (RLS / RPC scope), and the
// migrations changing no existing row. Synthetic data only.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { addDays, membershipDate, programDate, programDayStart } from '../supabase/functions/_shared/logic/programDate.ts';
import { isPausedDate } from '../supabase/functions/_shared/logic/calculations.ts';
import { buildProgramSettings } from '../supabase/functions/_shared/logic/programState.ts';
import { applyNewMigrations, asRole, createSchemaDb, migrationSql, NEW_MIGRATIONS, SCHEMA_DUMP } from './harness.ts';

const skip = !fs.existsSync(SCHEMA_DUMP) && `schema dump not found (${SCHEMA_DUMP}); set SISTERS_SCHEMA_DUMP`;

let db: PGlite;
let TODAY: string;
const id: Record<string, string> = {};
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const one = async (q: any, sql: string, p: unknown[] = []) => (await q.query(sql, p)).rows[0] as any;
const n = async (q: any, sql: string, p: unknown[] = []) => (await q.query(`select count(*)::int as n from (${sql}) q`, p)).rows[0].n as number;
// A failed statement aborts the transaction; each expected failure runs in a savepoint.
async function fails(tx: any, sql: string, p: unknown[] = [], check?: RegExp | string) {
  await tx.query('savepoint expect_failure');
  let err: any = null;
  try {
    await tx.query(sql, p);
  } catch (e) {
    err = e;
  }
  await tx.query('rollback to savepoint expect_failure');
  assert.ok(err, `expected failure: ${sql}`);
  if (typeof check === 'string') assert.equal(err.code, check, err.message);
  else if (check) assert.match(err.message, check);
}
const as = <T,>(uid: string | null, fn: (tx: any) => Promise<T>) => asRole(db, uid ? 'authenticated' : 'anon', uid, fn);
const asService = <T,>(fn: (tx: any) => Promise<T>) => asRole(db, 'service_role', null, fn);
/** Run fn inside a transaction that is always rolled back (as the table owner). */
async function scratch(fn: () => Promise<void>) {
  await db.query('begin');
  try {
    await fn();
  } finally {
    await db.query('rollback');
  }
}
/** Switch the current transaction to an authenticated user (or back to the owner with null). */
async function become(uid: string | null) {
  await db.query('reset role');
  if (!uid) return;
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]);
  await db.query('set local role authenticated');
}

/** Two batches with active cycles, a master admin, batch admins, members, Tasmi'a, reviews, a rest day, a past pause. */
async function seed(q: PGlite, today: string) {
  const people: [string, string, 'member' | 'admin', boolean, boolean][] = [
    ['master', 'المشرفة العامة', 'admin', true, true],
    ['master2', 'مشرفة عامة ثانية', 'admin', true, true],
    ['adminA', 'مشرفة الدفعة أ', 'admin', false, true],
    ['adminB', 'مشرفة الدفعة ب', 'admin', false, true],
    ['m1', 'عائشة محمد', 'member', false, true],
    ['m2', 'مريم أحمد', 'member', false, true],
    ['m3', 'خديجة علي', 'member', false, true],
    ['late', 'فاطمة الجديدة', 'member', false, true],
    ['inactive', 'زينب المقصاة', 'member', false, false],
    ['mB', 'سارة من ب', 'member', false, true],
  ];
  let i = 1;
  for (const [key, name, role, master, active] of people) {
    id[key] = uuid(i++);
    await q.query('insert into auth.users(id, email) values ($1, $2)', [id[key], `${key}@test.local`]);
    await q.query('insert into public.profiles(id, full_name, phone, role, is_master_admin, active) values ($1,$2,$3,$4,$5,$6)', [
      id[key], name, `0100000${String(i).padStart(4, '0')}`, role, master, active,
    ]);
  }
  id.batchA = uuid(101);
  id.batchB = uuid(102);
  id.cycleA = uuid(201);
  id.cycleB = uuid(202);
  const start = addDays(today, -15);
  await q.query("insert into public.batches(id, name) values ($1, 'الدفعة أ'), ($2, 'الدفعة ب')", [id.batchA, id.batchB]);
  await q.query('insert into public.cycles(id, batch_id, cycle_number, starts_on) values ($1,$2,1,$4), ($3,$5,1,$4)', [id.cycleA, id.batchA, id.cycleB, start, id.batchB]);
  const joined = `${addDays(today, -20)}T09:00:00Z`;
  for (const [u, b, role, at] of [
    ['adminA', 'batchA', 'admin', joined],
    ['adminB', 'batchB', 'admin', joined],
    ['m1', 'batchA', 'member', joined],
    ['m2', 'batchA', 'member', joined],
    ['m3', 'batchA', 'member', joined],
    ['late', 'batchA', 'member', `${addDays(today, -2)}T09:00:00Z`],
    ['inactive', 'batchA', 'member', joined],
    ['mB', 'batchB', 'member', joined],
  ] as const)
    await q.query('insert into public.batch_memberships(batch_id, user_id, membership_role, joined_at) values ($1,$2,$3,$4)', [id[b], id[u], role, at]);
  // History: Tasmi'a quarters 1..5 for m1 (listener m2), reviews of program days 1..3, a past rest day and pause.
  for (let qn = 1; qn <= 5; qn++)
    await q.query('insert into public.tasmia_submissions(cycle_id, user_id, listener_id, quarter_number, listener_name_snapshot) values ($1,$2,$3,$4,$5)', [id.cycleA, id.m1, id.m2, qn, 'مريم أحمد']);
  for (let d = 1; d <= 3; d++)
    await q.query('insert into public.review_confirmations(cycle_id, user_id, program_day, start_quarter, end_quarter) values ($1,$2,$3,1,$3)', [id.cycleA, id.m1, d]);
  await q.query('insert into public.group_rest_days(cycle_id, rest_date, reason) values ($1, $2, $3)', [id.cycleA, addDays(today, -10), 'يوم استدراك']);
  await q.query('insert into public.program_pauses(cycle_id, paused_on, resumed_on) values ($1, $2, $3)', [id.cycleA, addDays(today, -8), addDays(today, -6)]);
}

const TABLES = ['profiles', 'batches', 'batch_memberships', 'cycles', 'group_rest_days', 'program_pauses', 'tasmia_submissions',
  'review_confirmations', 'peer_tests', 'peer_test_attempts', 'daily_thoughts', 'batch_membership_transfers'];
async function snapshot(q: PGlite) {
  const out: Record<string, string> = {};
  for (const t of TABLES)
    out[t] = (await q.query(`select count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from public.${t} x`)).rows[0] as any;
  return out;
}

before(async () => {
  if (skip) return;
  db = await createSchemaDb();
  TODAY = programDate();
  await seed(db, TODAY);
  await applyNewMigrations(db);
  assert.equal((await one(db, 'select app_private.program_today()::text d')).d, programDate());
});
after(() => db?.close());

const addDistant = async (date: string, s = 1, e = 9, cycle = id.cycleA, batch = id.batchA) =>
  (await one(db, 'insert into public.distant_review_assignments(cycle_id, batch_id, review_date, start_quarter, end_quarter) values ($1,$2,$3,$4,$5) returning id', [cycle, batch, date, s, e])).id as string;

// ---------------------------------------------------------------------------------------------
// Migrations: no existing row changes
// ---------------------------------------------------------------------------------------------

test('the three migrations change no existing row (users, Tasmi\'a, reviews, cycles, batches, rest days, pauses)', { skip }, async () => {
  const fresh = await createSchemaDb();
  try {
    await seed(fresh, programDate());
    const before = await snapshot(fresh);
    for (const name of NEW_MIGRATIONS) {
      await fresh.exec(migrationSql(name));
      assert.deepEqual(await snapshot(fresh), before, `after ${name}`);
    }
    for (const t of ['distant_review_assignments', 'distant_review_completions', 'notification_states', 'admin_notification_batch_subscriptions'])
      assert.equal((await one(fresh, `select count(*)::int n from public.${t}`)).n, 0, `${t} starts empty`);
  } finally {
    await fresh.close();
  }
});

test('RLS is enabled on every public table, including the new ones', { skip }, async () => {
  assert.deepEqual(
    (await db.query("select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' and not c.relrowsecurity")).rows,
    []
  );
});

// ---------------------------------------------------------------------------------------------
// 05:00 Africa/Cairo program date
// ---------------------------------------------------------------------------------------------

test('program date: SQL app_private.program_date equals JS programDate (every 30 min across both DST changes, ±1 s at 05:00 Cairo)', { skip }, async () => {
  const instants: Date[] = [];
  for (const [from, to] of [
    ['2026-01-14T00:00:00Z', '2026-01-16T00:00:00Z'],
    ['2026-04-22T00:00:00Z', '2026-04-27T00:00:00Z'],
    ['2026-07-14T00:00:00Z', '2026-07-16T00:00:00Z'],
    ['2026-10-26T00:00:00Z', '2026-11-03T00:00:00Z'],
  ])
    for (let t = Date.parse(from); t < Date.parse(to); t += 30 * 60_000) instants.push(new Date(t));
  for (const d of ['2026-01-15', '2026-04-24', '2026-04-25', '2026-07-15', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']) {
    const s = programDayStart(d).getTime();
    instants.push(new Date(s - 1000), new Date(s), new Date(s + 1000));
  }
  const rows = (await db.query(
    'select i::int, app_private.program_date(t)::text d from unnest($1::timestamptz[]) with ordinality u(t, i)',
    [instants.map((x) => x.toISOString())]
  )).rows as { i: number; d: string }[];
  assert.equal(rows.length, instants.length);
  assert.deepEqual(
    rows.filter((r) => r.d !== programDate(instants[r.i - 1])).map((r) => `${instants[r.i - 1].toISOString()}: SQL ${r.d} JS ${programDate(instants[r.i - 1])}`),
    []
  );
  const at = async (iso: string) => (await one(db, 'select app_private.program_date($1::timestamptz)::text d', [iso])).d;
  assert.equal(await at('2026-10-27T21:00:00Z'), '2026-10-27'); // 00:00:00 Cairo 28 Oct (UTC+3) → previous date
  assert.equal(await at('2026-10-28T01:59:59Z'), '2026-10-27'); // 04:59:59 Cairo (UTC+3)
  assert.equal(await at('2026-10-28T02:00:00Z'), '2026-10-28'); // 05:00:00 Cairo
  assert.equal(await at('2026-10-28T02:00:01Z'), '2026-10-28'); // 05:00:01 Cairo
  assert.equal(await at('2026-01-15T02:59:59Z'), '2026-01-14'); // 04:59:59 Cairo (UTC+2)
  assert.equal(await at('2026-01-15T03:00:00Z'), '2026-01-15'); // 05:00:00 Cairo
  const js1 = programDate();
  const sql = await one(db, 'select app_private.program_today()::text d, app_private.program_date(now())::text p');
  const js2 = programDate();
  assert.equal(sql.d, sql.p);
  assert.ok(sql.d === js1 || sql.d === js2, `${sql.d} vs ${js1}/${js2}`);
});

test('program date helpers are not callable by API roles; peer-test attempts are dated with the program date', { skip }, async () => {
  for (const role of [null, id.m1])
    await as(role, async (tx) => {
      await fails(tx, 'select app_private.program_today()', [], '42501');
      await fails(tx, 'select app_private.program_date(now())', [], '42501');
    });
  const src = (await one(db, "select pg_get_functiondef('public.peer_test_start_attempt(uuid,uuid,uuid,jsonb)'::regprocedure) s")).s as string;
  assert.match(src, /app_private\.program_today\(\)/);
  assert.doesNotMatch(src, /at time zone 'Africa\/Cairo'\)::date/);
  // Privileges of the replaced function are unchanged (service role only).
  await as(id.m1, (tx) => fails(tx, "select public.peer_test_start_attempt($1,$1,$1,'[]'::jsonb)", [uuid(9)], '42501'));
});

test('membership join dates: JS and SQL read every stored joined_at as the same (Makkah) date', { skip }, async () => {
  const rows = (await db.query(
    "select (extract(epoch from joined_at) * 1000)::float8 ms, (joined_at at time zone 'Asia/Riyadh')::date::text d from batch_memberships"
  )).rows as { ms: number; d: string }[];
  assert.ok(rows.length > 0);
  assert.deepEqual(rows.filter((r) => membershipDate(new Date(r.ms)) !== r.d), []);
});

test('paused dates: SQL is_paused_date equals the JS isPausedDate on every date (closed and open pauses)', { skip }, async () => {
  await scratch(async () => {
    await db.query('insert into program_pauses(cycle_id, paused_on, resumed_on) values ($1,$2,$3), ($1,$4,null)', [id.cycleA, addDays(TODAY, -4), addDays(TODAY, -3), addDays(TODAY, 2)]);
    const pauses = (await db.query("select to_char(paused_on,'YYYY-MM-DD') paused_on, to_char(resumed_on,'YYYY-MM-DD') resumed_on from program_pauses where cycle_id=$1", [id.cycleA])).rows as any[];
    const settings = buildProgramSettings({ id: id.cycleA, starts_on: addDays(TODAY, -15), cycle_number: 1 }, pauses);
    const rows = (await db.query(
      "select to_char(d,'YYYY-MM-DD') d, app_private.is_paused_date($1, d::date) p from generate_series($2::date, $3::date, interval '1 day') d",
      [id.cycleA, addDays(TODAY, -15), addDays(TODAY, 10)]
    )).rows as { d: string; p: boolean }[];
    assert.deepEqual(rows.filter((r) => r.p !== isPausedDate(settings, r.d)).map((r) => r.d), []);
    assert.ok(rows.some((r) => r.p));
  });
});

// ---------------------------------------------------------------------------------------------
// «المراجعة البعيدة»
// ---------------------------------------------------------------------------------------------

test('distant review: one schedule type per date — rest day XOR distant review (database guards, admin RLS insert too)', { skip }, async () => {
  await scratch(async () => {
    const date = addDays(TODAY, 6);
    await addDistant(date);
    await fails(db, 'insert into group_rest_days(cycle_id, rest_date) values ($1, $2)', [id.cycleA, date], /مجدول كيوم مراجعة بعيدة/);
    const restDate = addDays(TODAY, 7);
    await db.query('insert into group_rest_days(cycle_id, rest_date) values ($1, $2)', [id.cycleA, restDate]);
    await fails(db, 'select public.distant_review_save(null, $1, $2, 1, 5, null, $3)', [id.batchA, restDate, id.adminA], /يوم استدراك وراحة/);
    await fails(db, 'insert into distant_review_assignments(cycle_id, batch_id, review_date, start_quarter, end_quarter) values ($1,$2,$3,1,2)', [id.cycleA, id.batchA, restDate], /يوم استدراك وراحة/);
    // The admin's own rest-day insert (browser, RLS) is refused with the same message.
    await become(id.adminA);
    await fails(db, 'insert into group_rest_days(cycle_id, rest_date, created_by) values ($1, $2, $3)', [id.cycleA, date, id.adminA], /مجدول كيوم مراجعة بعيدة/);
    await become(null);
    // Another batch's cycle may use the same date.
    await db.query('insert into group_rest_days(cycle_id, rest_date) values ($1, $2)', [id.cycleB, date]);
  });
});

test('distant review admin RPCs: service role only; one future date per call; TO is the stopping boundary; edit/delete only while future', { skip }, async () => {
  for (const uid of [id.master, id.adminA, id.m1, null])
    await as(uid, async (tx) => {
      await fails(tx, 'select public.distant_review_save(null, $1, $2, 1, 12, null, $3)', [id.batchA, addDays(TODAY, 5), id.adminA], '42501');
      await fails(tx, 'select public.distant_review_delete($1, $2)', [id.batchA, id.batchA], '42501');
      await fails(tx, 'insert into distant_review_assignments(cycle_id, batch_id, review_date, start_quarter, end_quarter) values ($1,$2,$3,1,2)', [id.cycleA, id.batchA, addDays(TODAY, 5)], '42501');
    });
  await asService(async (tx) => {
    const save = (aid: string | null, date: string, s: number, e: number, note: string | null = null) =>
      tx.query('select public.distant_review_save($1, $2, $3, $4, $5, $6, $7) r', [aid, id.batchA, date, s, e, note, id.adminA]).then((r: any) => r.rows[0].r);
    const first = await save(null, addDays(TODAY, 10), 1, 9, '  مراجعة ما سبق قبل الاختبار  ');
    assert.deepEqual(
      [first.review_date, first.start_quarter, first.end_quarter, first.note, first.batch_id, first.cycle_id, first.created_by_name_snapshot],
      [addDays(TODAY, 10), 1, 9, 'مراجعة ما سبق قبل الاختبار', id.batchA, id.cycleA, 'مشرفة الدفعة أ']
    );
    const second = await save(null, addDays(TODAY, 17), 20, 30);
    assert.equal(await n(tx, 'select 1 from distant_review_assignments where cycle_id=$1', [id.cycleA]), 2, 'one day per call, nothing generated');
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 1, 12, null, $3)', [id.batchA, TODAY, id.adminA], /في المستقبل/);
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 1, 12, null, $3)', [id.batchA, addDays(TODAY, -3), id.adminA], /في المستقبل/);
    // «إلى الربع» is the stopping boundary: it must come after «من الربع».
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 9, 9, null, $3)', [id.batchA, addDays(TODAY, 12), id.adminA], /نطاق الأرباع/);
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 13, 12, null, $3)', [id.batchA, addDays(TODAY, 12), id.adminA], /نطاق الأرباع/);
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 0, 12, null, $3)', [id.batchA, addDays(TODAY, 12), id.adminA], /نطاق الأرباع/);
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 1, 241, null, $3)', [id.batchA, addDays(TODAY, 12), id.adminA], /نطاق الأرباع/);
    const whole = await save(null, addDays(TODAY, 12), 1, 240);
    assert.deepEqual([whole.start_quarter, whole.end_quarter], [1, 240]);
    await fails(tx, 'select public.distant_review_save(null, $1, $2, 1, 12, null, $3)', [id.batchA, addDays(TODAY, 10), id.adminA], '23505');
    const edited = await save(first.id, addDays(TODAY, 11), 2, 14, 'تعديل');
    assert.deepEqual([edited.id, edited.review_date, edited.start_quarter, edited.end_quarter, edited.note], [first.id, addDays(TODAY, 11), 2, 14, 'تعديل']);
    await fails(tx, 'select public.distant_review_save($1, $2, $3, 1, 2, null, $4)', [first.id, id.batchA, addDays(TODAY, 17), id.adminA], '23505');
    assert.equal((await tx.query('select public.distant_review_delete($1, $2) r', [second.id, id.batchA])).rows[0].r.id, second.id);
    // Wrong batch for an existing id: not found (an admin of B cannot reach A's days).
    await fails(tx, 'select public.distant_review_delete($1, $2)', [first.id, id.batchB], 'P0002');
    await fails(tx, 'select public.distant_review_save($1, $2, $3, 1, 2, null, $4)', [first.id, id.batchB, addDays(TODAY, 30), id.adminB], /غير موجود|P0002/);
    // Today's and past days are kept: neither edited nor deleted.
    const past = (await tx.query('insert into distant_review_assignments(cycle_id, batch_id, review_date, start_quarter, end_quarter) values ($1,$2,$3,1,2) returning id', [id.cycleA, id.batchA, TODAY])).rows[0].id;
    await fails(tx, 'select public.distant_review_save($1, $2, $3, 1, 2, null, $4)', [past, id.batchA, addDays(TODAY, 20), id.adminA], /حلّ موعده/);
    await fails(tx, 'select public.distant_review_delete($1, $2)', [past, id.batchA], /حلّ موعده/);
  });
});

test('distant review RLS: members read their batch days and only their own completions; batch admins only their batches; anon nothing', { skip }, async () => {
  await scratch(async () => {
    const a = await addDistant(TODAY, 1, 12);
    const b = await addDistant(TODAY, 3, 6, id.cycleB, id.batchB);
    await db.query('insert into distant_review_completions(assignment_id, user_id, completed_on) values ($1, $2, $3)', [a, id.m2, TODAY]);
    await become(id.m1);
    assert.equal(await n(db, 'select 1 from distant_review_assignments'), 1, 'her batch only');
    assert.equal(await n(db, 'select 1 from distant_review_assignments where id=$1', [b]), 0);
    assert.equal(await n(db, 'select 1 from distant_review_completions'), 0, "another member's completion is not hers");
    await fails(db, 'insert into distant_review_completions(assignment_id, user_id, completed_on) values ($1, $2, $3)', [a, id.m1, TODAY], '42501');
    await fails(db, 'update distant_review_assignments set end_quarter = 20 where id=$1', [a], '42501');
    await fails(db, 'delete from distant_review_assignments where id=$1', [a], '42501');
    await become(id.adminA);
    assert.equal(await n(db, 'select 1 from distant_review_assignments'), 1);
    assert.equal(await n(db, 'select 1 from distant_review_completions where assignment_id=$1', [a]), 1, 'admin sees her batch completions');
    await become(id.adminB);
    assert.equal(await n(db, 'select 1 from distant_review_assignments where batch_id=$1', [id.batchA]), 0);
    assert.equal(await n(db, 'select 1 from distant_review_completions'), 0);
    await become(id.master);
    assert.equal(await n(db, 'select 1 from distant_review_assignments'), 2, 'master admin: every batch');
    await become(null);
    await db.query("select set_config('request.jwt.claims', '', true)");
    await db.query('set local role anon');
    await fails(db, 'select 1 from distant_review_assignments', [], '42501');
    await fails(db, 'select 1 from distant_review_completions', [], '42501');
    await fails(db, 'select public.complete_distant_review($1)', [a], '42501');
    await become(null);
  });
});

test('distant review completion: today or late, idempotent (assignment + member), never future/paused/rest/before joining/other batch/inactive', { skip }, async () => {
  await scratch(async () => {
    const today = await addDistant(TODAY, 1, 12);
    const missed = await addDistant(addDays(TODAY, -3), 13, 24);
    const future = await addDistant(addDays(TODAY, 2), 1, 2);
    const pausedDay = await addDistant(addDays(TODAY, -7), 1, 2); // inside the seeded pause [-8, -6)
    await become(id.m1);
    const done = (await one(db, 'select public.complete_distant_review($1) r', [today])).r;
    assert.deepEqual([done.user_id, done.completed_on, done.already_recorded, done.member_name_snapshot], [id.m1, TODAY, false, 'عائشة محمد']);
    assert.equal((await one(db, 'select public.complete_distant_review($1) r', [today])).r.already_recorded, true);
    const late = (await one(db, 'select public.complete_distant_review($1) r', [missed])).r;
    assert.equal(late.completed_on, TODAY, 'completed late: the program date of the confirmation');
    await fails(db, 'select public.complete_distant_review($1)', [future], /لم يحن موعد/);
    await fails(db, 'select public.complete_distant_review($1)', [pausedDay], /غير مطلوبة منكِ/);
    await fails(db, 'select public.complete_distant_review($1)', [uuid(999)], 'P0002');
    assert.equal(await n(db, 'select 1 from distant_review_completions where user_id=$1', [id.m1]), 2, 'one row per assignment');
    // Joined after the date: not owed.
    await become(id.late);
    await fails(db, 'select public.complete_distant_review($1)', [missed], /غير مطلوبة منكِ/);
    assert.equal((await one(db, 'select public.complete_distant_review($1) r', [today])).r.already_recorded, false);
    await become(id.inactive);
    await fails(db, 'select public.complete_distant_review($1)', [today], '42501');
    await become(id.mB);
    await fails(db, 'select public.complete_distant_review($1)', [today], '42501');
    await become(null);
    // A completion is permanent: it survives the assignment being in the past and is never re-owed.
    assert.equal(await n(db, 'select 1 from distant_review_completions where assignment_id=$1', [today]), 2);
  });
});

test('batch admin data scope (alerts input): an unassigned batch yields no members, Tasmi\'a, reviews or distant days', { skip }, async () => {
  await as(id.adminB, async (tx) => {
    assert.equal(await n(tx, "select 1 from batch_memberships where batch_id=$1 and membership_role='member'", [id.batchA]), 0);
    assert.equal(await n(tx, 'select 1 from tasmia_submissions where cycle_id=$1', [id.cycleA]), 0);
    assert.equal(await n(tx, 'select 1 from review_confirmations where cycle_id=$1', [id.cycleA]), 0);
    assert.equal(await n(tx, 'select 1 from cycles where batch_id=$1', [id.batchA]), 0);
    assert.ok((await n(tx, "select 1 from batch_memberships where batch_id=$1 and membership_role='member'", [id.batchB])) > 0);
  });
  await as(id.master, async (tx) => {
    assert.ok((await n(tx, "select 1 from batch_memberships where batch_id=$1 and membership_role='member'", [id.batchA])) > 0);
    assert.ok((await n(tx, "select 1 from batch_memberships where batch_id=$1 and membership_role='member'", [id.batchB])) > 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Notification state and master-admin follows
// ---------------------------------------------------------------------------------------------

test('notification state: own rows only, one row per key (idempotent seen / archive), no direct writes, anon nothing', { skip }, async () => {
  await scratch(async () => {
    const item = (key: string, urgent = false) => JSON.stringify({ key, kind: 'rest-tomorrow', tone: 'info', urgent, title: 'غدًا يوم راحة', body: 'x' });
    await become(id.m1);
    assert.equal((await one(db, 'select public.notifications_mark_seen($1::jsonb) n', [`[${item('b:1:rest-tomorrow:2026-11-02')}]`])).n, 1);
    await db.query('select public.notifications_mark_seen($1::jsonb)', [`[${item('b:1:rest-tomorrow:2026-11-02')}]`]);
    const r1 = (await db.query("select seen_at, archived_at from notification_states where notification_key='b:1:rest-tomorrow:2026-11-02'")).rows as any[];
    assert.equal(r1.length, 1, 'opening the panel twice keeps one row');
    assert.ok(r1[0].seen_at && r1[0].archived_at === null, 'seen, not archived');
    const a1 = (await one(db, 'select public.notification_archive($1::jsonb) t', [item('b:1:rest-tomorrow:2026-11-02')])).t;
    const a2 = (await one(db, 'select public.notification_archive($1::jsonb) t', [item('b:1:rest-tomorrow:2026-11-02')])).t;
    assert.equal(String(a1), String(a2), 'the first click time is kept');
    assert.equal(await n(db, 'select 1 from notification_states'), 1);
    // An urgent notification archived directly (clicked) keeps its snapshot for «عرض كل التنبيهات».
    await db.query('select public.notification_archive($1::jsonb)', [item('b:1:tasmia:serious:q4', true)]);
    assert.deepEqual(Object.values(await one(db, "select urgent, title from notification_states where notification_key='b:1:tasmia:serious:q4'")), [true, 'غدًا يوم راحة']);
    await fails(db, "insert into notification_states(user_id, notification_key) values($1, 'x')", [id.m1], '42501');
    await fails(db, 'update notification_states set archived_at = null', [], '42501');
    await fails(db, 'delete from notification_states', [], '42501');
    await fails(db, "select public.notifications_mark_seen('{}'::jsonb)", [], '22023');
    await become(id.m2);
    assert.equal(await n(db, 'select 1 from notification_states'), 0, "another member's state is invisible");
    await become(id.master);
    assert.equal(await n(db, 'select 1 from notification_states'), 0, "admins do not see members' state");
    await become(id.inactive);
    await fails(db, 'select public.notification_archive($1::jsonb)', [item('k')], '42501');
    await become(null);
  });
  await as(null, async (tx) => {
    await fails(tx, 'select 1 from notification_states', [], '42501');
    await fails(tx, "select public.notification_archive('{\"key\":\"x\"}'::jsonb)", [], '42501');
  });
});

test('master admin batch follows: only master admins, only their own preferences, persisted; batch admins and members cannot follow', { skip }, async () => {
  await scratch(async () => {
    await become(id.master);
    await db.query('select public.set_notification_batch_follow($1, true)', [id.batchA]);
    await db.query('select public.set_notification_batch_follow($1, false)', [id.batchB]);
    await db.query('select public.set_notification_batch_follow($1, true)', [id.batchA]);
    const rows = (await db.query('select batch_id, enabled from admin_notification_batch_subscriptions order by enabled desc')).rows as any[];
    assert.deepEqual(rows.map((r) => [r.batch_id, r.enabled]), [[id.batchA, true], [id.batchB, false]], 'one row per batch, latest choice');
    await fails(db, 'select public.set_notification_batch_follow($1, true)', [uuid(998)], 'P0002');
    await fails(db, 'insert into admin_notification_batch_subscriptions(admin_user_id, batch_id) values($1,$2)', [id.master, id.batchB], '42501');
    // Another master admin has her own preferences and cannot see these.
    await become(id.master2);
    assert.equal(await n(db, 'select 1 from admin_notification_batch_subscriptions'), 0);
    await db.query('select public.set_notification_batch_follow($1, true)', [id.batchB]);
    assert.equal(await n(db, 'select 1 from admin_notification_batch_subscriptions'), 1);
    await become(id.adminA);
    await fails(db, 'select public.set_notification_batch_follow($1, true)', [id.batchA], '42501');
    assert.equal(await n(db, 'select 1 from admin_notification_batch_subscriptions'), 0);
    await become(id.m1);
    await fails(db, 'select public.set_notification_batch_follow($1, true)', [id.batchA], '42501');
    assert.equal(await n(db, 'select 1 from admin_notification_batch_subscriptions'), 0);
    await become(null);
    // Persisted: a new session of the first master admin reads the same choice.
    assert.deepEqual(
      (await db.query('select batch_id, enabled from admin_notification_batch_subscriptions where admin_user_id=$1 order by enabled desc', [id.master])).rows.map((r: any) => [r.batch_id, r.enabled]),
      [[id.batchA, true], [id.batchB, false]]
    );
  });
  await as(null, (tx) => fails(tx, 'select 1 from admin_notification_batch_subscriptions', [], '42501'));
});

// ---------------------------------------------------------------------------------------------
// Regression: the two production failures (objects missing from the API schema)
// ---------------------------------------------------------------------------------------------

test('regression: every RPC the app calls exists with exactly the argument names the frontend sends', { skip }, async () => {
  const src = fs.readFileSync('src/api/client.ts', 'utf8');
  const calls = [...src.matchAll(/\.rpc\(\s*'(\w+)',\s*\{([^}]*)\}/g)].map((m) => ({
    name: m[1],
    args: [...m[2].matchAll(/(p_\w+)\s*:/g)].map((a) => a[1]).sort(),
  }));
  for (const name of ['set_notification_batch_follow', 'notifications_mark_seen', 'notification_archive', 'complete_distant_review'])
    assert.ok(calls.some((c) => c.name === name), `client calls ${name}`);
  for (const c of calls) {
    const rows = (await db.query(
      `select array(select n from unnest(proargnames, coalesce(proargmodes, array_fill('i'::"char", array[cardinality(proargnames)]))) u(n, m)
              where m in ('i', 'b') order by 1) a
       from pg_proc where proname=$1 and pronamespace='public'::regnamespace`,
      [c.name]
    )).rows as { a: string[] }[];
    assert.ok(rows.some((r) => JSON.stringify(r.a) === JSON.stringify(c.args)), `public.${c.name}(${c.args.join(', ')}) exists`);
  }
  // Named-argument call, as PostgREST does it.
  await as(id.master, (tx) => tx.query('select public.set_notification_batch_follow(p_batch_id => $1, p_enabled => true)', [id.batchA]));
});

test('regression: every table the app reads exists and is readable by authenticated users through RLS', { skip }, async () => {
  const src = fs.readFileSync('src/api/client.ts', 'utf8') + fs.readFileSync('supabase/functions/_shared/logic/batchDelays.ts', 'utf8');
  const tables = [...new Set([...src.matchAll(/\.from\(\s*'(\w+)'\s*\)/g)].map((m) => m[1]))];
  for (const t of ['distant_review_assignments', 'distant_review_completions', 'notification_states', 'admin_notification_batch_subscriptions'])
    assert.ok(tables.includes(t), `app reads ${t}`);
  for (const t of tables) {
    assert.ok((await one(db, 'select to_regclass($1) r', [`public.${t}`])).r, `public.${t} exists`);
    await as(id.m1, (tx) => tx.query(`select 1 from public.${t} limit 1`));
  }
});
