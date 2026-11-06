-- Mutqin for Sisters: an admin may turn TODAY into a «المراجعة البعيدة» day.
--
-- A date that is added beforehand is simply a non-program day. Added on the day itself, members may
-- already have submitted that day's NORMAL work while the day still counted as program day N+1:
-- Tasmi'a quarter N+1 and the review of program day N+1. Once the day leaves the calendar the next
-- active day becomes N+1, so those rows would satisfy it. They must stop counting, and the unique
-- keys (cycle, user, quarter / program day) must allow them to be submitted again.
--
--   * voided_daily_records: such rows are MOVED here. Every existing reader of tasmia_submissions and
--     review_confirmations (dashboards, statistics, peer tests) therefore stops counting them, the
--     unique keys are free again, and the historical fact is kept (shown in the member's history).
--   * distant_review_assignments.cancelled_program_day: the program day this conversion cancelled.
--     Null for every day that was scheduled beforehand or that fell on a rest or paused date.
--   * public.distant_review_create_today: creates the day and moves the rows in one transaction.
--     public.distant_review_save is NOT changed: future dates behave as before, and an existing
--     future day cannot be edited onto today.
--   * same_day_distant_review_guard: an app that was opened before the conversion cannot submit the
--     cancelled day's quarter or review for the rest of that program day.
--
-- The cancelled program day is computed by the admin-actions Edge Function with the shared calendar
-- (getActiveCycleDates), the single source of truth for program days.
--
-- As with every day that has arrived, the normal app can neither edit nor delete today's day
-- afterwards. Catch-up work done today (quarters and reviews of earlier days) is not touched.
--
-- No existing row changes when this migration runs.

alter table public.distant_review_assignments
  add column cancelled_program_day smallint
    check (cancelled_program_day is null or cancelled_program_day between 1 and 240);

comment on column public.distant_review_assignments.cancelled_program_day is
  'The program day cancelled when this day was added on the date itself; null when it replaced no program day.';

create table public.voided_daily_records (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.distant_review_assignments(id) on delete set null,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('tasmia', 'review')),
  original_id uuid not null,
  -- The cancelled program day (for Tasmi'a, also its quarter number).
  program_day smallint not null check (program_day between 1 and 240),
  program_date date not null,
  -- Review range (kind = 'review').
  start_quarter smallint,
  end_quarter smallint,
  -- Tasmi'a details (kind = 'tasmia').
  listener_id uuid references public.profiles(id) on delete set null,
  listener_name_snapshot text,
  listener_changed_at timestamptz,
  notes text,
  -- When the member originally recorded it.
  recorded_at timestamptz not null,
  voided_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id) on delete set null,
  constraint voided_daily_records_original_key unique (kind, original_id)
);

create index voided_daily_records_cycle_idx on public.voided_daily_records (cycle_id);
create index voided_daily_records_user_idx on public.voided_daily_records (user_id);

comment on table public.voided_daily_records is
  'Normal Tasmi''a / review rows of a program day that was cancelled the same day by a «المراجعة البعيدة» day. They do not count.';

alter table public.voided_daily_records enable row level security;

-- A member reads her own; an admin those of her managed batches. Nobody writes directly.
create policy voided_daily_records_select_accessible on public.voided_daily_records
  for select to authenticated
  using ((user_id = (select auth.uid() as uid))
         or (cycle_id in (select app_private.managed_cycle_ids() as managed_cycle_ids)));

-- The cycle's lock: submissions take it shared, a conversion exclusively, so a submission can neither
-- slip past the move nor be accepted after it.
create function app_private.same_day_distant_review_lock_key(p_cycle_id uuid) returns bigint
    language sql immutable
    set search_path to ''
    as $$ select hashtextextended('same-day-distant:' || p_cycle_id::text, 0) $$;

create function app_private.same_day_distant_review_guard() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_day integer;
begin
  perform pg_advisory_xact_lock_shared(app_private.same_day_distant_review_lock_key(new.cycle_id));

  if tg_table_name = 'tasmia_submissions' then
    v_day := new.quarter_number;
  else
    v_day := new.program_day;
  end if;

  if exists (
    select 1 from public.distant_review_assignments d
    where d.cycle_id = new.cycle_id
      and d.review_date = app_private.program_today()
      and d.cancelled_program_day is not null
      and v_day >= d.cancelled_program_day
  ) then
    raise exception 'تحوّل اليوم إلى يوم مراجعة بعيدة، ولا يوجد ورد يومي جديد اليوم. يرجى تحديث الصفحة.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger same_day_distant_review_guard before insert on public.tasmia_submissions
  for each row execute function app_private.same_day_distant_review_guard();
