// Production smoke test of the three ported features on the SISTERS project (cuexuketulmyskmdvosp):
// notifications (state RPCs, master-admin follows, alert filtering), «المراجعة البعيدة» (admin-actions
// Edge Function, member completion, RLS) and the 05:00 Africa/Cairo program date. Real Supabase Auth
// sessions with the publishable key (exactly what the browser uses), plus an optional browser phase
// against the real app (local `vite` dev server using .env.local).
//
// Only TEMPORARY data: two «SMOKE …» batches and «SMOKE» accounts are created, used and deleted with
// every row they wrote. Real members, batches and history are only read, never written.
//
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//   [APP_URL=http://localhost:4175/ PLAYWRIGHT_PATH=<playwright dir>] npx tsx tests/production/smoke.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { addDays, programDate } from '../../supabase/functions/_shared/logic/programDate.ts';
import { computeBatchDelays, loadBatchProgram } from '../../supabase/functions/_shared/logic/batchDelays.ts';
import { buildBatchAdminAlerts } from '../../supabase/functions/_shared/logic/notifications.ts';
import { phoneToAuthEmail } from '../../src/lib/authHelpers.ts';

const SISTERS = 'cuexuketulmyskmdvosp';
const url = process.env.SUPABASE_URL || '';
if (!url.includes(SISTERS) || url.includes('uaublandjewfzmhnbflc')) throw new Error('Refusing: SUPABASE_URL is not the Sisters project.');
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY as string;
const service: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });

const results: { check: string; ok: boolean; detail?: string }[] = [];
const record = (check: string, ok: unknown, detail = '') => {
  results.push({ check, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail ? `  — ${detail}` : ''}`);
};
const tag = randomBytes(3).toString('hex');
const TODAY = programDate();
const START = addDays(TODAY, -10);

type Acc = { key: string; id: string; phone: string; password: string };
const acc: Record<string, Acc> = {};
const batches: Record<string, { id: string; name: string; cycle: string }> = {};

function client() {
  const store = new Map<string, string>();
  return createClient(url, publishable, {
    auth: { persistSession: true, autoRefreshToken: false, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) } },
  });
}
async function signIn(a: Acc) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email: phoneToAuthEmail(a.phone), password: a.password });
  if (error) throw new Error(`sign-in ${a.key}: ${error.message}`);
  return c;
}
const must = <T,>(r: { data: T; error: any }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};

async function createAccount(key: string, role: 'member' | 'admin', opts: { master?: boolean; memberBatch?: string; adminBatches?: string[] } = {}) {
  const phone = `0199${randomBytes(4).readUInt32BE(0).toString().padStart(7, '0').slice(0, 7)}`;
  const password = randomBytes(12).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({ email: phoneToAuthEmail(phone), password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${key}: ${error?.message}`);
  acc[key] = { key, id: data.user.id, phone, password };
  must(
    await service.rpc('create_profile_with_membership', {
      p_id: data.user.id, p_full_name: `SMOKE ${key} ${tag}`, p_phone: phone, p_role: role, p_is_master_admin: !!opts.master,
      p_member_batch_id: opts.memberBatch ?? null, p_admin_batch_ids: opts.adminBatches ?? [], p_actor: null,
    }),
    `profile ${key}`
  );
  if (role === 'member') must(await service.from('batch_memberships').update({ joined_at: `${START}T06:00:00Z` }).eq('user_id', data.user.id), 'joined_at');
  return acc[key];
}

