// Delay status of every active member of one batch's ACTIVE cycle on a program date, with the SAME
// shared code as the dashboards (calculateCycleInfo, getActiveCycleDates, computeMemberDelayStatus).
// Used by the peer-tests Edge Function (service role) and by the admins' serious alerts in the web
// app (the user's own session: RLS returns only batches she manages, so another batch yields no
// rows and no alert). Pure TypeScript (bundled by Vite and Deno); the database client is passed in.

import { calculateCycleInfo, getActiveCycleDates, joinedOnDateFromTimestamp } from './calculations.ts';
import { computeMemberDelayStatus, type MemberDelayStatus } from './memberDelayStatus.ts';
import { buildProgramSettings, revisionDateForProgramDay } from './programState.ts';
import type { CycleInfo, GroupSettings, RestDay } from './programTypes.ts';

export interface BatchProgramCycle {
  id: string;
  batch_id: string;
  cycle_number: number;
  starts_on: string;
}

export interface BatchProgramMember {
  id: string;
  name: string;
  phone: string;
  joined_at: string;
}

export interface BatchProgram {
  cycle: BatchProgramCycle;
  settings: GroupSettings;
  restDays: RestDay[];
  /** Active members of the batch (membership role 'member'). */
  members: BatchProgramMember[];
  tasmia: { user_id: string; quarter_number: number }[];
  reviews: { user_id: string; program_day: number; confirmed_at: string }[];
}

export interface BatchDelays {
  cycleInfo: CycleInfo;
  activeDates: string[];
  members: BatchProgramMember[];
  delayById: Map<string, MemberDelayStatus>;
}

// Minimal structural type of a supabase-js client (anon session or service role).
// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any };

const PAGE = 1000;

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Everything the delay status of one cycle's members needs. */
export async function loadBatchProgram(db: Db, cycle: BatchProgramCycle): Promise<BatchProgram> {
  const [pausesRes, restRes, distantRes, membershipsRes] = await Promise.all([
    db.from('program_pauses').select('paused_on, resumed_on').eq('cycle_id', cycle.id),
    db.from('group_rest_days').select('id, rest_date, reason, created_at').eq('cycle_id', cycle.id),
    db.from('distant_review_assignments').select('review_date').eq('cycle_id', cycle.id),
    db
      .from('batch_memberships')
      .select('user_id, joined_at, profile:profiles!batch_memberships_user_id_fkey(id, full_name, phone, role, active)')
      .eq('batch_id', cycle.batch_id)
      .eq('membership_role', 'member'),
  ]);
  for (const r of [pausesRes, restRes, distantRes, membershipsRes]) {
    if (r.error) throw new Error(r.error.message);
  }

  const [tasmia, reviews] = await Promise.all([
    fetchAll<{ user_id: string; quarter_number: number }>((from, to) =>
      db.from('tasmia_submissions').select('user_id, quarter_number').eq('cycle_id', cycle.id).order('id').range(from, to)
    ),
    fetchAll<{ user_id: string; program_day: number; confirmed_at: string }>((from, to) =>
      db.from('review_confirmations').select('user_id, program_day, confirmed_at').eq('cycle_id', cycle.id).order('id').range(from, to)
    ),
  ]);

  const settings = buildProgramSettings(
    cycle,
    pausesRes.data || [],
    ((distantRes.data || []) as { review_date: string }[]).map((r) => r.review_date)
  );
  const restDays: RestDay[] = ((restRes.data || []) as { id: string; rest_date: string; reason: string | null; created_at: string }[]).map((r) => ({
    id: r.id,
    date: r.rest_date,
    note: r.reason || '',
    added_by_admin_id: '',
    created_at: r.created_at,
  }));

  const members: BatchProgramMember[] = [];
  for (const row of (membershipsRes.data || []) as {
    user_id: string;
    joined_at: string;
    profile: { id: string; full_name: string; phone: string; role: string; active: boolean } | null;
  }[]) {
    if (row.profile && row.profile.role === 'member' && row.profile.active) {
      members.push({ id: row.profile.id, name: row.profile.full_name, phone: row.profile.phone, joined_at: row.joined_at });
    }
  }

  return { cycle, settings, restDays, members, tasmia, reviews };
}

export function computeBatchDelays(program: BatchProgram, today: string): BatchDelays {
  const cycleInfo = calculateCycleInfo(program.settings, program.restDays, today);
  const activeDates = getActiveCycleDates(program.cycle.starts_on, today, program.restDays, program.settings);

  const recitations = program.tasmia.map((r) => ({ member_id: r.user_id, quarter_number: r.quarter_number }));
  const revisions = program.reviews.map((r) => ({
    member_id: r.user_id,
    date: revisionDateForProgramDay(activeDates, r.program_day, r.confirmed_at),
  }));

  return {
    cycleInfo,
    activeDates,
    members: program.members,
    delayById: computeMembersDelays(program.members, cycleInfo, activeDates, recitations, revisions, today),
  };
}

/** Delay status per member from already-mapped logs (a dashboard's loaded data). */
export function computeMembersDelays(
  members: { id: string; joined_at?: string }[],
  cycleInfo: CycleInfo,
  activeDates: string[],
  recitations: { member_id?: string; reciter_id?: string; quarter_number: number }[],
  revisions: { member_id: string; date: string }[],
  today: string
): Map<string, MemberDelayStatus> {
  const delayById = new Map<string, MemberDelayStatus>();
  for (const m of members) {
    delayById.set(
      m.id,
      computeMemberDelayStatus({
        memberId: m.id,
        quarterOfDay: cycleInfo.quarter_of_day,
        activeCycleDates: activeDates,
        recitations,
        revisions,
        todayDate: today,
        joinedOnDate: joinedOnDateFromTimestamp(m.joined_at),
      })
    );
  }
  return delayById;
}
