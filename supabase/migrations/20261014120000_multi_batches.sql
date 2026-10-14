-- =====================================================================
-- MULTIPLE INDEPENDENT BATCHES (دفعات)
-- =====================================================================
--
-- What this migration does:
--
--   1. Adds profiles.is_master_admin.
--   2. Creates batches + batch_memberships.
--   3. Connects cycles and daily_thoughts to a batch.
--      (rest days, pauses, recitations and revisions are already scoped
--       by cycle_id, so their batch is derived through the cycle.)
--   4. Moves ALL existing data into "الدفعة الأولى":
--        - every existing cycle (active + archived) and daily thought
--        - every existing member (active AND excluded) gets a membership
--        - every existing admin becomes a MASTER admin
--      Nothing is deleted, reset or renumbered. All UUIDs are preserved.
--   5. Replaces the global "one active cycle" rule with
--      "at most one active cycle PER BATCH".
--   6. Adds database-level guards (one batch per member, same-batch
--      listeners, no cross-batch writes).
--   7. Adds transactional server-only RPCs used by the Edge Functions.
--   8. Rebuilds Row Level Security so batches are actually isolated.
--
-- Atomicity:
--   Do NOT add BEGIN/COMMIT. `supabase db push` runs each migration file
--   in a transaction, and the Supabase SQL Editor runs a multi-statement
--   script as one implicit transaction. Either way, if any statement
--   fails, NOTHING is applied.
--
-- Take a backup before running this on production.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PROFILES: master admin flag
-- ---------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_master_admin boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_master_admin_requires_admin_role'
  ) then
    alter table public.profiles
      add constraint profiles_master_admin_requires_admin_role
      check (not is_master_admin or role = 'admin');
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 2. BATCHES + MEMBERSHIPS
-- ---------------------------------------------------------------------

create table if not exists public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  archived_at timestamptz,
  constraint batches_name_not_blank check (length(btrim(name)) > 0),
  constraint batches_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create unique index if not exists batches_name_unique_idx
  on public.batches (lower(btrim(name)));

create table if not exists public.batch_memberships (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null,
  user_id         uuid not null,
  membership_role text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  constraint batch_memberships_batch_id_fkey
    foreign key (batch_id) references public.batches (id) on delete cascade,
  -- Deleting a user (auth.users -> profiles cascade) removes memberships.
  constraint batch_memberships_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint batch_memberships_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint batch_memberships_role_check
    check (membership_role in ('member', 'admin')),
  constraint batch_memberships_batch_user_key
    unique (batch_id, user_id)
);

-- A MEMBER can belong to EXACTLY ONE batch (database-enforced).
create unique index if not exists batch_memberships_one_batch_per_member_idx
  on public.batch_memberships (user_id)
  where membership_role = 'member';

create index if not exists batch_memberships_user_id_idx
  on public.batch_memberships (user_id);

create index if not exists batch_memberships_batch_role_idx
  on public.batch_memberships (batch_id, membership_role);


-- ---------------------------------------------------------------------
-- 3. NEW BATCH COLUMNS (nullable until backfilled)
-- ---------------------------------------------------------------------

alter table public.cycles
  add column if not exists batch_id uuid;

alter table public.daily_thoughts
  add column if not exists batch_id uuid;


-- ---------------------------------------------------------------------
-- 4. MIGRATE ALL EXISTING DATA INTO "الدفعة الأولى"
-- ---------------------------------------------------------------------

do $$
declare
  v_batch_id uuid;
  v_owner    uuid;
