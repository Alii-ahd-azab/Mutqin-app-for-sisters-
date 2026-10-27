-- Mutqin for Sisters — «المراجعة البعيدة» (distant-review days). Same feature as Mutqin for Men.
--
-- An admin schedules, one date at a time, a day on which the NORMAL program does not advance (no new
-- Tasmi'a quarter, no new daily review) and every member of the batch owes one special review of an
-- explicit Quran range chosen by the admin: from the BEGINNING of quarter X to the BEGINNING of
-- quarter Y (the TO quarter is the stopping boundary, so X < Y).
--
--   * distant_review_assignments : one row per (cycle, date); no recurrence, no bulk generation.
--   * distant_review_completions : one row per (assignment, member) — the durable obligation identity.
--   * a date is EITHER a rest day OR a distant-review day, never both (guards on both tables).
--
-- The program calendar (which dates are program days) is computed by the shared TypeScript code
-- (calculateCycleInfo / getActiveCycleDates): a distant-review date is a non-program day there.
--
-- Global pause: a distant-review date that falls inside a pause (closed period, or on/after an open
-- pause) creates NO obligation (it is already a paused date).
--
-- Existing rows are not touched: no history, review, Tasmi'a, rest day or pause changes.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------
create table public.distant_review_assignments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  review_date date not null,
  start_quarter smallint not null check (start_quarter between 1 and 240),
  end_quarter smallint not null check (end_quarter between 1 and 240),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- «إلى الربع» is the stopping boundary (its beginning): it must come after «من الربع».
  constraint distant_review_assignments_range_check check (start_quarter < end_quarter),
  constraint distant_review_assignments_cycle_date_key unique (cycle_id, review_date)
);

create index distant_review_assignments_batch_date_idx on public.distant_review_assignments (batch_id, review_date);

comment on table public.distant_review_assignments is
  'المراجعة البعيدة: one manually scheduled day per (cycle, date). The date is a non-program day for the normal calendar.';

create table public.distant_review_completions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.distant_review_assignments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz not null default now(),
  -- Program date (05:00 Africa/Cairo) of the confirmation; later than the assignment date when late.
  completed_on date not null,
  member_name_snapshot text,
  constraint distant_review_completions_assignment_user_key unique (assignment_id, user_id)
);

create index distant_review_completions_user_idx on public.distant_review_completions (user_id);

alter table public.distant_review_assignments enable row level security;
alter table public.distant_review_completions enable row level security;

-- ---------------------------------------------------------------------------------------------
-- 2. One schedule type per date: rest day XOR distant-review day (same cycle)
-- ---------------------------------------------------------------------------------------------
create function app_private.distant_review_assignment_guard() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  -- Both guards take the same lock, so a rest day and a distant review cannot race onto one date.
  perform pg_advisory_xact_lock(hashtextextended('offday:' || new.cycle_id::text || ':' || new.review_date::text, 0));
  select c.batch_id into new.batch_id from public.cycles c where c.id = new.cycle_id;
  if new.batch_id is null then
    raise exception 'الدورة غير موجودة' using errcode = 'foreign_key_violation';
  end if;
  if exists (select 1 from public.group_rest_days r where r.cycle_id = new.cycle_id and r.rest_date = new.review_date) then
    raise exception 'هذا التاريخ مسجل كيوم استدراك وراحة. اختاري إما يوم راحة أو يوم مراجعة بعيدة، وليس الاثنين معًا.'
      using errcode = 'check_violation';
  end if;
  new.note := nullif(btrim(new.note), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger distant_review_assignment_guard before insert or update of cycle_id, review_date, start_quarter, end_quarter, note
  on public.distant_review_assignments for each row execute function app_private.distant_review_assignment_guard();

create function app_private.rest_day_distant_review_guard() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('offday:' || new.cycle_id::text || ':' || new.rest_date::text, 0));
  if exists (select 1 from public.distant_review_assignments d where d.cycle_id = new.cycle_id and d.review_date = new.rest_date) then
    raise exception 'هذا التاريخ مجدول كيوم مراجعة بعيدة. احذفي المراجعة البعيدة أولًا إن أردتِه يوم استدراك وراحة.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rest_day_distant_review_guard before insert or update of cycle_id, rest_date
  on public.group_rest_days for each row execute function app_private.rest_day_distant_review_guard();

-- True when the date is paused in this cycle (closed pause: paused_on .. resumed_on - 1; open
-- pause: paused_on onwards). Same rule as isPausedDate in the shared calculations.
create function app_private.is_paused_date(p_cycle_id uuid, p_date date) returns boolean
    language sql stable security definer
    set search_path to ''
    as $$
  select exists (
    select 1 from public.program_pauses p
    where p.cycle_id = p_cycle_id
      and p_date >= p.paused_on
      and (p.resumed_on is null or p_date < p.resumed_on));
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Admin management (service role: the admin-actions Edge Function checks the batch first)
-- ---------------------------------------------------------------------------------------------

