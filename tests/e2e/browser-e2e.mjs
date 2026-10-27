// Browser end-to-end test of the REAL Sisters app (Vite dev server, tests/e2e/vite.config.ts) with the
// in-memory Supabase stand-in (tests/e2e/fakeSupabase.ts) and a faked clock (Africa/Cairo instants).
// Covers the three ported features from the user's point of view: notifications (member, batch admin,
// master admin), the 05:00 Cairo program day (including an app left open across 05:00) and
// «المراجعة البعيدة» (admin creation with searchable quarter pickers, member card, debt, history).
//
//   npx vite --config tests/e2e/vite.config.ts --port 4174 --strictPort      (separate terminal)
//   PLAYWRIGHT_PATH=<playwright package dir> node tests/e2e/browser-e2e.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const APP = process.env.APP_URL || 'http://localhost:4174/';

const results = [];
const record = (check, ok, detail = '') => {
  results.push({ check, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${detail ? `  — ${detail}` : ''}`);
};

// ------------------------------------------------------------------ dates (Cairo, 2026-10-28 is UTC+3)
const cairo = (date, time, offset = 3) => new Date(Date.parse(`${date}T${time}Z`) - offset * 3600_000);
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const START = '2026-10-20';

// ------------------------------------------------------------------ world
const ids = {
  master: 'u-master', adminA: 'u-admin-a', adminB: 'u-admin-b',
  m1: 'u-m1', m2: 'u-m2', m3: 'u-m3', mB: 'u-mb',
  batchA: 'b-a', batchB: 'b-b', cycleA: 'c-a', cycleB: 'c-b',
};
function world({ userId, distant = [], rest = [], tasmia = {}, reviews = {}, completions = [] }) {
  const p = (id, full_name, phone, role, is_master_admin = false) => ({
    id, full_name, phone, role, active: true, created_at: '2026-10-01T00:00:00Z', deactivated_at: null, is_master_admin,
  });
  const tables = {
    profiles: [
      p(ids.master, 'المشرفة العامة', '01000000001', 'admin', true),
      p(ids.adminA, 'مشرفة الدفعة أ', '01000000002', 'admin'),
      p(ids.adminB, 'مشرفة الدفعة ب', '01000000003', 'admin'),
      p(ids.m1, 'عائشة محمد', '01012345678', 'member'),
      p(ids.m2, 'مريم أحمد', '01022222222', 'member'),
      p(ids.m3, 'خديجة علي', '01033333333', 'member'),
      p(ids.mB, 'سارة من ب', '01044444444', 'member'),
    ],
    batches: [
      { id: ids.batchA, name: 'الدفعة أ', created_at: '2026-10-01T00:00:00Z', archived_at: null },
      { id: ids.batchB, name: 'الدفعة ب', created_at: '2026-10-02T00:00:00Z', archived_at: null },
    ],
    cycles: [
      { id: ids.cycleA, batch_id: ids.batchA, cycle_number: 1, name: null, starts_on: START, status: 'active', ended_on: null, created_by: null, created_at: '2026-10-01T00:00:00Z' },
      { id: ids.cycleB, batch_id: ids.batchB, cycle_number: 1, name: null, starts_on: START, status: 'active', ended_on: null, created_by: null, created_at: '2026-10-01T00:00:00Z' },
    ],
    batch_memberships: [
      ['adminA', 'batchA', 'admin'], ['adminB', 'batchB', 'admin'],
      ['m1', 'batchA', 'member'], ['m2', 'batchA', 'member'], ['m3', 'batchA', 'member'], ['mB', 'batchB', 'member'],
    ].map(([u, b, role]) => ({ id: `bm-${u}`, batch_id: ids[b], user_id: ids[u], membership_role: role, joined_at: '2026-10-19T09:00:00Z', created_at: '2026-10-19T09:00:00Z' })),
    tasmia_submissions: [],
    review_confirmations: [],
    group_rest_days: rest.map((d) => ({ id: `r-${d}`, cycle_id: ids.cycleA, rest_date: d, reason: 'يوم استدراك', created_by: ids.adminA, created_at: '2026-10-01T00:00:00Z' })),
    program_pauses: [],
    daily_thoughts: [],
    peer_tests: [],
    peer_test_attempts: [],
    distant_review_assignments: distant.map(([date, s, e, note]) => ({
      id: `d-${date}`, batch_id: ids.batchA, cycle_id: ids.cycleA, review_date: date, start_quarter: s, end_quarter: e, note: note ?? null,
      created_by_name_snapshot: 'مشرفة الدفعة أ', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    })),
    distant_review_completions: completions,
    notification_states: [],
    admin_notification_batch_subscriptions: [],
  };
  for (const [member, quarters] of Object.entries(tasmia)) {
    const cycle = member === 'mB' ? ids.cycleB : ids.cycleA;
    for (const q of quarters)
      tables.tasmia_submissions.push({ id: `t-${member}-${q}`, cycle_id: cycle, user_id: ids[member], listener_id: ids.m2, listener_name_snapshot: 'مريم أحمد', listener_changed_at: null, quarter_number: q, notes: null, submitted_at: '2026-10-20T08:00:00Z' });
  }
  for (const [member, days] of Object.entries(reviews)) {
    const cycle = member === 'mB' ? ids.cycleB : ids.cycleA;
    for (const d of days)
      tables.review_confirmations.push({ id: `v-${member}-${d}`, cycle_id: cycle, user_id: ids[member], program_day: d, start_quarter: Math.max(1, d - 7), end_quarter: d, confirmed_at: '2026-10-20T08:00:00Z' });
  }
  return { userId, tables };
}

// ------------------------------------------------------------------ browser helpers
const browser = await chromium.launch();
async function open(instant, w, { keepStorage } = {}) {
  const context = await browser.newContext({ locale: 'ar-EG', viewport: { width: 1280, height: 900 }, timezoneId: 'Europe/London' });
  const page = await context.newPage();
  page.on('pageerror', (e) => record('no page error', false, e.message));
  await page.clock.install({ time: instant });
  await page.addInitScript(([wd, keep]) => {
    window.__E2E_WORLD__ = wd;
    if (!keep && !sessionStorage.getItem('e2e.init')) {
      localStorage.clear();
      sessionStorage.setItem('e2e.init', '1');
    }
  }, [w, !!keepStorage]);
  await page.goto(APP);
  await page.waitForSelector('#notifications-button', { timeout: 20000 });
  await page.waitForTimeout(400);
  return { page, context };
}
const badge = async (page) => ((await page.locator('#notifications-badge').count()) ? (await page.locator('#notifications-badge').innerText()).trim() : '0');
const urgent = async (page) => (await page.locator('#notifications-button').getAttribute('data-urgent')) === 'true';
const openPanel = async (page) => {
  if (!(await page.locator('#notifications-panel').count())) await page.click('#notifications-button');
  await page.waitForSelector('#notifications-panel');
};
const closePanel = async (page) => {
  if (await page.locator('#notifications-panel').count()) await page.keyboard.press('Escape');
};
// SCREENSHOT_DIR=<dir>: save a few screenshots for a visual check.
const shot = async (page, name) => process.env.SCREENSHOT_DIR && page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png` });
const inViewport = (page, sel) =>
  page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });

