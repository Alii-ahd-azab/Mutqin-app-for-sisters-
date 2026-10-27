import {
  User,
  Batch,
  AdminAccount,
  AdminAccountUpdate,
  NewAccountPayload,
  BatchBootstrap,
  GroupSettings,
  RestDay,
  RecitationLog,
  RevisionLog,
  PeerTest,
  PeerTestAttempt,
  PeerTestAttemptQuestion,
  PeerTestCandidate,
  PeerTestQuestion,
  PeerTestSaveInput,
  DistantReviewAssignment,
  DistantReviewCompletion,
  DistantReviewInput,
} from '../types';

import { supabase } from '../lib/supabase';

import {
  programDate,
  programDateOfTimestamp,
  calculateCycleInfo,
  getActiveCycleDates,
  buildProgramSettings,
  revisionDateForProgramDay,
} from '../lib/calculations';

import {
  buildBatchAdminAlerts,
  type BatchAdminAlert,
  type NotificationState,
} from '../lib/notifications';

import {
  computeBatchDelays,
  loadBatchProgram,
} from '../../supabase/functions/_shared/logic/batchDelays.ts';

import { phoneToAuthEmail } from '../lib/authHelpers';


// What is stored with a seen/archived notification: its key plus a display snapshot for the history.
export type NotificationSnapshot = {
  key: string;
  kind: string;
  tone: string;
  urgent: boolean;
  title: string;
  body: string;
};

// The program date: changes at 05:00 Africa/Cairo, whatever the device's time zone.
const today = () => programDate();


/*
 * ====================================
 * ROW TYPES (database shape)
 * ====================================
 *
 * Every program table is scoped to a
 * batch: cycles carry batch_id, and
 * rest days / pauses / recitations /
 * revisions are scoped through their
 * cycle_id. Row Level Security on the
 * server enforces the same isolation,
 * so the filters below are not the
 * security boundary — they only avoid
 * loading other batches' data.
 */

type CycleRow = {
  id: string;
  batch_id: string;
  cycle_number: number;
  name: string | null;
  starts_on: string;
  status: 'active' | 'archived';
  ended_on: string | null;
  created_by: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string;
  role: 'member' | 'admin';
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
  is_master_admin: boolean;
};

type BatchRow = {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
};

type RestDayRow = {
  id: string;
  cycle_id: string;
  rest_date: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type PauseRow = {
  id: string;
  cycle_id: string;
  paused_on: string;
  resumed_on: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type ThoughtRow = {
  id: string;
  batch_id: string;
  content_html: string;
  published_by: string | null;
  published_at: string;
  is_published: boolean;
};

type RecitationRow = {
  id: string;
  cycle_id: string;
  user_id: string;
  // null once the listener's account has been permanently deleted
  listener_id: string | null;
  // listener's name at the time of the recitation (set by the database)
  listener_name_snapshot: string | null;
  // set when the member used her one listener correction
  listener_changed_at: string | null;
  quarter_number: number;
  notes: string | null;
  submitted_at: string;
};

type RevisionRow = {
  id: string;
  cycle_id: string;
  user_id: string;
  program_day: number;
  start_quarter: number;
  end_quarter: number;
  confirmed_at: string;
};

type DistantReviewRow = {
  id: string;
  batch_id: string;
  cycle_id: string;
  review_date: string;
  start_quarter: number;
  end_quarter: number;
  note: string | null;
  created_by_name_snapshot: string | null;
  created_at: string;
  updated_at: string;
};

type DistantCompletionRow = {
  id: string;
  assignment_id: string;
  user_id: string;
  completed_at: string;
  completed_on: string;
  member_name_snapshot: string | null;
};

type MembershipWithProfileRow = {
  membership_role: 'member' | 'admin';
  joined_at: string;
  profile: ProfileRow | null;
};

type HistoryNameRow = {
  id: string;
  full_name: string;
};

type AdminMembershipRow = {
  user_id: string;
  batch_id: string;
};


const PROFILE_COLUMNS =
  'id, full_name, phone, role, active, created_at, deactivated_at, is_master_admin';

const BATCH_COLUMNS =
  'id, name, created_at, archived_at';


function mapProfile(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    role: row.role,
    is_active: row.active,
    created_at: row.created_at,
    auth_uid: row.id,
    is_master_admin: !!row.is_master_admin,
  };
}


function requireBatchId(
  batchId: string | undefined | null
): string {
  if (!batchId) {
    throw new Error(
      'يرجى اختيار الدفعة أولاً'
    );
  }

  return batchId;
}


/*
 * «المراجعة البعيدة» payload: «إلى الربع» is the stopping boundary
 * (the beginning of that quarter), so it must come after «من الربع».
 */
function distantReviewBody(
  payload: DistantReviewInput
) {
  const start = Number(payload.start_quarter);
  const end = Number(payload.end_quarter);

  if (
    !payload.review_date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(payload.review_date)
  ) {
    throw new Error('يرجى تحديد تاريخ المراجعة البعيدة');
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end > 240 ||
    start >= end
  ) {
    throw new Error(
      'نطاق الأرباع غير صالح: «إلى الربع» هو موضع التوقف (بداية ذلك الربع)، فيجب أن يكون بعد «من الربع» وضمن 1–240.'
    );
  }

  return {
    review_date: payload.review_date,
    start_quarter: start,
    end_quarter: end,
    note: (payload.note || '').trim(),
  };
}


/*
 * Calls an Edge Function and surfaces
 * the server's Arabic error message
 * (non-2xx responses arrive as
 * FunctionsHttpError with the JSON
 * body in error.context).
 */
async function invokeFunction<T>(
  name: 'admin-users' | 'admin-actions' | 'peer-tests',
  body: Record<string, unknown>,
  fallbackMessage: string
): Promise<T> {
  const { data, error } =
    await supabase.functions.invoke(
      name,
      { body }
    );

  if (error) {
    let message = fallbackMessage;

    const context = (
      error as { context?: unknown }
    ).context;

    if (context instanceof Response) {
      try {
        const payload =
          await context.json();

        if (payload?.error) {
          message = String(
            payload.error
          );
        }
      } catch {
        // keep fallback message
      }
    }

    throw new Error(message);
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data as T;
}


/*
 * PostgREST returns at most 1000 rows per
 * request, so long histories are read in
 * pages until the last (short) page.
 */
const ROWS_PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  fetchPage: (
    from: number,
    to: number
  ) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
  }>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += ROWS_PAGE_SIZE) {
    const { data, error } = await fetchPage(
      from,
      from + ROWS_PAGE_SIZE - 1
    );

    if (error) {
      throw error;
    }

    rows.push(...((data || []) as T[]));

    if (!data || data.length < ROWS_PAGE_SIZE) {
      return rows;
    }
  }
}