-- Creates (p_assignment_id null) or edits ONE assignment of the batch's active cycle. Only future
-- dates (after the program's today) can be created, and only a still-future assignment can be
-- edited, so a day that already shaped the program or the history never changes.
create function public.distant_review_save(
  p_assignment_id uuid, p_batch_id uuid, p_review_date date, p_start_quarter integer,
  p_end_quarter integer, p_note text, p_actor uuid) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_cycle   record;
  v_today   date := app_private.program_today();
  v_current record;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_row     public.distant_review_assignments;
begin
  select c.id, c.starts_on into v_cycle
  from public.cycles c where c.batch_id = p_batch_id and c.status = 'active';
  if v_cycle.id is null then
    raise exception 'لا توجد دورة نشطة لهذه الدفعة' using errcode = 'check_violation';
  end if;
  if p_review_date is null then
    raise exception 'يرجى تحديد تاريخ المراجعة البعيدة' using errcode = 'check_violation';
  end if;
  if p_review_date <= v_today then
    raise exception 'يجب أن يكون تاريخ المراجعة البعيدة في المستقبل (بعد اليوم).' using errcode = 'check_violation';
  end if;
  if p_review_date < v_cycle.starts_on then
    raise exception 'تاريخ المراجعة البعيدة يسبق بداية الدورة الحالية.' using errcode = 'check_violation';
  end if;
  if p_start_quarter is null or p_end_quarter is null
     or p_start_quarter < 1 or p_end_quarter > 240 or p_start_quarter >= p_end_quarter then
    raise exception 'نطاق الأرباع غير صالح: «إلى الربع» هو موضع التوقف (بداية ذلك الربع)، فيجب أن يكون بعد «من الربع» وضمن 1–240.' using errcode = 'check_violation';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'الملاحظة طويلة جدًا (300 حرف كحد أقصى).' using errcode = 'check_violation';
  end if;

  if p_assignment_id is null then
    if exists (select 1 from public.distant_review_assignments d where d.cycle_id = v_cycle.id and d.review_date = p_review_date) then
      raise exception 'يوجد يوم مراجعة بعيدة مجدول في هذا التاريخ بالفعل.' using errcode = 'unique_violation';
    end if;
    insert into public.distant_review_assignments
      (cycle_id, batch_id, review_date, start_quarter, end_quarter, note, created_by, created_by_name_snapshot)
    values (v_cycle.id, p_batch_id, p_review_date, p_start_quarter, p_end_quarter, v_note, p_actor,
            (select btrim(p.full_name) from public.profiles p where p.id = p_actor))
    returning * into v_row;
  else
    select d.id, d.batch_id, d.cycle_id, d.review_date into v_current
    from public.distant_review_assignments d where d.id = p_assignment_id for update;
    if v_current.id is null or v_current.batch_id <> p_batch_id then
      raise exception 'يوم المراجعة البعيدة غير موجود' using errcode = 'P0002';
    end if;
    if v_current.cycle_id <> v_cycle.id or v_current.review_date <= v_today then
      raise exception 'لا يمكن تعديل يوم مراجعة بعيدة حلّ موعده أو مضى؛ يبقى محفوظًا في السجل.' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.distant_review_assignments d
               where d.cycle_id = v_cycle.id and d.review_date = p_review_date and d.id <> p_assignment_id) then
      raise exception 'يوجد يوم مراجعة بعيدة مجدول في هذا التاريخ بالفعل.' using errcode = 'unique_violation';
    end if;
    update public.distant_review_assignments
    set review_date = p_review_date, start_quarter = p_start_quarter, end_quarter = p_end_quarter, note = v_note
    where id = p_assignment_id
    returning * into v_row;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Deletes ONE still-future assignment (its date becomes a normal program day again).
