export type UserRole = 'member' | 'admin';

export type MembershipRole = 'member' | 'admin';

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

export interface Batch {
  id: string;
  name: string;
  created_at: string;
  archived_at: string | null;
}

export interface BatchMembership {
  id: string;
  batch_id: string;
  user_id: string;
  membership_role: MembershipRole;
  created_at: string;
}

// Admin account as listed for master-admin permission management
export interface AdminAccount {
  user: User;
  is_master_admin: boolean;
  batch_ids: string[];
}

export type AdminType = 'master' | 'batch';

// Changes an admin may request for an existing account.
// Always applied server-side by the admin-users Edge Function.
export interface AdminAccountUpdate {
  name?: string;
  phone?: string;
  password?: string;
  role?: UserRole; // changing member <-> admin is rejected by the server
  is_active?: boolean; // false = exclude, true = reactivate
  is_master_admin?: boolean; // master admins only
  batch_ids?: string[]; // batch-admin assignments, master admins only
}

export interface NewAccountPayload {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  batch_id?: string; // required when role === 'member'
  is_master_admin?: boolean; // role === 'admin' only (master admins only)
  batch_ids?: string[]; // role === 'admin' && !is_master_admin
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

export interface RecitationLog {
  id: string;
  member_id: string;
  member_name: string;
  listener_id?: string;
  listener_name?: string;
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
  is_paused: boolean;
  paused_at?: string | null;
  is_completed: boolean;
  days_elapsed: number;
  rest_days_count: number;
  paused_days_count: number;
  start_date: string;
  current_cycle_number: number;
  today_date: string;
}

export interface MemberDailyStatus {
  user: User;
  has_recited: boolean;
  recited_quarter?: number;
  listener_name?: string;
  has_reviewed: boolean;
  revision_notes?: string;
  total_recitations: number;
  total_revisions: number;
  required_quarter: number;
  is_behind: boolean;
  missed_quarters_count: number;
  missed_revision_days_count?: number;
  is_severely_behind?: boolean;
  severe_reasons?: ('recitation' | 'revision')[];
}

export interface BatchBootstrap {
  batch: Batch;
  cycle_id: string;
  cycleInfo: CycleInfo;
  settings: GroupSettings;
  restDays: RestDay[];
  users: User[];
  recitations: RecitationLog[];
  revisions: RevisionLog[];
  todayRecitations: RecitationLog[];
  todayRevisions: RevisionLog[];
}