async function getCurrentAuthUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error('يجب تسجيل الدخول أولاً');
  }

  return user;
}


async function getCurrentProfile(): Promise<ProfileRow> {
  const user = await getCurrentAuthUser();

  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .single();

  if (error) {
    throw error;
  }

  return data as ProfileRow;
}


async function getBatch(
  batchId: string
): Promise<Batch> {
  const { data, error } = await supabase
    .from('batches')
    .select(BATCH_COLUMNS)
    .eq('id', batchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  /*
   * RLS hides batches the caller
   * cannot access, so "not found"
   * also means "not authorized".
   */
  if (!data) {
    throw new Error(
      'لا تملكين صلاحية الوصول لهذه الدفعة'
    );
  }

  return data as BatchRow;
}


/*
 * Users relevant to one batch:
 * - its members (active and excluded)
 * - admins assigned to it
 * - master admins (they manage every batch)
 */
async function getBatchUsers(
  batchId: string
): Promise<User[]> {
  const [membershipsResult, mastersResult] =
    await Promise.all([
      supabase
        .from('batch_memberships')
        .select(
          `membership_role, joined_at, profile:profiles!batch_memberships_user_id_fkey(${PROFILE_COLUMNS})`
        )
        .eq('batch_id', batchId),
      supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('role', 'admin')
        .eq('is_master_admin', true),
    ]);

  if (membershipsResult.error) {
    throw membershipsResult.error;
  }

  if (mastersResult.error) {
    throw mastersResult.error;
  }

  const byId = new Map<string, ProfileRow>();

  // When each MEMBER joined this batch (revision debt starts here).
  const joinedAtById = new Map<string, string>();

  for (const row of (membershipsResult.data ||
    []) as unknown as MembershipWithProfileRow[]) {
    if (row.profile) {
      byId.set(row.profile.id, row.profile);

      if (row.membership_role === 'member') {
        joinedAtById.set(row.profile.id, row.joined_at);
      }
    }
  }

  for (const row of (mastersResult.data ||
    []) as ProfileRow[]) {
    byId.set(row.id, row);
  }

  return Array.from(byId.values())
    .sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )
    .map((row) => ({
      ...mapProfile(row),
      batch_joined_at: joinedAtById.get(row.id),
    }));
}


/*
 * Display names for everyone appearing in
 * a cycle's history rows. People who have
 * since moved to another batch (or whose
 * profile the caller can no longer read)
 * are resolved through a names-only RPC,
 * so their old rows keep their name.
 */
async function buildNameMap(
  cycleId: string,
  users: User[],
  recitationRows: RecitationRow[],
  revisionRows: RevisionRow[]
): Promise<Map<string, string>> {
  const names = new Map(
    users.map((user) => [user.id, user.name])
  );

  const missing = new Set<string>();

  for (const row of recitationRows) {
    if (!names.has(row.user_id)) missing.add(row.user_id);
    if (row.listener_id && !names.has(row.listener_id)) {
      missing.add(row.listener_id);
    }
  }

  for (const row of revisionRows) {
    if (!names.has(row.user_id)) missing.add(row.user_id);
  }

  if (missing.size === 0) {
    return names;
  }

  const { data, error } = await supabase.rpc(
    'history_member_names',
    { p_cycle_id: cycleId }
  );

  // Names are cosmetic: never fail the dashboard over them.
  if (error) {
    console.error('history_member_names failed:', error);
    return names;
  }

  for (const row of (data || []) as HistoryNameRow[]) {
    if (!names.has(row.id)) {
      names.set(row.id, row.full_name);
    }
  }

  return names;
}


async function getActiveCycle(
  batchId: string
): Promise<CycleRow> {
  const { data, error } = await supabase
    .from('cycles')
    .select('*')
    .eq('batch_id', batchId)
    .eq('status', 'active')
    .order('cycle_number', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(
      'لا توجد دورة نشطة لهذه الدفعة حالياً'
    );
  }

  return data as CycleRow;
}


async function getRestDayRows(
  cycleId: string
): Promise<RestDayRow[]> {
  const { data, error } = await supabase
    .from('group_rest_days')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('rest_date', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []) as RestDayRow[];
}


async function getPauseRows(
  cycleId: string
): Promise<PauseRow[]> {
  const { data, error } = await supabase
    .from('program_pauses')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('paused_on', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []) as PauseRow[];
}




function buildSettings(
  cycle: CycleRow,
  pauses: PauseRow[],
  distantReviewDates: string[],
  latestThought?: ThoughtRow | null,
  publisherName?: string
): GroupSettings {
  return {
    ...buildProgramSettings(
      cycle,
      pauses,
      distantReviewDates
    ),
    daily_thought: latestThought?.content_html || '',
    daily_thought_updated_at:
      latestThought?.published_at,
    daily_thought_updated_by:
      publisherName,
  };
}


function mapRestDays(
  rows: RestDayRow[],
  userMap: Map<string, User>
): RestDay[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.rest_date,
    note: row.reason || '',
    added_by_admin_id:
      row.created_by || '',
    added_by_name:
      row.created_by
        ? userMap.get(row.created_by)?.name
        : undefined,
    created_at: row.created_at,
  }));
}