begin
  select id into v_owner
  from public.profiles
  where role = 'admin'
  order by created_at asc
  limit 1;

  select id into v_batch_id
  from public.batches
  where lower(btrim(name)) = lower('الدفعة الأولى');

  if v_batch_id is null then
    insert into public.batches (name, created_by, created_at)
    values (
      'الدفعة الأولى',
      v_owner,
      coalesce((select min(created_at) from public.cycles), now())
    )
    returning id into v_batch_id;
  end if;

  -- All cycles (active + archived) and therefore all their rest days,
  -- pauses, recitations and revisions now belong to Batch 1.
  update public.cycles
  set batch_id = v_batch_id
  where batch_id is null;

  -- Daily thought history (published and unpublished) belongs to Batch 1.
  update public.daily_thoughts
  set batch_id = v_batch_id
  where batch_id is null;

  -- Every current admin keeps full access as a MASTER admin.
  update public.profiles
  set is_master_admin = true
  where role = 'admin'
    and not is_master_admin;

  -- Every existing member (active and excluded) joins Batch 1.
  insert into public.batch_memberships (batch_id, user_id, membership_role, created_at)
  select v_batch_id, p.id, 'member', p.created_at
  from public.profiles p
  where p.role = 'member'
    and not exists (
      select 1 from public.batch_memberships m
      where m.user_id = p.id
        and m.membership_role = 'member'
    );

  -- Fresh install only: the old app created Cycle 1 on the first admin
  -- load. That client-side insert is gone, so do it here if no cycle
  -- exists at all. Existing installs are untouched.
  if not exists (select 1 from public.cycles) then
    insert into public.cycles (batch_id, cycle_number, name, starts_on, status, created_by)
    values (v_batch_id, 1, 'الدورة 1', current_date, 'active', v_owner);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 5. CYCLES: batch ownership + per-batch invariants
-- ---------------------------------------------------------------------

alter table public.cycles
  alter column batch_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cycles'::regclass
      and conname = 'cycles_batch_id_fkey'
  ) then
    alter table public.cycles
      add constraint cycles_batch_id_fkey
      foreign key (batch_id) references public.batches (id) on delete restrict;
  end if;
end $$;

-- Remove the old GLOBAL uniqueness rules on cycles (e.g. a global
-- "only one active cycle" index or a global unique cycle_number).
-- They would stop a second batch from having its own Cycle 1 / its own
-- active cycle. Only unique rules that do NOT involve batch_id are
-- dropped; the primary key is never touched.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.cycles'::regclass
      and c.contype = 'u'
      and not exists (
        select 1
        from unnest(c.conkey) as k(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid and a.attnum = k.attnum
        where a.attname = 'batch_id'
      )
  loop
    raise notice 'Dropping global unique constraint on cycles: %', r.conname;
    execute format('alter table public.cycles drop constraint %I', r.conname);
  end loop;

  for r in
    select i.indexrelid::regclass::text as index_name
    from pg_index i
    where i.indrelid = 'public.cycles'::regclass
      and i.indisunique
      and not i.indisprimary
      and not exists (
        select 1 from pg_constraint c where c.conindid = i.indexrelid
      )
      and not exists (
        select 1
        from unnest(i.indkey::int2[]) as k(attnum)
        join pg_attribute a
          on a.attrelid = i.indrelid and a.attnum = k.attnum
        where a.attname = 'batch_id'
      )
  loop
    raise notice 'Dropping global unique index on cycles: %', r.index_name;
    execute format('drop index %s', r.index_name);
  end loop;
end $$;

-- Cycle numbers are unique WITHIN a batch.
create unique index if not exists cycles_batch_cycle_number_key
  on public.cycles (batch_id, cycle_number);

-- AT MOST ONE ACTIVE CYCLE PER BATCH.
create unique index if not exists cycles_one_active_per_batch_idx
  on public.cycles (batch_id)
  where status = 'active';

create index if not exists cycles_batch_status_idx
  on public.cycles (batch_id, status);


-- ---------------------------------------------------------------------
-- 6. DAILY THOUGHTS: batch-specific
-- ---------------------------------------------------------------------

alter table public.daily_thoughts
  alter column batch_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.daily_thoughts'::regclass
      and conname = 'daily_thoughts_batch_id_fkey'
  ) then
    alter table public.daily_thoughts
      add constraint daily_thoughts_batch_id_fkey
      foreign key (batch_id) references public.batches (id) on delete restrict;
  end if;
end $$;

create index if not exists daily_thoughts_batch_published_idx
  on public.daily_thoughts (batch_id, is_published, published_at desc);


-- ---------------------------------------------------------------------
-- 7. HISTORY INDEXES (cycle-scoped queries)
-- ---------------------------------------------------------------------

create index if not exists tasmia_submissions_cycle_submitted_idx
  on public.tasmia_submissions (cycle_id, submitted_at);

