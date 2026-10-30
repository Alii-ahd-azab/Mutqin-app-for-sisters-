// Browser E2E only: an in-memory stand-in for the Supabase client, swapped in for src/lib/supabase.ts
// by tests/e2e/vite.config.ts. The REAL app (components, API client, shared calculations) runs on
// top of it; the database rules themselves (RLS, RPCs, guards) are covered by tests/db.test.ts.
//
// The world (tables + signed-in user) comes from window.__E2E_WORLD__ (set by the test before the
// page loads). Writes are kept in localStorage, so they survive a page reload like server rows do.
// Minimal batch scoping mirrors RLS: a batch admin reads only her batches, a member only her own.

type Row = Record<string, any>;
type World = { userId: string | null; tables: Record<string, Row[]>; today?: string };

const STORE = 'e2e.world';
const w = window as any;

function load(): World {
  try {
    const saved = window.localStorage.getItem(STORE);
    if (saved) return JSON.parse(saved);
  } catch {
    // no storage: start from the injected world
  }
  return JSON.parse(JSON.stringify(w.__E2E_WORLD__ || { userId: null, tables: {} }));
}
const world: World = load();
const save = () => window.localStorage.setItem(STORE, JSON.stringify(world));
w.__e2e = { world, save };
const table = (name: string) => (world.tables[name] ||= []);
const uid = () => world.userId;
const profile = (id: string | null) => table('profiles').find((p) => p.id === id);
const isMaster = () => !!profile(uid())?.is_master_admin && profile(uid())?.role === 'admin';
const newId = () => crypto.randomUUID();
const err = (message: string, code = 'P0001') => ({ data: null, error: { message, code } });

function managedBatchIds(): Set<string> {
  const p = profile(uid());
  if (!p) return new Set();
  if (isMaster()) return new Set(table('batches').map((b) => b.id));
  if (p.role === 'admin') return new Set(table('batch_memberships').filter((m) => m.user_id === p.id && m.membership_role === 'admin').map((m) => m.batch_id));
  return new Set(table('batch_memberships').filter((m) => m.user_id === p.id && m.membership_role === 'member').map((m) => m.batch_id));
}
const cycleBatch = (cycleId: string) => table('cycles').find((c) => c.id === cycleId)?.batch_id;

/** Row-level visibility (a subset of the Sisters policies, enough for the UI paths under test). */
function visible(name: string, r: Row): boolean {
  const me = uid();
  const batches = managedBatchIds();
  switch (name) {
    case 'batches':
      return batches.has(r.id);
    case 'cycles':
    case 'daily_thoughts':
    case 'distant_review_assignments':
      return batches.has(r.batch_id);
    case 'group_rest_days':
    case 'program_pauses':
    case 'tasmia_submissions':
    case 'review_confirmations':
    case 'peer_tests':
      return batches.has(cycleBatch(r.cycle_id));
    case 'batch_memberships':
      return batches.has(r.batch_id);
    case 'distant_review_completions': {
      const a = table('distant_review_assignments').find((x) => x.id === r.assignment_id);
      return r.user_id === me || (profile(me)?.role === 'admin' && !!a && batches.has(a.batch_id));
    }
    case 'notification_states':
      return r.user_id === me;
    case 'admin_notification_batch_subscriptions':
      return r.admin_user_id === me && isMaster();
    case 'admin_alert_dismissals':
      return r.admin_user_id === me;
    default:
      return true;
  }
}