create trigger same_day_distant_review_guard before insert on public.review_confirmations
  for each row execute function app_private.same_day_distant_review_guard();

-- Service role (admin-actions checks the batch and computes p_cancelled_program_day: the date's
-- program day before the conversion, null when today is not an active program day).
create function public.distant_review_create_today(
  p_batch_id uuid, p_review_date date, p_start_quarter integer, p_end_quarter integer,
  p_note text, p_cancelled_program_day integer, p_actor uuid) returns jsonb
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_cycle  record;
  v_today  date := app_private.program_today();
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_row    public.distant_review_assignments;
  v_tasmia integer := 0;
  v_review integer := 0;
begin
  select c.id, c.starts_on into v_cycle
  from public.cycles c where c.batch_id = p_batch_id and c.status = 'active';
  if v_cycle.id is null then
    raise exception 'لا توجد دورة نشطة لهذه الدفعة' using errcode = 'check_violation';
  end if;
  if p_review_date is distinct from v_today then
    raise exception 'تغيّر يوم البرنامج. يرجى تحديث الصفحة وإعادة المحاولة.' using errcode = 'check_violation';
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
  if p_cancelled_program_day is not null and p_cancelled_program_day not between 1 and 240 then
    raise exception 'يوم البرنامج غير صالح' using errcode = 'check_violation';
  end if;

  -- Waits for submissions in progress; new ones wait for this transaction, then see the day.
  perform pg_advisory_xact_lock(app_private.same_day_distant_review_lock_key(v_cycle.id));

  if exists (select 1 from public.distant_review_assignments d where d.cycle_id = v_cycle.id and d.review_date = p_review_date) then
    raise exception 'يوجد يوم مراجعة بعيدة مجدول في هذا التاريخ بالفعل.' using errcode = 'unique_violation';
  end if;

  insert into public.distant_review_assignments
    (cycle_id, batch_id, review_date, start_quarter, end_quarter, note, created_by, created_by_name_snapshot, cancelled_program_day)
  values (v_cycle.id, p_batch_id, p_review_date, p_start_quarter, p_end_quarter, v_note, p_actor,
          (select btrim(p.full_name) from public.profiles p where p.id = p_actor), p_cancelled_program_day)
  returning * into v_row;

  if p_cancelled_program_day is not null then
    with moved as (
      delete from public.tasmia_submissions t
      where t.cycle_id = v_cycle.id and t.quarter_number = p_cancelled_program_day
      returning t.*
    ), archived as (
      insert into public.voided_daily_records
        (assignment_id, cycle_id, user_id, kind, original_id, program_day, program_date,
         listener_id, listener_name_snapshot, listener_changed_at, notes, recorded_at, voided_by)
      select v_row.id, m.cycle_id, m.user_id, 'tasmia', m.id, m.quarter_number, p_review_date,
             m.listener_id, m.listener_name_snapshot, m.listener_changed_at, m.notes, m.submitted_at, p_actor
      from moved m
      returning 1
    )
    select count(*) into v_tasmia from archived;

    with moved as (
      delete from public.review_confirmations r
      where r.cycle_id = v_cycle.id and r.program_day = p_cancelled_program_day
      returning r.*
    ), archived as (
      insert into public.voided_daily_records
        (assignment_id, cycle_id, user_id, kind, original_id, program_day, program_date,
         start_quarter, end_quarter, recorded_at, voided_by)
      select v_row.id, m.cycle_id, m.user_id, 'review', m.id, m.program_day, p_review_date,
             m.start_quarter, m.end_quarter, m.confirmed_at, p_actor
      from moved m
      returning 1
    )
    select count(*) into v_review from archived;
  end if;

  return jsonb_build_object('assignment', to_jsonb(v_row), 'voided_tasmia', v_tasmia, 'voided_reviews', v_review);
end;
$$;

do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'app_private.same_day_distant_review_lock_key(uuid)',
    'app_private.same_day_distant_review_guard()',
    'public.distant_review_create_today(uuid, date, integer, integer, text, integer, uuid)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.voided_daily_records from %I', r);
    end if;
  end loop;
end;
$$;
revoke all on table public.voided_daily_records from public;

grant select on table public.voided_daily_records to authenticated;
grant select, insert, update, delete on table public.voided_daily_records to service_role;
grant execute on function public.distant_review_create_today(uuid, date, integer, integer, text, integer, uuid) to service_role;