create index if not exists review_confirmations_cycle_day_idx
  on public.review_confirmations (cycle_id, program_day);

-- group_rest_days (rest_days_cycle_date_idx) and program_pauses
-- (program_pauses_cycle_idx) are already indexed by cycle_id.


-- ---------------------------------------------------------------------
-- 8. PRIVATE HELPER FUNCTIONS (used by RLS policies)
-- ---------------------------------------------------------------------
--
-- Lives in a schema that PostgREST does NOT expose. SECURITY DEFINER
-- functions read the tables as their owner, so policies that call them
-- never recurse into RLS. search_path is empty; every name is qualified.

create schema if not exists app_private;

revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

-- Caller is an active master admin.
create or replace function app_private.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_master_admin
      and p.active
  );
$$;

-- The single batch of the calling (active) member, or null.
create or replace function app_private.member_batch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.batch_id
  from public.batch_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.membership_role = 'member'
    and p.role = 'member'
    and p.active
  limit 1;
$$;

-- Batches the caller may MANAGE: all for a master admin, assigned ones
-- for an active batch admin, none for members.
create or replace function app_private.managed_batch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
  from public.batches b
  where app_private.is_master_admin()
  union
  select m.batch_id
  from public.batch_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
    and m.membership_role = 'admin'
    and p.role = 'admin'
    and p.active;
$$;

-- Batches the caller may VIEW: managed batches + own member batch.
create or replace function app_private.viewable_batch_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.managed_batch_ids()
  union
  select app_private.member_batch_id()
  where app_private.member_batch_id() is not null;
$$;

create or replace function app_private.managed_cycle_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.cycles c
  where c.batch_id in (select app_private.managed_batch_ids());
$$;

-- The active cycle of the calling member's batch, or null.
-- Members only ever see their batch's ACTIVE cycle (as before batches).
create or replace function app_private.member_active_cycle_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.cycles c
  where c.batch_id = app_private.member_batch_id()
    and c.status = 'active'
  limit 1;
$$;

-- Profiles the caller may see:
--   - master admin: everyone
--   - batch admin: everyone in the batches they manage (incl. excluded)
--   - member: ACTIVE members/admins of her own batch (excluded members
--     were never visible to members, and still are not)
--   - everyone with a batch: active master admins (shown as authors of
--     daily thoughts / rest days)
create or replace function app_private.viewable_profile_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where app_private.is_master_admin()
  union
  select m.user_id
  from public.batch_memberships m
  where m.batch_id in (select app_private.managed_batch_ids())
  union
  select m.user_id
  from public.batch_memberships m
  join public.profiles p on p.id = m.user_id
  where m.batch_id = app_private.member_batch_id()
    and p.active
  union
  select p.id
  from public.profiles p
  where p.role = 'admin'
    and p.is_master_admin
    and p.active
    and exists (select 1 from app_private.viewable_batch_ids());
$$;