async function seed() {
  for (const k of ['S1', 'S2']) {
    const name = `SMOKE ${k} ${tag}`;
    const b = must(await service.rpc('create_batch_with_cycle', { p_name: name, p_start_date: START, p_actor: null }), `batch ${k}`) as any;
    const cycle = must(await service.from('cycles').select('id').eq('batch_id', b.id).eq('status', 'active').single(), 'cycle') as any;
    batches[k] = { id: b.id, name, cycle: cycle.id };
  }
  await createAccount('master', 'admin', { master: true });
  await createAccount('adminA', 'admin', { adminBatches: [batches.S1.id] });
  await createAccount('m1', 'member', { memberBatch: batches.S1.id });
  await createAccount('m2', 'member', { memberBatch: batches.S1.id });
  await createAccount('mB', 'member', { memberBatch: batches.S2.id });
  await createAccount('mB2', 'member', { memberBatch: batches.S2.id });
  // A past «المراجعة البعيدة» day in S1 (two program dates ago): a non-program day, owed by S1's members.
  const pastDistant = must(
    await service.from('distant_review_assignments').insert({ batch_id: batches.S1.id, cycle_id: batches.S1.cycle, review_date: addDays(TODAY, -2), start_quarter: 1, end_quarter: 9, note: 'SMOKE' }).select('id').single(),
    'past distant'
  ) as any;
  // S1 program days: START..TODAY minus the distant day = 10 → quarter 10 today. m1 recited 1..6 (7, 8, 9 overdue → serious);
  // m2 recited 1..8 (one day). S2: 11 program days; mB recited 1..6 (7..10 overdue → serious); mB2 everything.
  const tasmia = (k: string, listener: string, cycle: string, qs: number[]) =>
    qs.map((q) => ({ cycle_id: cycle, user_id: acc[k].id, listener_id: acc[listener].id, quarter_number: q, listener_name_snapshot: 'x' }));
  must(await service.from('tasmia_submissions').insert([
    ...tasmia('m1', 'm2', batches.S1.cycle, [1, 2, 3, 4, 5, 6]),
    ...tasmia('m2', 'm1', batches.S1.cycle, [1, 2, 3, 4, 5, 6, 7, 8]),
    ...tasmia('mB', 'mB2', batches.S2.cycle, [1, 2, 3, 4, 5, 6]),
    ...tasmia('mB2', 'mB', batches.S2.cycle, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
  ]), 'tasmia');
  const reviews = (k: string, cycle: string, days: number) =>
    Array.from({ length: days }, (_, i) => ({ cycle_id: cycle, user_id: acc[k].id, program_day: i + 1, start_quarter: Math.max(1, i - 6), end_quarter: i + 1 }));
  must(await service.from('review_confirmations').insert([...reviews('m1', batches.S1.cycle, 6), ...reviews('m2', batches.S1.cycle, 9), ...reviews('mB', batches.S2.cycle, 10), ...reviews('mB2', batches.S2.cycle, 10)]), 'reviews');
  return pastDistant.id as string;
}

/** The app's admin alert pipeline (App.tsx + api.getBatchAdminAlerts) for one session. */
async function alertsFor(c: SupabaseClient, scope: { id: string; name: string }[]) {
  const out: string[] = [];
  for (const b of scope) {
    const { data: cycle } = await c.from('cycles').select('id, batch_id, cycle_number, starts_on').eq('batch_id', b.id).eq('status', 'active').maybeSingle();
    if (!cycle) continue;
    const program = await loadBatchProgram(c, cycle as any);
    const { members, delayById } = computeBatchDelays(program, TODAY);
    for (const a of buildBatchAdminAlerts(b, members, delayById)) out.push(`${b.id === batches.S1.id ? 'S1' : b.id === batches.S2.id ? 'S2' : 'real'}:${a.memberName.split(' ')[1]}:${a.issues.map((i) => i.category + ':' + i.count).join('+')}`);
  }
  return out.sort();
}
const masterAlerts = async (c: SupabaseClient) => {
  const follows = must(await c.from('admin_notification_batch_subscriptions').select('batch_id').eq('enabled', true), 'follows') as any[];
  const ids = new Set(follows.map((f) => f.batch_id));
  return alertsFor(c, Object.values(batches).filter((b) => ids.has(b.id)));
};
const invoke = async (c: SupabaseClient, body: Record<string, unknown>) => {
  const { data, error } = await c.functions.invoke('admin-actions', { body });
  if (error) {
    const ctx = (error as any).context;
    try {
      return { status: ctx?.status, ...(await ctx.json()) };
    } catch {
      return { status: ctx?.status, error: error.message };
    }
  }
  return { status: 200, ...data };
};

async function api() {
  const pastDistantId = await seed();
  const anon = createClient(url, publishable, { auth: { persistSession: false } });
  const master = await signIn(acc.master);
  const adminA = await signIn(acc.adminA);
  const m1 = await signIn(acc.m1);
  const m2 = await signIn(acc.m2);
  const mB = await signIn(acc.mB);

  // ---------------------------------------------------------------- program date
  const sqlToday = await service.rpc('history_member_names', { p_cycle_id: batches.S1.cycle }); // service reachability
  record('service role reaches the Sisters API', !sqlToday.error, sqlToday.error?.message);

  // ---------------------------------------------------------------- master admin follows + filtering
  for (const [b, on] of [['S1', true], ['S2', false]] as const) {
    const r = await master.rpc('set_notification_batch_follow', { p_batch_id: batches[b].id, p_enabled: on });
    record(`set_notification_batch_follow(${b}, ${on}) callable by the master admin`, !r.error && r.data === on, r.error?.message);
  }
  record('followed S1 / unfollowed S2: only S1\'s 3+ member alert', JSON.stringify(await masterAlerts(master)) === JSON.stringify(['S1:m1:tasmia:3+revision:3']), JSON.stringify(await masterAlerts(master)));
  const master2 = await signIn(acc.master);
  const persisted = (must(await master2.from('admin_notification_batch_subscriptions').select('batch_id, enabled'), 'read follows') as any[]).map((r) => `${r.batch_id === batches.S1.id ? 'S1' : 'S2'}:${r.enabled}`).sort();
  record('follow preferences persist in a new session (logout/login)', JSON.stringify(persisted) === JSON.stringify(['S1:true', 'S2:false']), JSON.stringify(persisted));
  await master.rpc('set_notification_batch_follow', { p_batch_id: batches.S1.id, p_enabled: false });
  await master.rpc('set_notification_batch_follow', { p_batch_id: batches.S2.id, p_enabled: true });
  record('switched (S1 OFF, S2 ON): alerts follow the new preferences', JSON.stringify(await masterAlerts(master)) === JSON.stringify(['S2:mB:tasmia:4']), JSON.stringify(await masterAlerts(master)));
  const bad = await adminA.rpc('set_notification_batch_follow', { p_batch_id: batches.S1.id, p_enabled: true });
  record('batch admin cannot use master follows', !!bad.error);
  const memberFollow = await m1.rpc('set_notification_batch_follow', { p_batch_id: batches.S1.id, p_enabled: true });
  record('member cannot use master follows', !!memberFollow.error);
  record('another account does not see the master\'s follows', ((await adminA.from('admin_notification_batch_subscriptions').select('*')).data || []).length === 0);

  // ---------------------------------------------------------------- batch admin scope
  record('batch admin: ONE grouped card for m1 (Tasmi\'a 3 + review 3); m2 with 1 day gives none', JSON.stringify(await alertsFor(adminA, Object.values(batches))) === JSON.stringify(['S1:m1:tasmia:3+revision:3']), JSON.stringify(await alertsFor(adminA, Object.values(batches))));

  // ---------------------------------------------------------------- per-admin dismissal
  const dis = await adminA.rpc('admin_alert_dismiss', { p_batch_id: batches.S1.id, p_member_id: acc.m1.id, p_member_name: 'SMOKE m1', p_summary: 'SMOKE' });
  record('admin_alert_dismiss callable by the batch admin (own batch)', !dis.error, dis.error?.message);
  record('dismissal is stored for that admin only', ((await adminA.from('admin_alert_dismissals').select('member_user_id')).data || []).length === 1 && ((await master.from('admin_alert_dismissals').select('*')).data || []).length === 0);
  record('dismissal changes no member data (Tasmi\'a rows unchanged)', ((await adminA.from('tasmia_submissions').select('id').eq('user_id', acc.m1.id)).data || []).length === 6);
  record('batch admin cannot dismiss in another batch', !!(await adminA.rpc('admin_alert_dismiss', { p_batch_id: batches.S2.id, p_member_id: acc.mB.id, p_member_name: '', p_summary: '' })).error);
  record('member cannot dismiss admin alerts', !!(await m2.rpc('admin_alert_dismiss', { p_batch_id: batches.S1.id, p_member_id: acc.m1.id, p_member_name: '', p_summary: '' })).error);
  const adminA2 = await signIn(acc.adminA);
  record('dismissal persists in a new session', ((await adminA2.from('admin_alert_dismissals').select('*')).data || []).length === 1);
  const res = await adminA.rpc('admin_alert_restore', { p_batch_id: batches.S1.id, p_member_id: acc.m1.id });
  record('restore removes the dismissal', res.data === true && ((await adminA.from('admin_alert_dismissals').select('*')).data || []).length === 0);
  record('anon denied: admin_alert_dismissals', !!(await anon.from('admin_alert_dismissals').select('*')).error && !!(await anon.rpc('admin_alert_restore', { p_batch_id: batches.S1.id, p_member_id: acc.m1.id })).error);
  record('batch admin cannot read the other batch\'s members', ((await adminA.from('batch_memberships').select('user_id').eq('batch_id', batches.S2.id)).data || []).length === 0);

  // ---------------------------------------------------------------- notification state
  const item = (key: string, urgent = false) => ({ key, kind: 'rest-tomorrow', tone: 'info', urgent, title: 'SMOKE', body: 'SMOKE' });
  const seen = await m1.rpc('notifications_mark_seen', { p_items: [item(`smoke:${tag}:a`)] });
  const arch = await m1.rpc('notification_archive', { p_item: item(`smoke:${tag}:b`, true) });
  const arch2 = await m1.rpc('notification_archive', { p_item: item(`smoke:${tag}:b`, true) });
  record('notifications_mark_seen / notification_archive callable (idempotent)', !seen.error && !arch.error && String(arch.data) === String(arch2.data), seen.error?.message || arch.error?.message);
  const own = (must(await m1.from('notification_states').select('notification_key, seen_at, archived_at'), 'states') as any[]);
  record('member reads her own state: one row per key, seen vs archived', own.length === 2 && own.some((r) => r.seen_at && !r.archived_at) && own.some((r) => r.archived_at), JSON.stringify(own));
  record('another member cannot see it', ((await m2.from('notification_states').select('*')).data || []).length === 0);
  record('no direct writes to notification_states', !!(await m1.from('notification_states').delete().eq('user_id', acc.m1.id).select()).error || ((await m1.from('notification_states').select('*')).data || []).length === 2);

  // ---------------------------------------------------------------- distant review: admin-actions
  const future = addDays(TODAY, 3);
  const created = await invoke(adminA, { action: 'distant-review-create', batch_id: batches.S1.id, review_date: future, start_quarter: 1, end_quarter: 9, note: 'SMOKE' });
  record('admin-actions distant-review-create (batch admin, own batch)', created.status === 200 && created.assignment?.review_date === future, JSON.stringify(created).slice(0, 160));
  const otherBatch = await invoke(adminA, { action: 'distant-review-create', batch_id: batches.S2.id, review_date: future, start_quarter: 1, end_quarter: 9 });
  record('batch admin refused on another batch', otherBatch.status === 403 || !!otherBatch.error, JSON.stringify(otherBatch).slice(0, 120));
  const sameBound = await invoke(adminA, { action: 'distant-review-create', batch_id: batches.S1.id, review_date: addDays(TODAY, 4), start_quarter: 9, end_quarter: 9 });
  record('TO must come after FROM (TO is the stopping boundary)', sameBound.status === 400, JSON.stringify(sameBound).slice(0, 120));
  const pastTry = await invoke(adminA, { action: 'distant-review-create', batch_id: batches.S1.id, review_date: TODAY, start_quarter: 1, end_quarter: 2 });
  record('creation only for future program dates', pastTry.status === 400 && /المستقبل/.test(pastTry.error || ''), JSON.stringify(pastTry).slice(0, 120));
  const masterOnS2 = await invoke(master, { action: 'distant-review-create', batch_id: batches.S2.id, review_date: future, start_quarter: 20, end_quarter: 30 });
  record('master admin creates on any batch', masterOnS2.status === 200, JSON.stringify(masterOnS2).slice(0, 120));
  const edited = await invoke(adminA, { action: 'distant-review-update', assignment_id: created.assignment?.id, review_date: future, start_quarter: 2, end_quarter: 12, note: 'SMOKE edit' });
  record('future edit', edited.status === 200, JSON.stringify(edited).slice(0, 120));
  const restClash = await adminA.from('group_rest_days').insert({ cycle_id: batches.S1.cycle, rest_date: future, created_by: acc.adminA.id });
  record('a rest day may share the date of a distant review (it stays required)', !restClash.error, restClash.error?.message);
  const deleted = await invoke(adminA, { action: 'distant-review-delete', assignment_id: created.assignment?.id });
  record('future delete', deleted.status === 200, JSON.stringify(deleted).slice(0, 120));
  const pastDel = await invoke(adminA, { action: 'distant-review-delete', assignment_id: pastDistantId });
  record('past day cannot be deleted (history kept)', pastDel.status === 400, JSON.stringify(pastDel).slice(0, 120));

  // ---------------------------------------------------------------- distant review: member + RLS
  record('member reads her batch\'s distant days only', ((await m1.from('distant_review_assignments').select('batch_id')).data || []).every((r: any) => r.batch_id === batches.S1.id) && ((await mB.from('distant_review_assignments').select('id').eq('batch_id', batches.S1.id)).data || []).length === 0);
  record('member cannot write assignments', !!(await m1.from('distant_review_assignments').insert({ batch_id: batches.S1.id, cycle_id: batches.S1.cycle, review_date: addDays(TODAY, 9), start_quarter: 1, end_quarter: 2 })).error);
  const done = await m1.rpc('complete_distant_review', { p_assignment_id: pastDistantId });
  record('member completes an overdue distant review (dated with the program date)', !done.error && done.data?.completed_on === TODAY && done.data?.already_recorded === false, done.error?.message || JSON.stringify(done.data));
  const again = await m1.rpc('complete_distant_review', { p_assignment_id: pastDistantId });
  record('completion is idempotent (assignment + member identity)', again.data?.already_recorded === true);
  record('other batch member cannot complete it', !!(await mB.rpc('complete_distant_review', { p_assignment_id: pastDistantId })).error);
  record('member sees only her own completions', ((await m2.from('distant_review_completions').select('*')).data || []).length === 0 && ((await m1.from('distant_review_completions').select('*')).data || []).length === 1);
  record('admin sees her batch\'s completions', ((await adminA.from('distant_review_completions').select('*')).data || []).length === 1);
  const prog = await loadBatchProgram(m1, { id: batches.S1.cycle, batch_id: batches.S1.id, cycle_number: 1, starts_on: START });
  const d = computeBatchDelays(prog, TODAY);
  record('calendar: the distant-review day is not a program day (quarter 10, not 11)', d.cycleInfo.quarter_of_day === 10 && !d.activeDates.includes(addDays(TODAY, -2)), String(d.cycleInfo.quarter_of_day));

  // ---------------------------------------------------------------- anon
  for (const t of ['distant_review_assignments', 'distant_review_completions', 'notification_states', 'admin_notification_batch_subscriptions'])
    record(`anon denied: ${t}`, !!(await anon.from(t).select('*').limit(1)).error);
  for (const [f, a] of [['set_notification_batch_follow', { p_batch_id: batches.S1.id, p_enabled: true }], ['complete_distant_review', { p_assignment_id: pastDistantId }], ['notification_archive', { p_item: item('x') }]] as const)
    record(`anon denied: ${f}`, !!(await anon.rpc(f, a as any)).error);

  // ---------------------------------------------------------------- peer-tests function boots with the new shared code
  const { error: ptErr } = await adminA.functions.invoke('peer-tests', { body: { action: 'admin-impact', test_id: '00000000-0000-4000-8000-000000000000' } });
  const ptBody = ptErr ? await (ptErr as any).context?.json?.().catch(() => null) : null;
  record('peer-tests (new version) responds with its own validation', !!ptBody?.error && (ptErr as any).context?.status === 404, JSON.stringify(ptBody));

  // ---------------------------------------------------------------- distant review over pauses / rest days (S2 only)
  const s2Start = { id: batches.S2.cycle, batch_id: batches.S2.id, cycle_number: 1, starts_on: START };
  const qBefore = computeBatchDelays(await loadBatchProgram(service, s2Start), TODAY).cycleInfo.quarter_of_day;
  must(await service.from('program_pauses').insert({ cycle_id: batches.S2.cycle, paused_on: addDays(TODAY, -6), resumed_on: addDays(TODAY, -5) }), 'closed pause');
  must(await service.from('group_rest_days').insert({ cycle_id: batches.S2.cycle, rest_date: addDays(TODAY, -3) }), 'rest');
  const ins = async (date: string) => (must(await service.from('distant_review_assignments').insert({ batch_id: batches.S2.id, cycle_id: batches.S2.cycle, review_date: date, start_quarter: 3, end_quarter: 7 }).select('id').single(), 'distant') as any).id as string;
  const onPaused = await ins(addDays(TODAY, -6));
  const onRest = await ins(addDays(TODAY, -3));
  const progAfter = computeBatchDelays(await loadBatchProgram(service, s2Start), TODAY);
  record('calendar: a paused date and a rest date that carry a distant review are each counted once (2 days, not 4)', progAfter.cycleInfo.quarter_of_day === qBefore - 2, `${qBefore} → ${progAfter.cycleInfo.quarter_of_day}`);
  const cP = await mB.rpc('complete_distant_review', { p_assignment_id: onPaused });
  record('distant review on a paused date: owed and completable', !cP.error && cP.data?.already_recorded === false, cP.error?.message);
  const cR = await mB.rpc('complete_distant_review', { p_assignment_id: onRest });
  record('distant review on a rest day: owed and completable', !cR.error && cR.data?.already_recorded === false, cR.error?.message);
  must(await service.from('program_pauses').insert({ cycle_id: batches.S2.cycle, paused_on: addDays(TODAY, -1) }), 'open pause');
  const onToday = await ins(TODAY);
  const prog2 = computeBatchDelays(await loadBatchProgram(service, s2Start), TODAY);
  record('open pause: today is the distant-review day; no new normal program day', prog2.cycleInfo.is_distant_review_day && prog2.cycleInfo.is_paused && !prog2.activeDates.includes(TODAY));
  const cT = await mB.rpc('complete_distant_review', { p_assignment_id: onToday });
  const cT2 = await mB.rpc('complete_distant_review', { p_assignment_id: onToday });
  record("open pause: today's distant review completable, once", !cT.error && cT2.data?.already_recorded === true, cT.error?.message);

  // Reset the master follows for the browser phase (S1 ON, S2 OFF is set there through the UI).
  await master.rpc('set_notification_batch_follow', { p_batch_id: batches.S1.id, p_enabled: false });
  await master.rpc('set_notification_batch_follow', { p_batch_id: batches.S2.id, p_enabled: false });
}

async function browserPhase() {
  const APP = process.env.APP_URL;
  if (!APP) return console.log('(browser phase skipped: APP_URL not set)');
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch();
  const login = async (a: Acc) => {
    const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('console', (m: any) => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
    page.on('pageerror', (e: any) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r: any) => r.url().includes(SISTERS) && r.status() >= 400 && problems.push(`${r.status()} ${r.url().split('?')[0].slice(-80)}`));
    await page.goto(APP);
    await page.fill('#login-phone-input', a.phone);
    await page.fill('#login-password-input', a.password);
    await page.click('#login-submit-btn');
    await page.waitForSelector('#notifications-button', { timeout: 30000 });
    await page.waitForTimeout(2500);
    return { page, context, problems };
  };
  try {
    // Master admin: the exact screen of the bug report.
    let { page, context, problems } = await login(acc.master);
    await page.click('#notifications-button');
    await page.click('#notification-settings-btn');
    await page.waitForSelector(`#follow-batch-${batches.S1.id}`);
    record('UI: master admin sees the batches in «إعدادات التنبيهات»', (await page.locator('#notification-follow-settings button[role="switch"]').count()) >= 2);
    await page.click(`#follow-batch-${batches.S1.id}`);
    await page.waitForTimeout(1500);
    record('UI: toggle S1 ON — no schema-cache / RPC error', (await page.locator(`#follow-batch-${batches.S1.id}`).getAttribute('aria-checked')) === 'true' && !(await page.locator('#notification-follow-settings').innerText()).includes('schema cache'));
    await page.click(`#follow-batch-${batches.S2.id}`);
    await page.waitForTimeout(1200);
    await page.click(`#follow-batch-${batches.S2.id}`);
    await page.waitForTimeout(1200);
    record('UI: toggle S2 ON then OFF', (await page.locator(`#follow-batch-${batches.S2.id}`).getAttribute('aria-checked')) === 'false');
    await page.locator('#notifications-panel button[title="رجوع"]').click();
    await page.waitForTimeout(2500);
    record('UI: master admin alert from followed S1 only', (await page.locator(`#admin-alert-${acc.m1.id}`).count()) === 1 && (await page.locator(`#admin-alert-${acc.mB.id}`).count()) === 0);
    record('UI: grouped card with two lines', (await page.locator(`#admin-alert-${acc.m1.id} .alert-issue`).count()) === 2);
    await page.reload();
    await page.waitForSelector('#notifications-button');
    await page.waitForTimeout(2500);
    await page.click('#notifications-button');
    await page.click('#notification-settings-btn');
    record('UI: preferences persist after refresh (S1 ON, S2 OFF)', (await page.locator(`#follow-batch-${batches.S1.id}`).getAttribute('aria-checked')) === 'true' && (await page.locator(`#follow-batch-${batches.S2.id}`).getAttribute('aria-checked')) === 'false');
    record('UI: master admin — no console errors or failed Sisters requests', problems.length === 0, problems.join(' | '));
    await context.close();

    // Batch admin: dashboard of her batch, distant-review section (the second bug report).
    ({ page, context, problems } = await login(acc.adminA));
    await page.getByRole('button', { name: /الإعدادات/ }).first().click();
    await page.waitForSelector('#distant-review-section', { timeout: 15000 });
    record('UI: admin dashboard loads the distant-review section (no missing-table error)', !(await page.locator('body').innerText()).includes('schema cache') && (await page.locator(`#distant-review-item-${addDays(TODAY, -2)}`).count()) === 1);
    const date = addDays(TODAY, 5);
    await page.fill('#distant-review-date', date);
    await page.click('#distant-from-button');
    await page.fill('#distant-from-search', '1');
    await page.click('#distant-from-option-1');
    await page.click('#distant-to-button');
    await page.fill('#distant-to-search', '9');
    record('UI: quarter option shows the page number', (await page.locator('#distant-to-option-9').innerText()).includes('الصفحة 22'));
    await page.click('#distant-to-option-9');
    record('UI: preview stops at the beginning of quarter 9', (await page.locator('#distant-review-preview').innerText()).includes('توقفي عند:'));
    await page.click('#add-distant-review-btn');
    await page.waitForSelector(`#distant-review-item-${date}`, { timeout: 15000 });
    record('UI: distant-review day created through admin-actions', true);
    await page.click(`#delete-distant-${date}`);
    await page.click(`#confirm-delete-distant-${date}`);
    await page.waitForTimeout(2500);
    record('UI: future day deleted', (await page.locator(`#distant-review-item-${date}`).count()) === 0);
    // X / «المستبعدة» / restore on production.
    await page.click('#notifications-button');
    await page.click(`#dismiss-alert-${acc.m1.id}`);
    await page.waitForTimeout(1500);
    record('UI: X dismisses the grouped card', (await page.locator(`#admin-alert-${acc.m1.id}`).count()) === 0);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector('#notifications-button');
    await page.waitForTimeout(2500);
    await page.click('#notifications-button');
    record('UI: dismissal persists after refresh', (await page.locator(`#admin-alert-${acc.m1.id}`).count()) === 0);
    await page.click('#notifications-view-all');
    await page.click('#notifications-tab-dismissed');
    record('UI: «المستبعدة» lists it (still serious)', (await page.locator(`#dismissed-alert-${acc.m1.id}`).innerText()).includes('التأخر الشديد ما زال قائمًا'));
    await page.click(`#restore-alert-${acc.m1.id}`);
    await page.waitForTimeout(1500);
    await page.click('#notifications-tab-current');
    record('UI: restore brings the card back', (await page.locator(`#notifications-current #admin-alert-${acc.m1.id}`).count()) === 1);
    record('UI: batch admin — no console errors or failed Sisters requests', problems.length === 0, problems.join(' | '));
    await context.close();

    // Member: red urgent bell (3 overdue Tasmi'a), distant-review card/history, archive persistence.
    ({ page, context, problems } = await login(acc.m1));
    record('UI: member — whole control red for the 3-day Tasmi\'a debt', (await page.locator('#notifications-button').getAttribute('data-urgent')) === 'true');
    await page.click('#notifications-button');
    record('UI: member — serious Tasmi\'a warning', (await page.locator('#notification-tasmia-overdue').getAttribute('data-tone')) === 'serious');
    await page.click('#notification-tasmia-overdue');
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForSelector('#notifications-button');
    await page.waitForTimeout(2500);
    // m1 has two serious warnings: the clicked one is read, the other still counts (badge 1).
    record('UI: clicked 3+ warning read (badge 2 → 1) and the control still red', (await page.locator('#notifications-badge').innerText()).trim() === '1' && (await page.locator('#notifications-button').getAttribute('data-urgent')) === 'true');
    await page.click('#notifications-button');
    record('UI: the 3+ warning stays in the active list after click and refresh', (await page.locator('#notification-tasmia-overdue').count()) === 1);
    await page.keyboard.press('Escape');
    await page.locator('#history-tab-distant').click();
    record('UI: member history shows the completed distant review (late)', (await page.locator(`#distant-history-${addDays(TODAY, -2)}`).innerText()).includes('تم الإنجاز (متأخرًا)'));
    record('UI: member — no console errors or failed Sisters requests', problems.length === 0, problems.join(' | '));
    await context.close();
  } catch (e: any) {
    record('browser phase completed', false, e.stack || String(e));
  } finally {
    await browser.close();
  }
}

async function cleanup() {
  const ids = Object.values(acc).map((a) => a.id);
  const cycles = Object.values(batches).map((b) => b.cycle);
  const bids = Object.values(batches).map((b) => b.id);
  const steps: [string, () => PromiseLike<any>][] = [
    ['distant', () => service.from('distant_review_assignments').delete().in('batch_id', bids.length ? bids : ['00000000-0000-0000-0000-000000000000'])],
    ['tasmia', () => service.from('tasmia_submissions').delete().in('cycle_id', cycles)],
    ['reviews', () => service.from('review_confirmations').delete().in('cycle_id', cycles)],
    ['rest', () => service.from('group_rest_days').delete().in('cycle_id', cycles)],
    ['pauses', () => service.from('program_pauses').delete().in('cycle_id', cycles)],
    ['memberships', () => service.from('batch_memberships').delete().in('batch_id', bids)],
    ['cycles', () => service.from('cycles').delete().in('id', cycles)],
    ['batches', () => service.from('batches').delete().in('id', bids)],
  ];
  for (const [n, f] of steps) {
    const r = await f();
    if (r.error) console.log(`cleanup ${n}: ${r.error.message}`);
  }
  for (const id of ids) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) console.log(`cleanup user: ${error.message}`);
  }
  const left = await service.from('profiles').select('id').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const leftB = await service.from('batches').select('id').like('name', `SMOKE %${tag}`);
  record('cleanup: no temporary account or batch left', (left.data || []).length === 0 && (leftB.data || []).length === 0);
}

try {
  await api();
  await browserPhase();
} catch (e: any) {
  record('smoke run completed', false, e.stack || String(e));
} finally {
  await cleanup();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