try {
  // ================================================================== MEMBER: severities, badge, red, archive, deep links
  // Program days 20..28 Oct except the distant-review day 26 → 8 days (quarter 8 is today's).
  // Tasmi'a 1-4 and 8: quarters 5,6,7 overdue (3 → serious). Reviews: day 5 (24 Oct) missed (1 → light).
  // Distant review of 26 Oct missed (its own debt). Rest day tomorrow (29 Oct).
  const NOON = cairo('2026-10-28', '12:00:00');
  const memberWorld = world({
    userId: ids.m1,
    distant: [['2026-10-26', 3, 9, 'ركّزي على المتشابهات']],
    rest: ['2026-10-29'],
    tasmia: { m1: [1, 2, 3, 4, 8], m2: [1, 2, 3, 4, 5, 6, 7], m3: [1, 2, 3, 4, 5, 6] },
    reviews: { m1: [1, 2, 3, 4, 6, 7], m2: [1, 2, 3, 4, 5, 6, 7], m3: [1, 2, 3, 4, 5, 6, 7] },
  });
  let { page, context } = await open(NOON, memberWorld);
  record('member: bell visible', await page.locator('#notifications-button').isVisible());
  record('member: badge counts 4 unread (Tasmi\'a, review, distant, tomorrow\'s rest day)', (await badge(page)) === '4', await badge(page));
  record('urgent: whole control red while a 3+ condition exists', (await urgent(page)) && /bg-rose-600/.test(await page.locator('#notifications-button').getAttribute('class')));
  record('urgent: exclamation bell treatment shown', await page.locator('#notifications-urgent-icon').isVisible());
  await shot(page, 'member-header-urgent');
  const bell = await page.locator('#notifications-bell').boundingBox();
  const b = await page.locator('#notifications-badge').boundingBox();
  record(
    'badge sits on the top-right of the bell icon (not the outer button)',
    b.x + b.width / 2 > bell.x + bell.width / 2 && b.y + b.height / 2 < bell.y + bell.height / 2 && b.x < bell.x + bell.width + 14,
    JSON.stringify({ bell, badge: b })
  );
  await openPanel(page);
  const tone = (kind) => page.locator(`#notification-${kind}`).getAttribute('data-tone');
  record('member: Tasmi\'a 3+ → serious (red)', (await tone('tasmia-overdue')) === 'serious' && /bg-rose-50/.test(await page.locator('#notification-tasmia-overdue').getAttribute('class')));
  record('member: review 1 day → light (yellow)', (await tone('revision-overdue')) === 'light' && /bg-amber-50/.test(await page.locator('#notification-revision-overdue').getAttribute('class')));
  record('member: Tasmi\'a and Muraja\'a are separate notifications', (await page.locator('#notification-tasmia-overdue').count()) === 1 && (await page.locator('#notification-revision-overdue').count()) === 1);
  const tasmiaText = await page.locator('#notification-tasmia-overdue').innerText();
  record('feminine wording: serious warning', tasmiaText.includes('تنبيه شديد: لديكِ 3 أيام متأخرة في التسميع') && tasmiaText.includes('أنتِ تقتربين من حد الاستبعاد') && tasmiaText.includes('معرضة للاستبعاد'), tasmiaText);
  record('feminine wording: light review warning', (await page.locator('#notification-revision-overdue').innerText()).includes('لديكِ يوم مراجعة متأخر'));
  const distantText = await page.locator('#notification-distant-overdue').innerText();
  record('distant review: overdue notification separate from the review debt', distantText.includes('لديكِ مراجعة بعيدة متأخرة') && distantText.includes('مستقلة عن ورد المراجعة اليومي'), distantText);
  const restT = await page.locator('#notification-rest-tomorrow').innerText();
  record('rest day: tomorrow\'s non-urgent notice', restT.includes('غدًا يوم راحة') && (await page.locator('#notification-rest-tomorrow').getAttribute('data-urgent')) === 'false', restT);
  await page.waitForTimeout(150);
  await shot(page, 'member-panel');
  record('opening the panel: non-urgent become seen, urgent stays unread (badge 4 → 1)', (await badge(page)) === '1', await badge(page));
  record('opening the panel archives nothing', (await page.locator('#notifications-panel [id^="notification-"]').count()) === 4);
  await closePanel(page);
  await openPanel(page);
  record('re-opening keeps the urgent one unread', (await badge(page)) === '1');

  // Deep link: review → the exact overdue day.
  await page.click('#notification-revision-overdue');
  await page.waitForTimeout(700);
  const revTitle = await page.locator('#revision-card h3').first().innerText();
  record('deep link: review notification opens the overdue review day (24 Oct)', revTitle.includes('مراجعة متأخرة') && revTitle.includes('24'), revTitle);
  record('deep link: review card scrolled into view and highlighted', (await inViewport(page, '#revision-card')) && /notification-focus/.test(await page.locator('#revision-card').getAttribute('class')));
  record('click archives: panel closed', (await page.locator('#notifications-panel').count()) === 0);
  await openPanel(page);
  record('click archives: removed from the active list', (await page.locator('#notification-revision-overdue').count()) === 0);
  // Deep link: Tasmi'a → the Tasmi'a card; urgent archived → badge 0 but still red.
  await page.click('#notification-tasmia-overdue');
  await page.waitForTimeout(700);
  record('deep link: Tasmi\'a notification opens the Tasmi\'a card (overdue quarter 5)', (await inViewport(page, '#tasmia-card')) && (await page.locator('#tasmia-card').innerText()).includes('الربع رقم 5'));
  record('badge and urgency are independent: archived urgent → badge 0, control still red', (await badge(page)) === '0' && (await urgent(page)));
  // Deep link: distant → the distant-review card of 26 Oct.
  await openPanel(page);
  await page.click('#notification-distant-overdue');
  await page.waitForTimeout(700);
  const card = await page.locator('#distant-review-card').innerText();
  await shot(page, 'member-distant-card');
  record('deep link: distant notification opens the 26 Oct distant-review card', card.includes('مراجعة بعيدة متأخرة') && card.includes('26'), card.slice(0, 120));
  record('member card: range «من بداية الربع 3» → «حتى بداية الربع 9», stop at beginning of 9', (await page.locator('#distant-review-from').innerText()) === '3' && (await page.locator('#distant-review-to').innerText()) === '9' && card.includes('توقفي عند:') && card.includes('بداية الربع 9'));
  record('member card: admin note shown (feminine label)', card.includes('ملاحظة المشرفة:') && card.includes('ركّزي على المتشابهات'));

  // View all: history with archived entries, date/time, type.
  await openPanel(page);
  await page.click('#notifications-view-all');
  await page.waitForSelector('#notifications-history');
  const hist = await page.locator('#notifications-archive').innerText();
  record('«عرض كل التنبيهات»: archived notifications with type and time', (await page.locator('.archived-notification').count()) === 3 && hist.includes('فُتح في') && hist.includes('تسميع متأخر') && hist.includes('الحالة ما زالت قائمة'), hist.slice(0, 200));
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);

  // Persistence across reload; distant completion; red disappears only when the 3+ condition ends.
  await page.reload();
  await page.waitForSelector('#notifications-button');
  await page.waitForTimeout(400);
  record('interaction state survives a reload (badge 0, still red)', (await badge(page)) === '0' && (await urgent(page)));
  await page.click('#complete-distant-review-btn');
  await page.waitForTimeout(600);
  await page.locator('#history-tab-distant').click();
  const dh = await page.locator('#distant-history-2026-10-26').innerText();
  record('distant completion: late completion recorded in her history', dh.includes('تم الإنجاز (متأخرًا)') && dh.includes('من بداية الربع 3 حتى بداية الربع 9'), dh);
  await openPanel(page);
  record('distant debt gone after completion (no distant-overdue notification)', (await page.locator('#notification-distant-overdue').count()) === 0);
  await closePanel(page);
  await page.evaluate(() => {
    const t = window.__e2e.world.tables.tasmia_submissions;
    t.push({ id: 't-extra-5', cycle_id: 'c-a', user_id: 'u-m1', listener_id: 'u-m2', listener_name_snapshot: 'مريم أحمد', listener_changed_at: null, quarter_number: 5, notes: null, submitted_at: new Date().toISOString() });
    window.__e2e.save();
  });
  record('still red while 3 days are overdue', await urgent(page));
  await page.reload();
  await page.waitForSelector('#notifications-button');
  await page.waitForTimeout(400);
  record('red state disappears when the condition drops to 2 overdue (after refresh)', !(await urgent(page)));
  await openPanel(page);
  record('2 overdue days → stronger (orange) warning, new unread notification', (await tone('tasmia-overdue')) === 'strong' && /bg-orange-50/.test(await page.locator('#notification-tasmia-overdue').getAttribute('class')));
  await context.close();

  // ================================================================== 05:00 CAIRO: app open across the boundary
  // Up to 27 Oct (program days 1..8) all done; 28 Oct is a distant-review day. At 04:59:30 it is still
  // the 27th: nothing overdue, tomorrow's distant review announced. After 05:00 (no reload): the 28th.
  ({ page, context } = await open(cairo('2026-10-28', '04:59:30'), world({
    userId: ids.m1,
    distant: [['2026-10-28', 1, 9, 'مراجعة الجزء الأول']],
    tasmia: { m1: [1, 2, 3, 4, 5, 6, 7] },
    reviews: { m1: [1, 2, 3, 4, 5, 6, 7] },
  })));
  const hero = async () => page.locator('#day-overview').innerText();
  await openPanel(page);
  record('04:59 Cairo: previous program day (quarter 8 is today\'s, nothing overdue)', (await page.locator('#notification-tasmia-overdue').count()) === 0 && (await hero()).includes('8'));
  record('04:59 Cairo: tomorrow\'s distant review announced (non-urgent)', (await page.locator('#notification-distant-tomorrow').count()) === 1 && !(await urgent(page)));
  await closePanel(page);
  record('04:59 Cairo: no distant-review banner yet', (await page.locator('#distant-review-banner').count()) === 0);
  await page.clock.runFor(45_000);
  await page.waitForTimeout(800);
  await openPanel(page);
  record('05:00 Cairo (app left open): distant-review day becomes active without reload', (await page.locator('#distant-review-banner').count()) === 1 && (await page.locator('#notification-distant-day').count()) === 1);
  record("distant-review day: no new quarter — quarter 8 stays the current Tasmi'a (catch-up), not overdue", (await page.locator('#notification-tasmia-overdue').count()) === 0 && (await page.locator('#tasmia-card').innerText()).includes('8'));
  record('05:00 Cairo: review of the 27th becomes overdue at 05:00', (await page.locator('#notification-revision-overdue').count()) === 1);
  const dayNote = await page.locator('#notification-distant-day').innerText();
  record('distant-review day: range and admin note in the notification', dayNote.includes('من بداية الربع 1 حتى بداية الربع 9') && dayNote.includes('مراجعة الجزء الأول'), dayNote);
  await closePanel(page);
  record('distant-review day: normal progression paused (Tasmi\'a card shows catch-up wording)', (await page.locator('#tasmia-card').innerText()).includes('استدراك'));
  await context.close();

  // Normal day at 05:00: the 27th's unrecited quarter becomes overdue exactly at 05:00, the new quarter 9 appears.
  ({ page, context } = await open(cairo('2026-10-28', '04:59:30'), world({ userId: ids.m1, tasmia: { m1: [1, 2, 3, 4, 5, 6, 7] }, reviews: { m1: [1, 2, 3, 4, 5, 6, 7, 8] } })));
  const heroBefore = await hero();
  await openPanel(page);
  record("04:59:30 Cairo: quarter 8 is still today's (no Tasmi'a warning, no badge)", (await page.locator('#notification-tasmia-overdue').count()) === 0 && (await badge(page)) === '0');
  await closePanel(page);
  await page.clock.runFor(45_000);
  await page.waitForTimeout(800);
  record("05:00 Cairo (app left open): new Tasmi'a quarter 9 appears (program day 9)", /اليوم رقم 9/.test(await hero()) && /اليوم رقم 8/.test(heroBefore));
  await openPanel(page);
  record('05:00 Cairo: quarter 8 becomes overdue at 05:00 (not midnight) → light warning', (await page.locator('#notification-tasmia-overdue').count()) === 1 && (await tone('tasmia-overdue')) === 'light');
  record('05:00 Cairo: new review range of the 28th is due, not overdue', (await page.locator('#notification-revision-overdue').count()) === 0);
  await context.close();

  // Rest day at 05:00.
  ({ page, context } = await open(cairo('2026-10-28', '04:59:30'), world({ userId: ids.m1, rest: ['2026-10-28'], tasmia: { m1: [1, 2, 3, 4, 5, 6, 7, 8] }, reviews: { m1: [1, 2, 3, 4, 5, 6, 7, 8] } })));
  record('04:59 Cairo: rest day of the 28th not active yet', (await page.locator('#rest-day-banner').count()) === 0);
  await page.clock.runFor(45_000);
  await page.waitForTimeout(800);
  record('05:00 Cairo: rest day of the 28th active without reload', (await page.locator('#rest-day-banner').count()) === 1);
  await openPanel(page);
  record('rest day today: non-urgent informational notification', (await page.locator('#notification-rest-day').count()) === 1 && (await page.locator('#notification-rest-day').getAttribute('data-urgent')) === 'false');
  await page.click('#notification-rest-day');
  await page.waitForTimeout(600);
  record('deep link: rest-day notification opens the rest-day banner', /notification-focus/.test(await page.locator('#rest-day-banner').getAttribute('class')));
  await context.close();

  // ================================================================== BATCH ADMIN: serious alerts, scope, deep link
  const adminWorld = (userId) => world({
    userId,
    tasmia: { m1: [1, 2, 3, 4, 8, 9], m2: [1, 2, 3, 4, 5, 6, 9], m3: [1, 2, 3, 4, 5, 6, 7, 9], mB: [1, 2, 3, 4, 5, 9] },
    reviews: { m1: [1, 2, 3, 4, 5, 6, 7, 8], m2: [1, 2, 3, 4, 5, 6, 7, 8], m3: [1, 2, 3, 4, 5, 6, 7, 8], mB: [1, 2, 3, 4, 5, 6, 7, 8] },
  });
  ({ page, context } = await open(NOON, adminWorld(ids.adminA)));
  await openPanel(page);
  const alerts = page.locator('[id^="admin-alert-"]');
  record('batch admin: only the 3+ member alerts (1 and 2 missed days give none)', (await alerts.count()) === 1 && (await page.locator(`#admin-alert-${ids.m1}-tasmia`).count()) === 1);
  await shot(page, 'batch-admin-panel');
  const alertText = await page.locator(`#admin-alert-${ids.m1}-tasmia`).innerText();
  record('batch admin: alert shows name, phone, batch, category and count', ['عائشة محمد', '01012345678', 'الدفعة أ', '3 أيام متأخرة في التسميع'].every((s) => alertText.includes(s)), alertText);
  record('batch admin: other batch (ب, 4 missed) not visible', (await page.locator(`#admin-alert-${ids.mB}-tasmia`).count()) === 0);
  record('batch admin: no batch-follow settings', (await page.locator('#notification-settings-btn').count()) === 0);
  record('batch admin: serious styling and urgent red control', (await urgent(page)) && (await page.locator(`#admin-alert-${ids.m1}-tasmia`).getAttribute('data-tone')) === 'serious');
  await page.locator(`#admin-alert-${ids.m1}-tasmia`).getByText('إدارة العضوة').click();
  await page.waitForTimeout(900);
  record('deep link: «إدارة الأعضاء» opens with the exact member focused', (await inViewport(page, `#member-row-${ids.m1}`)) && /notification-focus-row/.test(await page.locator(`#member-row-${ids.m1}`).getAttribute('class')));
  await context.close();

  // ================================================================== MASTER ADMIN: followed batches
  ({ page, context } = await open(NOON, adminWorld(ids.master)));
  await openPanel(page);
  record('master admin: bell visible; follows nothing yet', (await page.locator('#notifications-empty').innerText()).includes('لا تتابعين أي دفعة بعد'));
  await page.click('#notification-settings-btn');
  await page.click(`#follow-batch-${ids.batchA}`);
  await page.waitForTimeout(200);
  await page.click(`#follow-batch-${ids.batchB}`);
  await page.waitForTimeout(300);
  await page.locator('#notifications-panel button[title="رجوع"]').click();
  await page.waitForTimeout(500);
  record('master admin: alerts from both followed batches', (await page.locator(`#admin-alert-${ids.m1}-tasmia`).count()) === 1 && (await page.locator(`#admin-alert-${ids.mB}-tasmia`).count()) === 1);
  await page.click('#notification-settings-btn');
  await page.click(`#follow-batch-${ids.batchB}`);
  await page.waitForTimeout(300);
  await page.locator('#notifications-panel button[title="رجوع"]').click();
  await page.waitForTimeout(500);
  record('master admin: unfollowed batch hidden (ب OFF)', (await page.locator(`#admin-alert-${ids.mB}-tasmia`).count()) === 0 && (await page.locator(`#admin-alert-${ids.m1}-tasmia`).count()) === 1);
  await page.reload();
  await page.waitForSelector('#notifications-button');
  await page.waitForTimeout(600);
  await openPanel(page);
  await page.click('#notification-settings-btn');
  await shot(page, 'master-follow-settings');
  record('master admin: follow choices persist across reload (أ ON, ب OFF)',
    (await page.locator(`#follow-batch-${ids.batchA}`).getAttribute('aria-checked')) === 'true' && (await page.locator(`#follow-batch-${ids.batchB}`).getAttribute('aria-checked')) === 'false');
  await context.close();

  // ================================================================== DISTANT REVIEW: admin creation UI
  ({ page, context } = await open(NOON, world({ userId: ids.adminA, rest: ['2026-11-03'], distant: [['2026-10-26', 3, 9]] })));
  await page.getByRole('button', { name: /الإعدادات/ }).first().click();
  await page.waitForSelector('#distant-review-section');
  const order = await page.evaluate(() => {
    const s = document.getElementById('distant-review-section');
    const all = [...document.querySelectorAll('h3')].map((h) => h.textContent || '');
    return { idx: all.findIndex((t) => t.includes('المراجعة البعيدة')), pause: all.findIndex((t) => /إيقاف|الإيقاف/.test(t)), rest: all.findIndex((t) => /الاستدراك|الراحة/.test(t)), ok: !!s };
  });
  record('admin: «المراجعة البعيدة» between program pause and rest days', order.ok && order.pause < order.idx && order.idx < order.rest, JSON.stringify(order));
  await page.fill('#distant-review-date', '2026-11-02');
  await page.click('#distant-from-button');
  await page.fill('#distant-from-search', '9');
  const firstOpt = await page.locator('#distant-from-list li').first().innerText();
  record('FROM selector: search by quarter number; metadata Juz • Hizb • Page • Ayah', firstOpt.includes('الربع 9') && firstOpt.includes('الجزء 2') && firstOpt.includes('الحزب 3') && firstOpt.includes('الصفحة 22') && firstOpt.includes('الآية 142'), firstOpt);
  await page.fill('#distant-from-search', 'البقرة');
  record('FROM selector: search by surah name', (await page.locator('#distant-from-list li').count()) > 5);
  await page.fill('#distant-from-search', '1');
  await page.click('#distant-from-option-1');
  await page.click('#distant-to-button');
  record('TO selector covers quarters up to 240', (await page.locator('#distant-to-option-240').count()) === 1);
  await page.fill('#distant-to-search', '9');
  await page.click('#distant-to-option-9');
  await shot(page, 'admin-distant-form');
  const preview = await page.locator('#distant-review-preview').innerText();
  record('preview: TO is the stopping boundary (stop at the BEGINNING of quarter 9, 8 quarters)', preview.includes('من بداية الربع 1 حتى بداية الربع 9') && preview.includes('توقفي عند:') && preview.includes('بداية الربع 9') && preview.includes('8'), preview);
  const labels = await page.locator('#distant-review-form label').allInnerTexts();
  record('FROM/TO labels not duplicated («من الربع» / «إلى الربع» once)', labels.filter((l) => /من\s*الربع/.test(l)).length === 1 && labels.filter((l) => /إلى\s*الربع/.test(l)).length === 1 && !labels.some((l) => /من\s*من|إلى\s*إلى/.test(l)), JSON.stringify(labels));
  await page.fill('#distant-review-note', 'قبل الاختبار');
  await page.click('#add-distant-review-btn');
  await page.waitForTimeout(700);
  record('admin: create one future distant-review day', (await page.locator('#distant-review-item-2026-11-02').count()) === 1 && (await page.locator('#distant-review-item-2026-11-02').innerText()).includes('قادم'));
  await page.click('#edit-distant-2026-11-02');
  await page.click('#distant-to-button');
  await page.fill('#distant-to-search', '12');
  await page.click('#distant-to-option-12');
  await page.click('#add-distant-review-btn');
  await page.waitForTimeout(700);
  record('admin: edit a future day', (await page.locator('#distant-review-item-2026-11-02').innerText()).includes('حتى بداية الربع 12'));
  await page.click('#delete-distant-2026-11-02');
  await page.click('#confirm-delete-distant-2026-11-02');
  await page.waitForTimeout(700);
  record('admin: delete a future day (feminine confirm)', (await page.locator('#distant-review-item-2026-11-02').count()) === 0);
  const pastItem = await page.locator('#distant-review-item-2026-10-26').innerText();
  record('admin: past day kept as history, view-only, with completion statistics', pastItem.includes('عرض فقط') && pastItem.includes('أتممن المراجعة') && (await page.locator('#edit-distant-2026-10-26').count()) === 0, pastItem);
  await page.fill('#distant-review-date', '2026-11-03');
  await page.click('#distant-from-button');
  await page.click('#distant-from-option-2');
  await page.click('#distant-to-button');
  await page.click('#distant-to-option-5');
  await page.click('#add-distant-review-btn');
  await page.waitForTimeout(400);
  record('rest-day conflict refused (same date cannot be both)', (await page.locator('#distant-review-error').innerText()).includes('يوم استدراك وراحة'));
  await context.close();

  // Members cannot manage distant reviews.
  ({ page, context } = await open(NOON, world({ userId: ids.m2 })));
  record('member: no admin distant-review management', (await page.locator('#distant-review-section').count()) === 0 && (await page.locator('#distant-review-form').count()) === 0);
  await context.close();
} catch (e) {
  record('E2E run completed', false, e.stack || String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