create or replace function app_private.cycle_batch_id(p_cycle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.batch_id from public.cycles c where c.id = p_cycle_id;
$$;

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 9. INTEGRITY TRIGGERS
-- ---------------------------------------------------------------------

-- Membership rows must match the account type, and members cannot be
-- moved between batches (member transfer is intentionally not supported).
create or replace function app_private.batch_memberships_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role   text;
  v_master boolean;
begin
  if tg_op = 'UPDATE'
     and old.membership_role = 'member'
     and (
       new.user_id is distinct from old.user_id
       or new.batch_id is distinct from old.batch_id
       or new.membership_role is distinct from old.membership_role
     ) then
    raise exception 'لا يمكن نقل العضوة إلى دفعة أخرى حالياً'
      using errcode = 'check_violation';
  end if;

  select p.role::text, p.is_master_admin
  into v_role, v_master
  from public.profiles p
  where p.id = new.user_id;

  if v_role is null then
    raise exception 'الحساب غير موجود'
      using errcode = 'foreign_key_violation';
  end if;

  if new.membership_role = 'member' and v_role <> 'member' then
    raise exception 'عضوية الدفعة كعضوة متاحة لحسابات العضوات فقط'
      using errcode = 'check_violation';
  end if;

  if new.membership_role = 'admin' and (v_role <> 'admin' or v_master) then
    raise exception 'تعيين الدفعات متاح لمشرفات الدفعات فقط'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists batch_memberships_guard on public.batch_memberships;
create trigger batch_memberships_guard
  before insert or update of batch_id, user_id, membership_role on public.batch_memberships
  for each row execute function app_private.batch_memberships_guard();

-- Keep profiles consistent with their memberships.
create or replace function app_private.profiles_batch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role::text is distinct from old.role::text
     and exists (select 1 from public.batch_memberships m where m.user_id = new.id) then
    raise exception 'لا يمكن تغيير نوع حساب مرتبط بدفعة'
      using errcode = 'check_violation';
  end if;

  -- A master admin manages every batch; explicit assignments are redundant.
  if new.is_master_admin and not old.is_master_admin then
    delete from public.batch_memberships m
    where m.user_id = new.id
      and m.membership_role = 'admin';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_batch_guard on public.profiles;
create trigger profiles_batch_guard
  before update of role, is_master_admin on public.profiles
  for each row execute function app_private.profiles_batch_guard();

-- Tasmi'a: active cycle, reciter belongs to the cycle's batch, listener is
-- ANOTHER ACTIVE MEMBER OF THE SAME BATCH. INSERT only: historical rows
-- are never re-validated, and FK actions (e.g. ON DELETE SET NULL when an
-- account is deleted) are not blocked. Clients cannot UPDATE these rows.
create or replace function app_private.tasmia_batch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_status   text;
begin
  select c.batch_id, c.status::text
  into v_batch_id, v_status
  from public.cycles c
  where c.id = new.cycle_id;

  if v_batch_id is null then
    raise exception 'الدورة غير موجودة'
      using errcode = 'foreign_key_violation';
  end if;

  if v_status <> 'active' then
    raise exception 'لا يمكن التسجيل في دورة مؤرشفة'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.batch_memberships m
    where m.user_id = new.user_id
      and m.batch_id = v_batch_id
      and m.membership_role = 'member'
  ) then
    raise exception 'العضوة لا تنتمي إلى هذه الدفعة'
      using errcode = 'check_violation';
  end if;

  if new.listener_id is null then
    raise exception 'يجب اختيار الأخت المستمعة'
      using errcode = 'check_violation';
  end if;

  if new.listener_id = new.user_id then
    raise exception 'لا يمكن اختيار نفسكِ كمستمعة'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.batch_memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = new.listener_id
      and m.batch_id = v_batch_id
      and m.membership_role = 'member'
      and p.role = 'member'
      and p.active
  ) then
    raise exception 'المستمعة يجب أن تكون عضوة نشطة من نفس الدفعة'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists tasmia_batch_guard on public.tasmia_submissions;
create trigger tasmia_batch_guard
  before insert on public.tasmia_submissions
  for each row execute function app_private.tasmia_batch_guard();

-- Revision confirmations: active cycle of the member's own batch.
create or replace function app_private.review_batch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id uuid;
  v_status   text;
begin
  select c.batch_id, c.status::text
  into v_batch_id, v_status
  from public.cycles c
  where c.id = new.cycle_id;

  if v_batch_id is null then
    raise exception 'الدورة غير موجودة'
      using errcode = 'foreign_key_violation';
  end if;

  if v_status <> 'active' then
    raise exception 'لا يمكن التسجيل في دورة مؤرشفة'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.batch_memberships m
    where m.user_id = new.user_id
      and m.batch_id = v_batch_id
      and m.membership_role = 'member'
  ) then
    raise exception 'العضوة لا تنتمي إلى هذه الدفعة'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists review_batch_guard on public.review_confirmations;
create trigger review_batch_guard
  before insert on public.review_confirmations
  for each row execute function app_private.review_batch_guard();

-- Trigger functions are never called directly.
revoke all on function app_private.batch_memberships_guard() from public, anon, authenticated;
revoke all on function app_private.profiles_batch_guard() from public, anon, authenticated;
revoke all on function app_private.tasmia_batch_guard() from public, anon, authenticated;
revoke all on function app_private.review_batch_guard() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 10. TRANSACTIONAL SERVER-ONLY RPCs
-- ---------------------------------------------------------------------
--
-- Callable ONLY with the service role (from Edge Functions), which check
-- the caller's permissions first. Each runs in a single transaction.