class Query implements PromiseLike<any> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: [string, boolean][] = [];
  private from = 0;
  private to = Infinity;
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private payload: any = null;
  private singleMode: 'one' | 'maybe' | null = null;
  private embed: string | null = null;
  constructor(private name: string) {}
  select(cols = '*') {
    const m = /(\w+):profiles!\w+\(/.exec(cols);
    this.embed = m ? m[1] : null;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.orders.push([c, o?.ascending !== false]);
    return this;
  }
  range(a: number, b: number) {
    this.from = a;
    this.to = b;
    return this;
  }
  limit(n: number) {
    this.to = this.from + n - 1;
    return this;
  }
  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }
  single() {
    this.singleMode = 'one';
    return this;
  }
  insert(v: any) {
    this.mode = 'insert';
    this.payload = v;
    return this;
  }
  update(v: any) {
    this.mode = 'update';
    this.payload = v;
    return this;
  }
  delete() {
    this.mode = 'delete';
    return this;
  }
  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, ko?: ((e: any) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, ko);
  }
  private run() {
    const rows = table(this.name);
    if (this.mode === 'insert') {
      const list: Row[] = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => ({ id: newId(), created_at: new Date().toISOString(), ...r }));
      if (this.name === 'tasmia_submissions') for (const r of list) r.submitted_at ||= new Date().toISOString();
      if (this.name === 'review_confirmations') for (const r of list) r.confirmed_at ||= new Date().toISOString();
      rows.push(...list);
      save();
      return { data: list, error: null };
    }
    let out = rows.filter((r) => visible(this.name, r) && this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of out) Object.assign(r, this.payload);
      save();
      return { data: out, error: null };
    }
    if (this.mode === 'delete') {
      world.tables[this.name] = rows.filter((r) => !out.includes(r));
      save();
      return { data: out, error: null };
    }
    for (const [c, asc] of [...this.orders].reverse())
      out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
    out = out.slice(this.from, this.to + 1);
    if (this.embed) out = out.map((r) => ({ ...r, [this.embed!]: profile(r.user_id) ?? null }));
    out = JSON.parse(JSON.stringify(out));
    if (this.singleMode === 'one' && out.length !== 1) return err('JSON object requested, multiple (or no) rows returned', 'PGRST116');
    if (this.singleMode) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}

function programToday(): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  const d = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  if (Number(p.hour) < 5) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const rpcs: Record<string, (args: any) => any> = {
  history_member_names: () => ({ data: [], error: null }),
  notifications_mark_seen: ({ p_items }) => {
    for (const it of p_items) {
      const s = table('notification_states').find((x) => x.user_id === uid() && x.notification_key === it.key);
      if (s) s.seen_at ||= new Date().toISOString();
      else table('notification_states').push({ user_id: uid(), notification_key: it.key, kind: it.kind, tone: it.tone, urgent: it.urgent, title: it.title, body: it.body, seen_at: new Date().toISOString(), archived_at: null, updated_at: new Date().toISOString() });
    }
    save();
    return { data: p_items.length, error: null };
  },
  notification_archive: ({ p_item: it }) => {
    const now = new Date().toISOString();
    const s = table('notification_states').find((x) => x.user_id === uid() && x.notification_key === it.key);
    if (s) Object.assign(s, { archived_at: s.archived_at || now, seen_at: s.seen_at || now, title: it.title, body: it.body, kind: it.kind, tone: it.tone, urgent: it.urgent, updated_at: now });
    else table('notification_states').push({ user_id: uid(), notification_key: it.key, kind: it.kind, tone: it.tone, urgent: it.urgent, title: it.title, body: it.body, seen_at: now, archived_at: now, updated_at: now });
    save();
    return { data: now, error: null };
  },
  set_notification_batch_follow: ({ p_batch_id, p_enabled }) => {
    if (!isMaster()) return err('متابعة الدفعات متاحة للمشرفة العامة فقط', '42501');
    const s = table('admin_notification_batch_subscriptions').find((x) => x.admin_user_id === uid() && x.batch_id === p_batch_id);
    if (s) s.enabled = p_enabled;
    else table('admin_notification_batch_subscriptions').push({ admin_user_id: uid(), batch_id: p_batch_id, enabled: p_enabled });
    save();
    return { data: p_enabled, error: null };
  },
  admin_alert_dismiss: ({ p_batch_id, p_member_id, p_member_name, p_summary }) => {
    if (profile(uid())?.role !== 'admin') return err('هذا الإجراء متاح للمشرفات فقط', '42501');
    if (!managedBatchIds().has(p_batch_id)) return err('لا تملكين صلاحية على هذه الدفعة', '42501');
    const now = new Date().toISOString();
    const rows = table('admin_alert_dismissals');
    const d = rows.find((x) => x.admin_user_id === uid() && x.batch_id === p_batch_id && x.member_user_id === p_member_id);
    if (d) Object.assign(d, { member_name: p_member_name, summary: p_summary });
    else rows.push({ admin_user_id: uid(), batch_id: p_batch_id, member_user_id: p_member_id, member_name: p_member_name, summary: p_summary, dismissed_at: now });
    save();
    return { data: d?.dismissed_at ?? now, error: null };
  },
  admin_alert_restore: ({ p_batch_id, p_member_id }) => {
    const before = table('admin_alert_dismissals').length;
    world.tables.admin_alert_dismissals = table('admin_alert_dismissals').filter((x) => !(x.admin_user_id === uid() && x.batch_id === p_batch_id && x.member_user_id === p_member_id));
    world.tables.notification_states = table('notification_states').filter((x) => !(x.user_id === uid() && x.notification_key.startsWith(`alert:${p_batch_id}:${p_member_id}:`)));
    save();
    return { data: table('admin_alert_dismissals').length < before, error: null };
  },
  complete_distant_review: ({ p_assignment_id }) => {
    const a = table('distant_review_assignments').find((x) => x.id === p_assignment_id);
    if (!a) return err('يوم المراجعة البعيدة غير موجود', 'P0002');
    if (a.review_date > programToday()) return err('لم يحن موعد هذه المراجعة البعيدة بعد.', '23514');
    const done = table('distant_review_completions').find((x) => x.assignment_id === a.id && x.user_id === uid());
    if (done) return { data: { ...done, already_recorded: true }, error: null };
    const row = { id: newId(), assignment_id: a.id, user_id: uid(), completed_at: new Date().toISOString(), completed_on: programToday(), member_name_snapshot: profile(uid())?.full_name };
    table('distant_review_completions').push(row);
    save();
    return { data: { ...row, already_recorded: false }, error: null };
  },
};

