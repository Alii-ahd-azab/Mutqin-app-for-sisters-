// Core program types shared by the web app (src/) and the Edge Functions.
// Pure TypeScript only: this file is bundled by both Vite and Deno.

export type UserRole = 'member' | 'admin';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  auth_uid?: string;
  is_master_admin?: boolean;
  // When this member joined her CURRENT batch (ISO timestamp).
  // Revision debt is counted from this date; Tasmi'a debt is not.
  batch_joined_at?: string;
}

export interface GroupSettings {
  id: string;
  start_date: string; // ISO date YYYY-MM-DD
  total_quarters: number; // 240
  review_window: number; // 8
  current_cycle_number: number;
  is_paused: boolean;
  paused_at: string | null; // ISO date YYYY-MM-DD
  total_paused_days: number;
  // Every pause of the cycle as dates: [from, until) — `until` is the
  // resume date (an active day again), null while still paused.
  // When present, paused DATES are excluded from program days.
  pause_periods?: { from: string; until: string | null }[];
  // «المراجعة البعيدة» dates of the cycle: non-program days for the normal calendar (like rest days).
  distant_review_dates?: string[];
  daily_thought?: string; // HTML formatted thought of the day
  daily_thought_updated_at?: string; // ISO date string
  daily_thought_updated_by?: string; // Admin display name
}

export interface RestDay {
  id: string;
  date: string; // YYYY-MM-DD
  note: string;
  added_by_admin_id: string;
  added_by_name?: string;
  created_at: string;
}

// «المراجعة البعيدة»: one manually scheduled day with an explicit Quran range (quarters).
export interface DistantReviewAssignment {
  id: string;
  batch_id: string;
  cycle_id: string;
  review_date: string; // YYYY-MM-DD
  start_quarter: number;
  end_quarter: number;
  note?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

// One member's confirmation of one assignment (identity: assignment_id + member_id).
export interface DistantReviewCompletion {
  id: string;
  assignment_id: string;
  member_id: string;
  member_name?: string;
  completed_at: string;
  completed_on: string; // YYYY-MM-DD (program date of the confirmation)
}

export interface RecitationLog {
  id: string;
  member_id: string;
  member_name: string;
  listener_id?: string;
  listener_name?: string;
  // set once the member used her one listener correction
  listener_changed_at?: string;
  quarter_number: number;
  cycle_number: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  created_at: string;
  // Legacy aliases for backwards compatibility
  reciter_id?: string;
  reciter_name?: string;
}

export interface RevisionLog {
  id: string;
  member_id: string;
  member_name: string;
  date: string; // YYYY-MM-DD
  cycle_number: number;
  review_start_quarter: number;
  review_end_quarter: number;
  notes?: string;
  created_at: string;
}

export interface CycleInfo {
  has_started: boolean;
  days_until_start: number;
  cycle_day: number; // 1 to 240 (or 0 if not started)
  quarter_of_day: number; // 1 to 240 (or 0 if not started)
  review_start: number;
  review_end: number;
  review_count: number;
  is_rest_day: boolean;
  rest_day_note?: string;
  // Today is a «المراجعة البعيدة» day (not paused): no normal progression today.
  is_distant_review_day: boolean;
  is_paused: boolean;
  paused_at?: string | null;
  is_completed: boolean;
  days_elapsed: number;
  rest_days_count: number;
  distant_review_days_count: number;
  paused_days_count: number;
  start_date: string;
  current_cycle_number: number;
  today_date: string;
}