-- Create a batch together with its Cycle 1.
create or replace function public.create_batch_with_cycle(
  p_name       text,
  p_start_date date,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.batches;
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'اسم الدفعة مطلوب' using errcode = 'check_violation';
  end if;

  if p_start_date is null then
    raise exception 'تاريخ البداية مطلوب' using errcode = 'check_violation';
  end if;

  insert into public.batches (name, created_by)
  values (btrim(p_name), p_actor)
  returning * into v_batch;

  insert into public.cycles (batch_id, cycle_number, name, starts_on, status, created_by)
  values (v_batch.id, 1, 'الدورة 1', p_start_date, 'active', p_actor);

  return jsonb_build_object(
    'id', v_batch.id,
    'name', v_batch.name,
    'created_at', v_batch.created_at,
    'archived_at', v_batch.archived_at
  );
end;
$$;

-- Archive ONE batch's active cycle and start the next one.
-- Other batches are never touched. Nothing is deleted.
create or replace function public.start_next_cycle(
  p_batch_id          uuid,
  p_today             date,
  p_actor             uuid,
  p_expected_cycle_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.cycles;
  v_new     public.cycles;
  v_next    integer;
begin
  -- Serialize concurrent resets of the same batch.
  perform 1
  from public.batches b
  where b.id = p_batch_id
    and b.archived_at is null
  for update;

  if not found then
    raise exception 'الدفعة غير موجودة' using errcode = 'no_data_found';
  end if;

  select c.* into v_current
  from public.cycles c
  where c.batch_id = p_batch_id
    and c.status = 'active'
  order by c.cycle_number desc
  limit 1
  for update;

  -- The cycle the admin was looking at must belong to THIS batch and
  -- still be its active cycle.
  if p_expected_cycle_id is not null
     and (v_current.id is null or v_current.id <> p_expected_cycle_id) then
    raise exception 'تغيّرت الدورة الحالية لهذه الدفعة. يرجى تحديث الصفحة والمحاولة مرة أخرى'
      using errcode = 'check_violation';
  end if;

  if v_current.id is not null then
    -- 1. Close an open pause so the archived history is complete.
    update public.program_pauses
    set resumed_on = p_today
    where cycle_id = v_current.id
      and resumed_on is null;

    -- 2. Archive the current cycle (its logs stay attached to it).
    update public.cycles
    set status = 'archived',
        ended_on = p_today
    where id = v_current.id;

    -- 3. Unpublish this batch's current daily thought (kept as history).
    update public.daily_thoughts
    set is_published = false
    where batch_id = p_batch_id
      and is_published;
  end if;

  select coalesce(max(c.cycle_number), 0) + 1
  into v_next
  from public.cycles c
  where c.batch_id = p_batch_id;

  -- 4. Create the new active cycle.
  insert into public.cycles (batch_id, cycle_number, name, starts_on, status, created_by)
  values (p_batch_id, v_next, 'الدورة ' || v_next, p_today, 'active', p_actor)
  returning * into v_new;

  return jsonb_build_object(
    'previous_cycle_id', v_current.id,
    'previous_cycle_number', v_current.cycle_number,
    'cycle', to_jsonb(v_new)
  );
end;
$$;

-- Create the application profile and its batch membership(s) atomically.
-- (The Auth user is created first by the Edge Function, which deletes it
-- again if this function fails.)
create or replace function public.create_profile_with_membership(
  p_id               uuid,
  p_full_name        text,
  p_phone            text,
  p_role             text,
  p_is_master_admin  boolean,
  p_member_batch_id  uuid,
  p_admin_batch_ids  uuid[],
  p_actor            uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_master boolean := (p_role = 'admin' and coalesce(p_is_master_admin, false));
begin
  if p_role not in ('member', 'admin') then
    raise exception 'الدور غير صالح' using errcode = 'check_violation';
  end if;

  if p_role = 'member' and p_member_batch_id is null then
    raise exception 'يرجى اختيار دفعة العضوة' using errcode = 'check_violation';
  end if;

  if p_role = 'admin'
     and not v_is_master
     and coalesce(array_length(p_admin_batch_ids, 1), 0) = 0 then
    raise exception 'يرجى اختيار دفعة واحدة على الأقل لمشرفة الدفعة'
      using errcode = 'check_violation';
  end if;

  -- The role is inlined as a literal so this works whether
  -- profiles.role is text or an enum.
  execute format(
    'insert into public.profiles (id, full_name, phone, role, active, is_master_admin)
     values ($1, $2, $3, %L, true, $4)',
    p_role
  )
  using p_id, btrim(p_full_name), p_phone, v_is_master;

  if p_role = 'member' then
    insert into public.batch_memberships (batch_id, user_id, membership_role, created_by)
    values (p_member_batch_id, p_id, 'member', p_actor);
  elsif not v_is_master then
    insert into public.batch_memberships (batch_id, user_id, membership_role, created_by)
    select distinct b.batch_id, p_id, 'admin', p_actor
    from unnest(p_admin_batch_ids) as b(batch_id);
  end if;
end;
$$;

-- Replace a batch admin's assigned batches atomically.
create or replace function public.set_admin_batches(
  p_user_id   uuid,
  p_batch_ids uuid[],
  p_actor     uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_batch_ids, 1), 0) = 0 then
    raise exception 'يرجى اختيار دفعة واحدة على الأقل'
      using errcode = 'check_violation';
  end if;

  delete from public.batch_memberships m
  where m.user_id = p_user_id
    and m.membership_role = 'admin'
    and not (m.batch_id = any (p_batch_ids));

  insert into public.batch_memberships (batch_id, user_id, membership_role, created_by)
  select distinct b.batch_id, p_user_id, 'admin', p_actor
  from unnest(p_batch_ids) as b(batch_id)
  on conflict (batch_id, user_id) do nothing;
end;
$$;

revoke all on function public.create_batch_with_cycle(text, date, uuid)
  from public, anon, authenticated;
revoke all on function public.start_next_cycle(uuid, date, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_profile_with_membership(uuid, text, text, text, boolean, uuid, uuid[], uuid)
  from public, anon, authenticated;
revoke all on function public.set_admin_batches(uuid, uuid[], uuid)
  from public, anon, authenticated;

grant execute on function public.create_batch_with_cycle(text, date, uuid) to service_role;
grant execute on function public.start_next_cycle(uuid, date, uuid, uuid) to service_role;
grant execute on function public.create_profile_with_membership(uuid, text, text, text, boolean, uuid, uuid[], uuid) to service_role;
grant execute on function public.set_admin_batches(uuid, uuid[], uuid) to service_role;


-- ---------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
--
-- Existing policies on the program tables assumed one global program.
-- They are replaced by the batch-aware set below.

do $$
declare
  r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'batches',
        'batch_memberships',
        'cycles',
        'group_rest_days',
        'program_pauses',
        'daily_thoughts',
        'tasmia_submissions',
        'review_confirmations'
      )
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.profiles             enable row level security;
alter table public.batches              enable row level security;
alter table public.batch_memberships    enable row level security;
alter table public.cycles               enable row level security;
alter table public.group_rest_days      enable row level security;
alter table public.program_pauses       enable row level security;
alter table public.daily_thoughts       enable row level security;
alter table public.tasmia_submissions   enable row level security;
alter table public.review_confirmations enable row level security;

-- Table privileges: clients only get what the app needs. Everything
-- privileged goes through Edge Functions (service role).
revoke all on public.batches, public.batch_memberships from anon;
revoke insert, update, delete on public.batches, public.batch_memberships from authenticated;
grant select on public.batches, public.batch_memberships to authenticated;

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, delete on public.cycles from anon, authenticated;

-- Admins may only change a cycle's start date from the browser.
revoke update on public.cycles from anon, authenticated;
grant update (starts_on) on public.cycles to authenticated;

-- Pauses: insert a pause, or set resumed_on to resume.
revoke update on public.program_pauses from anon, authenticated;
grant update (resumed_on) on public.program_pauses to authenticated;

-- Daily thoughts: publish (insert) or unpublish (is_published).
revoke update on public.daily_thoughts from anon, authenticated;
grant update (is_published) on public.daily_thoughts to authenticated;

-- Members never edit or delete logged recitations / revisions.
revoke update, delete on public.tasmia_submissions from anon, authenticated;
revoke update, delete on public.review_confirmations from anon, authenticated;

-- profiles --------------------------------------------------------------
create policy profiles_select_visible
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select app_private.viewable_profile_ids())
  );