function adminActions(body: any) {
  const batches = managedBatchIds();
  const today = programToday();
  if (body.action === 'distant-review-create' || body.action === 'distant-review-update') {
    const existing = body.assignment_id ? table('distant_review_assignments').find((x) => x.id === body.assignment_id) : null;
    const batchId = existing ? existing.batch_id : body.batch_id;
    if (!batches.has(batchId)) return { data: { error: 'لا تملكين صلاحية إدارة هذه الدفعة' }, error: null };
    if (body.review_date <= today) return { data: { error: 'يجب أن يكون تاريخ المراجعة البعيدة في المستقبل (بعد اليوم).' }, error: null };
    const cycle = table('cycles').find((c) => c.batch_id === batchId && c.status === 'active');
    const row = existing ?? { id: newId(), batch_id: batchId, cycle_id: cycle.id, created_at: new Date().toISOString(), created_by_name_snapshot: profile(uid())?.full_name };
    Object.assign(row, { review_date: body.review_date, start_quarter: body.start_quarter, end_quarter: body.end_quarter, note: body.note || null, updated_at: new Date().toISOString() });
    if (!existing) table('distant_review_assignments').push(row);
    save();
    return { data: { success: true, assignment: row, message: existing ? 'تم تعديل يوم المراجعة البعيدة' : `تمت إضافة يوم المراجعة البعيدة (${body.review_date})` }, error: null };
  }
  if (body.action === 'distant-review-delete') {
    const a = table('distant_review_assignments').find((x) => x.id === body.assignment_id);
    if (!a || !batches.has(a.batch_id) || a.review_date <= today) return { data: { error: 'لا يمكن حذف يوم مراجعة بعيدة حلّ موعده أو مضى؛ يبقى محفوظًا في السجل.' }, error: null };
    world.tables.distant_review_assignments = table('distant_review_assignments').filter((x) => x !== a);
    save();
    return { data: { success: true, message: 'تم حذف يوم المراجعة البعيدة، وعاد هذا التاريخ يومًا عاديًا في البرنامج' }, error: null };
  }
  return { data: { error: 'إجراء غير معروف' }, error: null };
}

const authUser = () => (uid() ? { id: uid(), email: `${uid()}@e2e.local` } : null);

export const supabase: any = {
  from: (name: string) => new Query(name),
  rpc: async (name: string, args: any) => (rpcs[name] ? rpcs[name](args) : err(`unknown rpc ${name}`)),
  functions: {
    invoke: async (name: string, { body }: { body: any }) =>
      name === 'admin-actions' ? adminActions(body) : { data: { error: `unsupported function ${name}` }, error: null },
  },
  auth: {
    getUser: async () => ({ data: { user: authUser() }, error: null }),
    getSession: async () => ({ data: { session: uid() ? { user: authUser() } : null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: async () => {
      world.userId = null;
      save();
      return { error: null };
    },
    signInWithPassword: async () => ({ data: { user: null }, error: { message: 'e2e' } }),
  },
};