async function getLatestThought(
  batchId: string
): Promise<ThoughtRow | null> {
  const { data, error } = await supabase
    .from('daily_thoughts')
    .select('*')
    .eq('batch_id', batchId)
    .eq('is_published', true)
    .order('published_at', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? (data as ThoughtRow)
    : null;
}


/*
 * «المراجعة البعيدة» days of one batch
 * (every cycle: the history keeps them).
 */
async function getDistantReviewRows(
  batchId: string
): Promise<DistantReviewRow[]> {
  return fetchAllRows<DistantReviewRow>((from, to) =>
    supabase
      .from('distant_review_assignments')
      .select(
        'id, batch_id, cycle_id, review_date, start_quarter, end_quarter, note, created_by_name_snapshot, created_at, updated_at'
      )
      .eq('batch_id', batchId)
      .order('review_date', {
        ascending: true,
      })
      .order('id', {
        ascending: true,
      })
      .range(from, to)
  );
}


/*
 * Completions of these assignments that
 * the caller may see (RLS: a member her
 * own, an admin her managed batches').
 */
async function getDistantCompletionRows(
  assignmentIds: string[]
): Promise<DistantCompletionRow[]> {
  const rows: DistantCompletionRow[] = [];

  for (let i = 0; i < assignmentIds.length; i += 100) {
    const ids = assignmentIds.slice(i, i + 100);

    rows.push(
      ...(await fetchAllRows<DistantCompletionRow>((from, to) =>
        supabase
          .from('distant_review_completions')
          .select(
            'id, assignment_id, user_id, completed_at, completed_on, member_name_snapshot'
          )
          .in('assignment_id', ids)
          .order('id', {
            ascending: true,
          })
          .range(from, to)
      ))
    );
  }

  return rows;
}


function cycleDistantDates(
  rows: DistantReviewRow[],
  cycleId: string
): string[] {
  return rows
    .filter((row) => row.cycle_id === cycleId)
    .map((row) => row.review_date);
}


function mapDistantReviews(
  rows: DistantReviewRow[]
): DistantReviewAssignment[] {
  return rows.map((row) => ({
    id: row.id,
    batch_id: row.batch_id,
    cycle_id: row.cycle_id,
    review_date: row.review_date,
    start_quarter: row.start_quarter,
    end_quarter: row.end_quarter,
    note: row.note || undefined,
    created_by_name:
      row.created_by_name_snapshot || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}


function mapDistantCompletions(
  rows: DistantCompletionRow[],
  names: Map<string, string>
): DistantReviewCompletion[] {
  return rows.map((row) => ({
    id: row.id,
    assignment_id: row.assignment_id,
    member_id: row.user_id,
    member_name:
      row.member_name_snapshot ||
      names.get(row.user_id),
    completed_at: row.completed_at,
    completed_on: row.completed_on,
  }));
}


/*
 * Lightweight program state for one
 * batch (cycle + settings + rest days),
 * used by write operations that need
 * the active cycle but not the members.
 */
async function getProgramState(
  batchId: string
) {
  const cycle =
    await getActiveCycle(batchId);

  const [restRows, pauseRows, distantRows] =
    await Promise.all([
      getRestDayRows(cycle.id),
      getPauseRows(cycle.id),
      getDistantReviewRows(batchId),
    ]);

  const settings = buildSettings(
    cycle,
    pauseRows,
    cycleDistantDates(
      distantRows,
      cycle.id
    )
  );

  const restDays = mapRestDays(
    restRows,
    new Map()
  );

  return {
    cycle,
    pauseRows,
    settings,
    restDays,
  };
}


async function getRecitationRows(
  cycleId: string
): Promise<RecitationRow[]> {
  return fetchAllRows<RecitationRow>((from, to) =>
    supabase
      .from('tasmia_submissions')
      .select(
        `
        id,
        cycle_id,
        user_id,
        listener_id,
        listener_name_snapshot,
        listener_changed_at,
        quarter_number,
        notes,
        submitted_at
        `
      )
      .eq('cycle_id', cycleId)
      .order('submitted_at', {
        ascending: true,
      })
      .order('id', {
        ascending: true,
      })
      .range(from, to)
  );
}


function mapRecitations(
  cycle: CycleRow,
  rows: RecitationRow[],
  names: Map<string, string>
): RecitationLog[] {
  return rows.map((row) => {
    const memberName =
      names.get(row.user_id);

    const listenerName =
      row.listener_id
        ? names.get(row.listener_id)
        : undefined;

    // Program date (05:00 Africa/Cairo) of the submission.
    const submittedDate =
      programDateOfTimestamp(
        String(
          row.submitted_at || ''
        )
      );

    return {
      id: row.id,
      member_id: row.user_id,
      member_name:
        memberName || 'عضو',
      listener_id:
        row.listener_id || undefined,
      // The name at recitation time; still shown after the
      // listener's account is deleted or renamed.
      listener_name:
        row.listener_name_snapshot ||
        listenerName,
      listener_changed_at:
        row.listener_changed_at || undefined,
      quarter_number:
        row.quarter_number,
      cycle_number:
        cycle.cycle_number,
      date:
        submittedDate,
      notes:
        row.notes || undefined,
      created_at:
        row.submitted_at,
      reciter_id:
        row.user_id,
      reciter_name:
        memberName || 'عضو',
    };
  });
}


async function getRevisionRows(
  cycleId: string
): Promise<RevisionRow[]> {
  return fetchAllRows<RevisionRow>((from, to) =>
    supabase
      .from('review_confirmations')
      .select(
        `
        id,
        cycle_id,
        user_id,
        program_day,
        start_quarter,
        end_quarter,
        confirmed_at
        `
      )
      .eq('cycle_id', cycleId)
      .order('program_day', {
        ascending: true,
      })
      .order('id', {
        ascending: true,
      })
      .range(from, to)
  );
}


function mapRevisions(
  cycle: CycleRow,
  rows: RevisionRow[],
  names: Map<string, string>,
  settings: GroupSettings,
  restDays: RestDay[]
): RevisionLog[] {
  const activeDates =
    getActiveCycleDates(
      cycle.starts_on,
      today(),
      restDays,
      settings
    );

  return rows.map((row) => {
    const memberName =
      names.get(row.user_id);

    const historicalDate =
      revisionDateForProgramDay(
        activeDates,
        row.program_day,
        row.confirmed_at
      );

    return {
      id: row.id,
      member_id:
        row.user_id,
      member_name:
        memberName || 'عضو',
      date:
        historicalDate,
      cycle_number:
        cycle.cycle_number,
      review_start_quarter:
        row.start_quarter,
      review_end_quarter:
        row.end_quarter,
      created_at:
        row.confirmed_at,
    };
  });
}


/*
 * Peer tests of one cycle. RLS returns all of
 * them to the batch's admins and only the LIVE
 * one(s) to the batch's members.
 */
async function getPeerTestsForCycle(
  cycleId: string
): Promise<PeerTest[]> {
  const { data, error } = await supabase
    .from('peer_tests')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('created_at', {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return (data || []) as PeerTest[];
}

async function getPeerTestAttemptsForTests(
  testIds: string[]
): Promise<PeerTestAttempt[]> {
  if (testIds.length === 0) {
    return [];
  }

  return fetchAllRows<PeerTestAttempt>((from, to) =>
    supabase
      .from('peer_test_attempts')
      .select('*')
      .in('test_id', testIds)
      .neq('status', 'cancelled')
      .order('created_at', {
        ascending: false,
      })
      .order('id', {
        ascending: true,
      })
      .range(from, to)
  );
}


/*
 * Loads everything one batch's
 * dashboard needs, in a single pass.
 */
async function buildBootstrap(
  batchId: string
): Promise<BatchBootstrap> {
  const [batch, cycle, users] =
    await Promise.all([
      getBatch(batchId),
      getActiveCycle(batchId),
      getBatchUsers(batchId),
    ]);

  const [
    restRows,
    pauseRows,
    latestThought,
    recitationRows,
    revisionRows,
    peerTests,
    distantRows,
  ] = await Promise.all([
    getRestDayRows(cycle.id),
    getPauseRows(cycle.id),
    getLatestThought(batchId),
    getRecitationRows(cycle.id),
    getRevisionRows(cycle.id),
    getPeerTestsForCycle(cycle.id),
    getDistantReviewRows(batchId),
  ]);

  const [peerTestAttempts, distantCompletionRows] =
    await Promise.all([
      getPeerTestAttemptsForTests(
        peerTests.map((t) => t.id)
      ),
      getDistantCompletionRows(
        distantRows.map((r) => r.id)
      ),
    ]);

  const userMap = new Map(
    users.map((user) => [
      user.id,
      user,
    ])
  );

  const publisherName =
    latestThought?.published_by
      ? userMap.get(
          latestThought.published_by
        )?.name
      : undefined;

  const settings =
    buildSettings(
      cycle,
      pauseRows,
      cycleDistantDates(
        distantRows,
        cycle.id
      ),
      latestThought,
      publisherName
    );

  const restDays =
    mapRestDays(
      restRows,
      userMap
    );

  const day = today();

  const cycleInfo =
    calculateCycleInfo(
      settings,
      restDays,
      day
    );

  const names =
    await buildNameMap(
      cycle.id,
      users,
      recitationRows,
      revisionRows
    );

  const recitations =
    mapRecitations(
      cycle,
      recitationRows,
      names
    );

  const revisions =
    mapRevisions(
      cycle,
      revisionRows,
      names,
      settings,
      restDays
    );

  return {
    batch,
    cycle_id: cycle.id,
    cycleInfo,
    settings,
    restDays,
    users,
    recitations,
    revisions,
    todayRecitations:
      recitations.filter(
        (item) => item.date === day
      ),
    todayRevisions:
      revisions.filter(
        (item) => item.date === day
      ),
    peerTests,
    peerTestAttempts,
    distantReviews:
      mapDistantReviews(distantRows),
    distantCompletions:
      mapDistantCompletions(
        distantCompletionRows,
        names
      ),
  };
}


export const api = {
  async login(
    phone: string,
    password: string
  ): Promise<{
    user: User;
    token: string;
  }> {
    const email =
      phoneToAuthEmail(phone);

    const {
      data,
      error,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password,
        });

    if (
      error ||
      !data.user
    ) {
      throw new Error(
        'رقم الهاتف أو كلمة المرور غير صحيحة'
      );
    }

    const {
      data: profile,
      error: profileError,
    } =
      await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq(
          'id',
          data.user.id
        )
        .single();

    if (profileError) {
      throw profileError;
    }

    return {
      user:
        mapProfile(
          profile as ProfileRow
        ),
      token:
        data.session
          ?.access_token || '',
    };
  },


  async logout(): Promise<void> {
    const { error } =
      await supabase.auth
        .signOut();

    if (error) {
      throw error;
    }
  },


  async getMe(): Promise<{ user: User }> {
    const profile =
      await getCurrentProfile();

    return {
      user:
        mapProfile(profile),
    };
  },


  async changePassword(
    payload: {
      currentPassword: string;
      newPassword: string;
      confirmPassword?: string;
    }
  ): Promise<{
    message: string;
  }> {
    if (
      payload.confirmPassword &&
      payload.confirmPassword !==
        payload.newPassword
    ) {
      throw new Error(
        'كلمتا المرور غير متطابقتين'
      );
    }

    if (
      payload.newPassword.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    const profile =
      await getCurrentProfile();

    const email =
      phoneToAuthEmail(
        profile.phone
      );

    const {
      error: verifyError,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password:
            payload.currentPassword,
        });

    if (verifyError) {
      throw new Error(
        'كلمة المرور الحالية غير صحيحة'
      );
    }

    const {
      error,
    } =
      await supabase.auth
        .updateUser({
          password:
            payload.newPassword,
        });

    if (error) {
      throw error;
    }

    return {
      message:
        'تم تغيير كلمة المرور بنجاح',
    };
  },


  /*
   * Batches the current user may open.
   * RLS decides: master admins get all,
   * batch admins their assigned ones,
   * members their single batch.
   */
  async getAccessibleBatches(): Promise<{
    batches: Batch[];
  }> {
    const { data, error } =
      await supabase
        .from('batches')
        .select(BATCH_COLUMNS)
        .is('archived_at', null)
        .order('created_at', {
          ascending: true,
        });

    if (error) {
      throw error;
    }

    return {
      batches:
        (data || []) as BatchRow[],
    };
  },


  async getBootstrap(
    params: {
      batch_id: string;
    }
  ): Promise<BatchBootstrap> {
    return buildBootstrap(
      requireBatchId(params.batch_id)
    );
  },


  async getRecitations(
    params: {
      batch_id: string;
      member_id?: string;
      reciter_id?: string;
      date?: string;
    }
  ): Promise<{
    recitations:
      RecitationLog[];
  }> {
    const bootstrap =
      await buildBootstrap(
        requireBatchId(params.batch_id)
      );

    let recitations =
      bootstrap.recitations;

    const memberId =
      params.member_id ||
      params.reciter_id;

    if (memberId) {
      recitations =
        recitations.filter(
          (item) =>
            item.member_id ===
            memberId
        );
    }

    if (params.date) {
      recitations =
        recitations.filter(
          (item) =>
            item.date ===
            params.date
        );
    }

    return {
      recitations,
    };
  },


  async recordRecitation(
    batchId: string,
    payload: {
      quarter_number: number;
      listener_id: string;
      notes?: string;
      date?: string;
    }
  ): Promise<{
    message: string;
  }> {
    const user =
      await getCurrentAuthUser();

    const cycle =
      await getActiveCycle(
        requireBatchId(batchId)
      );

    const {
      error,
    } =
      await supabase
        .from(
          'tasmia_submissions'
        )
        .insert({
          cycle_id:
            cycle.id,
          user_id:
            user.id,
          listener_id:
            payload.listener_id,
          quarter_number:
            payload.quarter_number,
          notes:
            payload.notes || null,
        });

    if (error) {
      if (
        error.code === '23505'
      ) {
        throw new Error(
          'تم تسجيل هذا الربع من قبل'
        );
      }

      throw error;
    }

    return {
      message:
        'تم تسجيل التسميع بنجاح',
    };
  },


  /*
   * The member's one listener correction
   * (within 12 hours of submitting). All
   * rules are checked by the database
   * function; only the listener changes.
   */
  async correctRecitationListener(
    submissionId: string,
    newListenerId: string
  ): Promise<{
    id: string;
    listener_id: string;
    listener_name_snapshot: string;
    listener_changed_at: string;
  }> {
    const { data, error } =
      await supabase.rpc(
        'correct_tasmia_listener',
        {
          p_submission_id:
            submissionId,
          p_new_listener_id:
            newListenerId,
        }
      );

    if (error) {
      throw new Error(
        error.message ||
          'تعذر تعديل المستمعة'
      );
    }

    return data;
  },


  async getRevisions(
    params: {
      batch_id: string;
      member_id?: string;
      date?: string;
    }
  ): Promise<{
    revisions:
      RevisionLog[];
  }> {
    const bootstrap =
      await buildBootstrap(
        requireBatchId(params.batch_id)
      );

    let revisions =
      bootstrap.revisions;

    if (
      params.member_id
    ) {
      revisions =
        revisions.filter(
          (item) =>
            item.member_id ===
            params.member_id
        );
    }

    if (params.date) {
      revisions =
        revisions.filter(
          (item) =>
            item.date ===
            params.date
        );
    }

    return {
      revisions,
    };
  },


  async recordRevision(
    batchId: string,
    payload: {
      notes?: string;
      date?: string;
    }
  ): Promise<{
    message: string;
  }> {
    const user =
      await getCurrentAuthUser();

    const program =
      await getProgramState(
        requireBatchId(batchId)
      );

    const targetDate =
      payload.date ||
      today();

    const activeDates =
      getActiveCycleDates(
        program.settings
          .start_date,

        targetDate,

        program.restDays,

        program.settings
      );

    /*
     * Revision is indexed by ACTIVE program day. Rest days,
     * pause days and «المراجعة البعيدة» days are not program
     * days, so they never create (or re-open) a revision
     * obligation.
     */
    const programDay =
      activeDates.indexOf(
        targetDate
      ) + 1;

    if (programDay < 1) {
      throw new Error(
        'لا توجد مراجعة يومية جديدة في هذا اليوم (يوم راحة أو مراجعة بعيدة أو إيقاف للبرنامج)'
      );
    }

    const endQuarter =
      Math.min(
        240,
        programDay
      );

    const startQuarter =
      Math.max(
        1,
        endQuarter -
          program.settings
            .review_window +
          1
      );

    const {
      error,
    } =
      await supabase
        .from(
          'review_confirmations'
        )
        .insert({
          cycle_id:
            program.cycle.id,
          user_id:
            user.id,
          program_day:
            programDay,
          start_quarter:
            startQuarter,
          end_quarter:
            endQuarter,
        });

    if (error) {
      if (
        error.code === '23505'
      ) {
        throw new Error(
          'تم تأكيد مراجعة هذا اليوم من قبل'
        );
      }

      throw error;
    }

    return {
      message:
        'تم تأكيد المراجعة بنجاح',
    };
  },


  async adminAddMember(
    payload: NewAccountPayload
  ): Promise<{
    user: User;
    message: string;
  }> {
    /*
     * IMPORTANT:
     * Supabase hosted Auth requires
     * passwords of at least 6 characters.
     *
     * Validate here BEFORE calling the
     * Edge Function so the admin gets a
     * clear Arabic message.
     */
    if (
      payload.password.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    if (
      payload.role === 'member' &&
      !payload.batch_id
    ) {
      throw new Error(
        'يرجى اختيار دفعة العضوة'
      );
    }

    if (
      payload.role === 'admin' &&
      !payload.is_master_admin &&
      (!payload.batch_ids ||
        payload.batch_ids.length === 0)
    ) {
      throw new Error(
        'يرجى اختيار دفعة واحدة على الأقل لمشرفة الدفعة'
      );
    }

    return invokeFunction(
      'admin-users',
      {
        action: 'create',
        ...payload,
      },
      'تعذر إضافة الحساب. حاول مرة أخرى.'
    );
  },


  async adminUpdateMember(
    id: string,
    payload: AdminAccountUpdate
  ): Promise<{
    user: User;
    message: string;
  }> {
    /*
     * If password is being changed,
     * validate before calling the server.
     */
    if (
      payload.password !== undefined &&
      payload.password !== '' &&
      payload.password.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    if (
      payload.batch_ids !== undefined &&
      payload.batch_ids.length === 0
    ) {
      throw new Error(
        'يرجى اختيار دفعة واحدة على الأقل'
      );
    }

    /*
     * ALL account changes (name, phone,
     * password, role, active/excluded,
     * master flag, batch assignments) go
     * through the Edge Function, which
     * verifies that the caller manages
     * this account's batch. The browser
     * has no UPDATE access to profiles.
     */
    return invokeFunction(
      'admin-users',
      {
        action: 'update',
        user_id: id,
        ...payload,
      },
      'تعذر تحديث الحساب. حاول مرة أخرى.'
    );
  },


  async adminDeleteMemberCompletely(
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    return invokeFunction(
      'admin-users',
      {
        action: 'delete',
        user_id: id,
      },
      'تعذر حذف الحساب. حاول مرة أخرى.'
    );
  },


  /*
   * Master admin only: every admin
   * account with its batch assignments.
   */
  async adminListAdmins(): Promise<{
    admins: AdminAccount[];
  }> {
    const [profilesResult, membershipsResult] =
      await Promise.all([
        supabase
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('role', 'admin')
          .order('created_at', {
            ascending: true,
          }),
        supabase
          .from('batch_memberships')
          .select('user_id, batch_id')
          .eq('membership_role', 'admin'),
      ]);

    if (profilesResult.error) {
      throw profilesResult.error;
    }

    if (membershipsResult.error) {
      throw membershipsResult.error;
    }

    const batchesByUser =
      new Map<string, string[]>();

    for (const row of (membershipsResult.data ||
      []) as AdminMembershipRow[]) {
      const list =
        batchesByUser.get(row.user_id) || [];

      list.push(row.batch_id);

      batchesByUser.set(row.user_id, list);
    }

    return {
      admins: (
        (profilesResult.data ||
          []) as ProfileRow[]
      ).map((row) => ({
        user: mapProfile(row),
        is_master_admin:
          !!row.is_master_admin,
        batch_ids:
          batchesByUser.get(row.id) || [],
      })),
    };
  },


  /*
   * Moves a member to another batch. The
   * server determines her current batch,
   * checks permissions on both batches and
   * moves only her current membership.
   */
  async adminMoveMemberBatch(
    userId: string,
    destinationBatchId: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!destinationBatchId) {
      throw new Error(
        'يرجى اختيار الدفعة الجديدة'
      );
    }

    return invokeFunction(
      'admin-users',
      {
        action: 'move-member-batch',
        user_id: userId,
        destination_batch_id: destinationBatchId,
      },
      'تعذر نقل العضوة. حاول مرة أخرى.'
    );
  },


  async adminSetAdminBatches(
    userId: string,
    batchIds: string[]
  ): Promise<{
    message: string;
  }> {
    if (batchIds.length === 0) {
      throw new Error(
        'يرجى اختيار دفعة واحدة على الأقل'
      );
    }

    return invokeFunction(
      'admin-users',
      {
        action: 'set-admin-batches',
        user_id: userId,
        batch_ids: batchIds,
      },
      'تعذر تحديث صلاحيات المشرفة.'
    );
  },


  async adminCreateBatch(
    payload: {
      name: string;
      start_date: string;
    }
  ): Promise<{
    batch: Batch;
    message: string;
  }> {
    if (!payload.name.trim()) {
      throw new Error(
        'اسم الدفعة مطلوب'
      );
    }

    if (!payload.start_date) {
      throw new Error(
        'تاريخ البداية مطلوب'
      );
    }

    return invokeFunction(
      'admin-actions',
      {
        action: 'create-batch',
        name: payload.name.trim(),
        start_date: payload.start_date,
      },
      'تعذر إنشاء الدفعة. حاول مرة أخرى.'
    );
  },


  async adminAddRestDay(
    batchId: string,
    payload: {
      date: string;
      note: string;
    }
  ): Promise<{
    message: string;
  }> {
    const profile =
      await getCurrentProfile();

    const cycle =
      await getActiveCycle(
        requireBatchId(batchId)
      );

    const {
      error,
    } =
      await supabase
        .from(
          'group_rest_days'
        )
        .insert({
          cycle_id:
            cycle.id,
          rest_date:
            payload.date,
          reason:
            payload.note || null,
          created_by:
            profile.id,
        });

    if (error) {
      throw error;
    }

    return {
      message:
        'تمت إضافة يوم الراحة',
    };
  },


  async adminDeleteRestDay(
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const {
      error,
    } =
      await supabase
        .from(
          'group_rest_days'
        )
        .delete()
        .eq('id', id);

    if (error) {
      throw error;
    }

    return {
      success: true,
      message:
        'تم حذف يوم الراحة',
    };
  },


  async adminPause(
    batchId: string
  ): Promise<{
    message: string;
  }> {
    const profile =
      await getCurrentProfile();

    const program =
      await getProgramState(
        requireBatchId(batchId)
      );

    if (program.settings.is_paused) {
      throw new Error(
        'البرنامج متوقف بالفعل'
      );
    }

    const {
      error,
    } =
      await supabase
        .from(
          'program_pauses'
        )
        .insert({
          cycle_id:
            program.cycle.id,
          paused_on:
            today(),
          created_by:
            profile.id,
        });

    if (error) {
      throw error;
    }

    return {
      message:
        'تم إيقاف البرنامج مؤقتاً',
    };
  },


  async adminResume(
    batchId: string
  ): Promise<{
    message: string;
  }> {
    const program =
      await getProgramState(
        requireBatchId(batchId)
      );

    const activePause =
      program.pauseRows.find(
        (pause) =>
          !pause.resumed_on
      );

    if (
      !activePause
    ) {
      throw new Error(
        'البرنامج غير متوقف حالياً'
      );
    }

    const {
      error,
    } =
      await supabase
        .from(
          'program_pauses'
        )
        .update({
          resumed_on:
            today(),
        })
        .eq(
          'id',
          activePause.id
        );

    if (error) {
      throw error;
    }

    return {
      message:
        'تم استئناف البرنامج',
    };
  },


  async adminUpdateSettings(
    batchId: string,
    payload: {
      start_date?: string;
    }
  ): Promise<{
    message: string;
  }> {
    const cycle =
      await getActiveCycle(
        requireBatchId(batchId)
      );

    if (
      payload.start_date
    ) {
      const {
        error,
      } =
        await supabase
          .from('cycles')
          .update({
            starts_on:
              payload.start_date,
          })
          .eq(
            'id',
            cycle.id
          );

      if (error) {
        throw error;
      }
    }

    return {
      message:
        'تم حفظ الإعدادات',
    };
  },


  async adminUpdateDailyThought(
    batchId: string,
    payload: {
      daily_thought:
        string;
    }
  ): Promise<{
    message: string;
  }> {
    const profile =
      await getCurrentProfile();

    const {
      error,
    } =
      await supabase
        .from(
          'daily_thoughts'
        )
        .insert({
          batch_id:
            requireBatchId(batchId),
          content_html:
            payload.daily_thought,
          published_by:
            profile.id,
          is_published:
            true,
        });

    if (error) {
      throw error;
    }

    return {
      message:
        'تم حفظ ونشر الخاطرة',
    };
  },


  async adminDeleteDailyThought(
    batchId: string
  ): Promise<{
    message: string;
  }> {
    const latest =
      await getLatestThought(
        requireBatchId(batchId)
      );

    if (latest) {
      const {
        error,
      } =
        await supabase
          .from(
            'daily_thoughts'
          )
          .update({
            is_published:
              false,
          })
          .eq(
            'id',
            latest.id
          )
          .eq(
            'batch_id',
            batchId
          );

      if (error) {
        throw error;
      }
    }

    return {
      message:
        'تم حذف الخاطرة الحالية',
    };
  },


  /*
   * Archives the selected batch's active
   * cycle and starts the next one.
   * Other batches are never touched.
   */
  async adminFactoryReset(
    batchId: string,
    cycleId?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const data =
      await invokeFunction<{
        message?: string;
      }>(
        'admin-actions',
        {
          action: 'factory-reset',
          batch_id:
            requireBatchId(batchId),
          cycle_id: cycleId,
        },
        'تعذر بدء دورة جديدة. حاول مرة أخرى.'
      );

    return {
      success: true,
      message:
        data?.message ||
        'تم بدء دورة جديدة',
    };
  },


  async adminGetStats(
    batchId: string
  ): Promise<{
    total_members: number;
    completed_recitation_count: number;
    completed_revision_count: number;
    pending_recitation_today: User[];
    pending_revision_today: User[];
  }> {
    const bootstrap =
      await buildBootstrap(
        requireBatchId(batchId)
      );

    const members =
      bootstrap.users.filter(
        (user) =>
          user.role ===
            'member' &&
          user.is_active
      );

    const recitedIds =
      new Set(
        bootstrap.todayRecitations.map(
          (item) =>
            item.member_id
        )
      );

    const reviewedIds =
      new Set(
        bootstrap.todayRevisions.map(
          (item) =>
            item.member_id
        )
      );

    return {
      total_members:
        members.length,

      completed_recitation_count:
        recitedIds.size,

      completed_revision_count:
        reviewedIds.size,

      pending_recitation_today:
        members.filter(
          (member) =>
            !recitedIds.has(
              member.id
            )
        ),

      pending_revision_today:
        members.filter(
          (member) =>
            !reviewedIds.has(
              member.id
            )
        ),
    };
  },


  /*
   * ============ PEER TESTING ============
   * Reads use RLS; every write goes through
   * the peer-tests Edge Function, which
   * re-checks all rules server-side.
   */
  async getPeerTests(
    cycleId: string
  ): Promise<{ tests: PeerTest[] }> {
    return {
      tests: await getPeerTestsForCycle(cycleId),
    };
  },


  async getPeerTestAttempts(
    testIds: string[]
  ): Promise<{ attempts: PeerTestAttempt[] }> {
    return {
      attempts:
        await getPeerTestAttemptsForTests(testIds),
    };
  },


  async getPeerTestAttemptQuestions(
    attemptId: string
  ): Promise<{ questions: PeerTestAttemptQuestion[] }> {
    const { data, error } = await supabase
      .from('peer_test_attempt_questions')
      .select('*')
      .eq('attempt_id', attemptId)
      .order('question_number', {
        ascending: true,
      });

    if (error) {
      throw error;
    }

    return {
      questions:
        (data || []) as PeerTestAttemptQuestion[],
    };
  },


  async peerTestCandidates(
    testId: string
  ): Promise<{ candidates: PeerTestCandidate[] }> {
    return invokeFunction(
      'peer-tests',
      { action: 'candidates', test_id: testId },
      'تعذر تحميل قائمة الأخوات.'
    );
  },


  async peerTestStart(
    testId: string,
    candidateId: string
  ): Promise<{
    attempt_id: string;
    candidate: { id: string; name: string };
    questions: PeerTestQuestion[];
  }> {
    return invokeFunction(
      'peer-tests',
      {
        action: 'start',
        test_id: testId,
        candidate_id: candidateId,
      },
      'تعذر بدء الاختبار.'
    );
  },


  async peerTestSubmit(payload: {
    attempt_id: string;
    errors: number[];
    question_notes: string[];
    notes?: string;
  }): Promise<{
    attempt: PeerTestAttempt;
    message: string;
  }> {
    return invokeFunction(
      'peer-tests',
      { action: 'submit', ...payload },
      'تعذر اعتماد نتيجة الاختبار.'
    );
  },


  async adminSavePeerTest(
    payload: PeerTestSaveInput
  ): Promise<{
    test: PeerTest;
    versioned: boolean;
    message: string;
  }> {
    return invokeFunction(
      'peer-tests',
      { action: 'admin-save', ...payload },
      'تعذر حفظ الاختبار.'
    );
  },


  async adminSetPeerTestStatus(
    testId: string,
    statusAction: 'show' | 'hide' | 'finish'
  ): Promise<{
    test: PeerTest;
    message: string;
  }> {
    return invokeFunction(
      'peer-tests',
      {
        action: 'admin-status',
        test_id: testId,
        status_action: statusAction,
      },
      'تعذر تحديث حالة الاختبار.'
    );
  },


  async adminPreviewPeerTest(
    testId: string
  ): Promise<{ questions: PeerTestQuestion[] }> {
    return invokeFunction(
      'peer-tests',
      { action: 'admin-preview', test_id: testId },
      'تعذر توليد عيّنة الأسئلة.'
    );
  },


  /*
   * «المراجعة البعيدة»: one manually chosen day per call (no recurrence).
   * admin-actions checks the batch; the database allows only future dates
   * and refuses a date that is a rest day.
   */
  async adminCreateDistantReview(
    batchId: string,
    payload: DistantReviewInput
  ): Promise<{ assignment: DistantReviewAssignment; message: string }> {
    return invokeFunction(
      'admin-actions',
      {
        action: 'distant-review-create',
        batch_id: requireBatchId(batchId),
        ...distantReviewBody(payload),
      },
      'تعذر إضافة يوم المراجعة البعيدة. حاولي مرة أخرى.'
    );
  },


  async adminUpdateDistantReview(
    assignmentId: string,
    payload: DistantReviewInput
  ): Promise<{ message: string }> {
    return invokeFunction(
      'admin-actions',
      {
        action: 'distant-review-update',
        assignment_id: assignmentId,
        ...distantReviewBody(payload),
      },
      'تعذر تعديل يوم المراجعة البعيدة. حاولي مرة أخرى.'
    );
  },


  async adminDeleteDistantReview(
    assignmentId: string
  ): Promise<{ message: string }> {
    return invokeFunction(
      'admin-actions',
      {
        action: 'distant-review-delete',
        assignment_id: assignmentId,
      },
      'تعذر حذف يوم المراجعة البعيدة. حاولي مرة أخرى.'
    );
  },


  /* Member: confirm one owed distant review (identity: assignment + member; idempotent). */
  async completeDistantReview(
    assignmentId: string
  ): Promise<{ message: string; already_recorded: boolean }> {
    const { data, error } = await supabase.rpc(
      'complete_distant_review',
      { p_assignment_id: assignmentId }
    );

    if (error) {
      throw new Error(
        error.message ||
          'تعذر حفظ إتمام المراجعة البعيدة. حاولي مرة أخرى.'
      );
    }

    return data?.already_recorded
      ? {
          message: 'تم تأكيد هذه المراجعة البعيدة مسبقًا.',
          already_recorded: true,
        }
      : {
          message: 'تم تسجيل إتمام المراجعة البعيدة بنجاح، تقبّل الله منكِ.',
          already_recorded: false,
        };
  },


  /*
   * Admin alerts (3+ overdue days) of the given batches, computed from each
   * batch's program state with the shared delay code. RLS returns only the
   * batches she manages, so another batch yields no data and no alert.
   */
  async getBatchAdminAlerts(
    batches: Pick<Batch, 'id' | 'name'>[]
  ): Promise<BatchAdminAlert[]> {
    const day = today();

    const lists = await Promise.all(
      batches.map(async (b) => {
        try {
          const cycle = await getActiveCycle(b.id);
          const program = await loadBatchProgram(supabase, cycle);
          const { members, delayById } = computeBatchDelays(program, day);
          return buildBatchAdminAlerts(b, members, delayById);
        } catch {
          return []; // a batch without an active cycle has no alerts
        }
      })
    );

    return lists.flat();
  },


  /* Own notification interaction state: seen / archived per notification key (RLS: own rows only). */
  async getNotificationStates(): Promise<NotificationState[]> {
    const { data, error } = await supabase
      .from('notification_states')
      .select('notification_key, kind, tone, urgent, title, body, seen_at, archived_at')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message || 'تعذر تحميل حالة التنبيهات');
    }

    return (data || []).map((r) => ({
      key: r.notification_key,
      kind: r.kind,
      tone: r.tone,
      urgent: r.urgent,
      title: r.title,
      body: r.body,
      seenAt: r.seen_at,
      archivedAt: r.archived_at,
    }));
  },


  /* Opening the panel: the visible non-urgent notifications become seen (never archived). */
  async markNotificationsSeen(
    items: NotificationSnapshot[]
  ): Promise<void> {
    if (items.length === 0) return;

    const { error } = await supabase.rpc(
      'notifications_mark_seen',
      { p_items: items }
    );

    // A display hint: the caller warns (never a console error) — e.g. a reload cutting the request.
    if (error) {
      throw new Error(error.message || 'تعذر حفظ حالة التنبيهات');
    }
  },


  /* Clicking a notification: archived (moves to «عرض كل التنبيهات»). */
  async archiveNotification(
    item: NotificationSnapshot
  ): Promise<void> {
    const { error } = await supabase.rpc(
      'notification_archive',
      { p_item: item }
    );

    if (error) {
      throw new Error(error.message || 'تعذر حفظ حالة التنبيه');
    }
  },


  /* Master admin: the batches whose serious alerts she follows (her own rows only). */
  async getNotificationFollows(): Promise<string[]> {
    const { data, error } = await supabase
      .from('admin_notification_batch_subscriptions')
      .select('batch_id')
      .eq('enabled', true);

    if (error) {
      throw new Error(error.message || 'تعذر تحميل إعدادات التنبيهات');
    }

    return (data || []).map((r) => r.batch_id as string);
  },


  async setNotificationFollow(
    batchId: string,
    enabled: boolean
  ): Promise<void> {
    const { error } = await supabase.rpc(
      'set_notification_batch_follow',
      { p_batch_id: batchId, p_enabled: enabled }
    );

    if (error) {
      throw new Error(error.message || 'تعذر حفظ إعدادات التنبيهات');
    }
  },


  async adminPeerTestImpact(
    testId: string
  ): Promise<{
    blocked_count: number;
    blocked_members: { id: string; name: string }[];
  }> {
    return invokeFunction(
      'peer-tests',
      { action: 'admin-impact', test_id: testId },
      'تعذر حساب أثر الاختبار.'
    );
  },


  async getFirestoreStatus():
    Promise<{
      projectId: string;
      databaseId: string;
      connected: boolean;
      error: string | null;
    }> {
    return {
      projectId:
        'supabase',
      databaseId:
        'postgres',
      connected:
        true,
      error:
        null,
    };
  },
};