-- batches ---------------------------------------------------------------
create policy batches_select_accessible
  on public.batches for select to authenticated
  using (id in (select app_private.viewable_batch_ids()));

-- batch_memberships -----------------------------------------------------
create policy batch_memberships_select_accessible
  on public.batch_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or batch_id in (select app_private.viewable_batch_ids())
  );

-- cycles ----------------------------------------------------------------
create policy cycles_select_accessible
  on public.cycles for select to authenticated
  using (
    batch_id in (select app_private.managed_batch_ids())
    or id = (select app_private.member_active_cycle_id())
  );

create policy cycles_update_managed
  on public.cycles for update to authenticated
  using (batch_id in (select app_private.managed_batch_ids()))
  with check (batch_id in (select app_private.managed_batch_ids()));

-- group_rest_days -------------------------------------------------------
create policy group_rest_days_select_accessible
  on public.group_rest_days for select to authenticated
  using (
    cycle_id in (select app_private.managed_cycle_ids())
    or cycle_id = (select app_private.member_active_cycle_id())
  );

create policy group_rest_days_insert_managed
  on public.group_rest_days for insert to authenticated
  with check (
    cycle_id in (select app_private.managed_cycle_ids())
    and created_by = (select auth.uid())
  );

create policy group_rest_days_delete_managed
  on public.group_rest_days for delete to authenticated
  using (cycle_id in (select app_private.managed_cycle_ids()));