create function public.distant_review_delete(p_assignment_id uuid, p_batch_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_row record;
begin
  select d.id, d.batch_id, d.review_date, c.status::text as cycle_status into v_row
  from public.distant_review_assignments d join public.cycles c on c.id = d.cycle_id
  where d.id = p_assignment_id for update of d;
  if v_row.id is null or v_row.batch_id <> p_batch_id then
    raise exception 'يوم المراجعة البعيدة غير موجود' using errcode = 'P0002';
  end if;
  if v_row.cycle_status <> 'active' or v_row.review_date <= app_private.program_today()
     or exists (select 1 from public.distant_review_completions x where x.assignment_id = p_assignment_id) then
    raise exception 'لا يمكن حذف يوم مراجعة بعيدة حلّ موعده أو مضى؛ يبقى محفوظًا في السجل.' using errcode = 'check_violation';
  end if;
  delete from public.distant_review_assignments where id = p_assignment_id;
  return jsonb_build_object('id', v_row.id, 'review_date', v_row.review_date);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Member completion (browser RPC; the only write path for completions)
-- ---------------------------------------------------------------------------------------------

-- The member confirms one distant review that is owed to her: its date has come (today or late),
-- it belongs to her batch's ACTIVE cycle, the date is not paused or a rest day and she had joined
-- the batch by then. Idempotent: a second confirmation returns the first one.
create function public.complete_distant_review(p_assignment_id uuid) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid      uuid := auth.uid();
  v_a        record;
  v_name     text;
  v_joined   date;
  v_row      public.distant_review_completions;
begin
  select d.id, d.batch_id, d.cycle_id, d.review_date, c.status::text as cycle_status, c.starts_on into v_a
  from public.distant_review_assignments d join public.cycles c on c.id = d.cycle_id
  where d.id = p_assignment_id;
  if v_a.id is null then
    raise exception 'يوم المراجعة البعيدة غير موجود' using errcode = 'P0002';
  end if;

  -- Join date: the Makkah calendar date of joined_at (same as joinedOnDateFromTimestamp).
  select btrim(p.full_name), (m.joined_at at time zone 'Asia/Riyadh')::date into v_name, v_joined
  from public.batch_memberships m join public.profiles p on p.id = m.user_id
  where m.user_id = v_uid and m.batch_id = v_a.batch_id and m.membership_role = 'member'
    and p.role = 'member' and p.active;
  if v_name is null then
    raise exception 'حسابكِ مُعلّق (مُقصاة) حاليًا أو لا تنتمين إلى هذه الدفعة، ولا يمكنكِ تأكيد المراجعة البعيدة.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_a.cycle_status <> 'active' then
    raise exception 'لا يمكن التسجيل في دورة مؤرشفة' using errcode = 'check_violation';
  end if;
  if v_a.review_date > app_private.program_today() then
    raise exception 'لم يحن موعد هذه المراجعة البعيدة بعد.' using errcode = 'check_violation';
  end if;
  if v_a.review_date < v_a.starts_on or app_private.is_paused_date(v_a.cycle_id, v_a.review_date)
     or exists (select 1 from public.group_rest_days r where r.cycle_id = v_a.cycle_id and r.rest_date = v_a.review_date)
     or (v_joined is not null and v_a.review_date < v_joined) then
    raise exception 'هذه المراجعة البعيدة غير مطلوبة منكِ.' using errcode = 'check_violation';
  end if;

  insert into public.distant_review_completions (assignment_id, user_id, completed_on, member_name_snapshot)
  values (p_assignment_id, v_uid, app_private.program_today(), v_name)
  on conflict (assignment_id, user_id) do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.distant_review_completions x where x.assignment_id = p_assignment_id and x.user_id = v_uid;
    return to_jsonb(v_row) || jsonb_build_object('already_recorded', true);
  end if;
  return to_jsonb(v_row) || jsonb_build_object('already_recorded', false);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 5. Access
-- ---------------------------------------------------------------------------------------------
-- Members: the assignments of their batch; admins: their managed batches. Completions: a member
-- sees her own, an admin those of her managed batches. Nobody writes directly (RPCs only).
create policy distant_review_assignments_select_accessible on public.distant_review_assignments
  for select to authenticated
  using (batch_id in (select app_private.viewable_batch_ids() as viewable_batch_ids));

create policy distant_review_completions_select_accessible on public.distant_review_completions
  for select to authenticated
  using ((user_id = (select auth.uid() as uid))
         or (assignment_id in (select d.id from public.distant_review_assignments d
                               where d.batch_id in (select app_private.managed_batch_ids() as managed_batch_ids))));

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.distant_review_assignments, public.distant_review_completions from %I', r);
      execute format('revoke all on function public.distant_review_save(uuid, uuid, date, integer, integer, text, uuid) from %I', r);
      execute format('revoke all on function public.distant_review_delete(uuid, uuid) from %I', r);
      execute format('revoke all on function public.complete_distant_review(uuid) from %I', r);
      execute format('revoke all on function app_private.is_paused_date(uuid, date) from %I', r);
      execute format('revoke all on function app_private.distant_review_assignment_guard() from %I', r);
      execute format('revoke all on function app_private.rest_day_distant_review_guard() from %I', r);
    end if;
  end loop;
end $$;
revoke all on function public.distant_review_save(uuid, uuid, date, integer, integer, text, uuid) from public;
revoke all on function public.distant_review_delete(uuid, uuid) from public;
revoke all on function public.complete_distant_review(uuid) from public;
revoke all on function app_private.is_paused_date(uuid, date) from public;
revoke all on function app_private.distant_review_assignment_guard() from public;
revoke all on function app_private.rest_day_distant_review_guard() from public;

grant select on table public.distant_review_assignments, public.distant_review_completions to authenticated;
grant execute on function public.complete_distant_review(uuid) to authenticated;

grant select, insert, update, delete on table public.distant_review_assignments, public.distant_review_completions to service_role;
grant execute on function public.distant_review_save(uuid, uuid, date, integer, integer, text, uuid) to service_role;
grant execute on function public.distant_review_delete(uuid, uuid) to service_role;
grant execute on function public.complete_distant_review(uuid) to service_role;