-- program_pauses --------------------------------------------------------
create policy program_pauses_select_accessible
  on public.program_pauses for select to authenticated
  using (
    cycle_id in (select app_private.managed_cycle_ids())
    or cycle_id = (select app_private.member_active_cycle_id())
  );

create policy program_pauses_insert_managed
  on public.program_pauses for insert to authenticated
  with check (
    cycle_id in (select app_private.managed_cycle_ids())
    and created_by = (select auth.uid())
  );

create policy program_pauses_update_managed
  on public.program_pauses for update to authenticated
  using (cycle_id in (select app_private.managed_cycle_ids()))
  with check (cycle_id in (select app_private.managed_cycle_ids()));

-- daily_thoughts --------------------------------------------------------
create policy daily_thoughts_select_accessible
  on public.daily_thoughts for select to authenticated
  using (
    batch_id in (select app_private.managed_batch_ids())
    or (
      is_published
      and batch_id in (select app_private.viewable_batch_ids())
    )
  );

create policy daily_thoughts_insert_managed
  on public.daily_thoughts for insert to authenticated
  with check (
    batch_id in (select app_private.managed_batch_ids())
    and published_by = (select auth.uid())
  );

create policy daily_thoughts_update_managed
  on public.daily_thoughts for update to authenticated
  using (batch_id in (select app_private.managed_batch_ids()))
  with check (batch_id in (select app_private.managed_batch_ids()));

-- tasmia_submissions ----------------------------------------------------
-- Members see only their own recitations and the ones they listened to,
-- in their batch's active cycle (unchanged from before batches).
create policy tasmia_submissions_select_accessible
  on public.tasmia_submissions for select to authenticated
  using (
    cycle_id in (select app_private.managed_cycle_ids())
    or (
      cycle_id = (select app_private.member_active_cycle_id())
      and (
        user_id = (select auth.uid())
        or listener_id = (select auth.uid())
      )
    )
  );

create policy tasmia_submissions_insert_own_batch
  on public.tasmia_submissions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and cycle_id = (select app_private.member_active_cycle_id())
  );

-- review_confirmations --------------------------------------------------
-- Members see only their own confirmations in the active cycle.
create policy review_confirmations_select_accessible
  on public.review_confirmations for select to authenticated
  using (
    cycle_id in (select app_private.managed_cycle_ids())
    or (
      cycle_id = (select app_private.member_active_cycle_id())
      and user_id = (select auth.uid())
    )
  );

create policy review_confirmations_insert_own_batch
  on public.review_confirmations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and cycle_id = (select app_private.member_active_cycle_id())
  );
