-- =====================================================================
-- MOVE MEMBER TO ANOTHER BATCH + JOIN DATE
-- =====================================================================
--
--   1. batch_memberships.joined_at: when the member joined her CURRENT
--      batch. Revision debt is counted from this date (Tasmi'a debt is
--      inherited in full, unchanged).
--   2. batch_membership_transfers: audit log of moves (server-only).
--   3. batch_memberships_guard: member transfers become possible, but
--      ONLY inside public.move_member_batch (transaction-local flag).
--   4. public.move_member_batch: atomic, service-role-only transfer.
--      Same Auth user, profile and UUID; history stays in the old
--      batch's cycles; active/excluded state is untouched.
--   5. public.history_member_names: names (no phones) of people who
--      appear in a cycle's history the caller may see, so moved
--      members' old rows still show their name.
--
-- Run AFTER 20261014120000 and 20261016120000.
-- Do NOT add BEGIN/COMMIT: db push and the SQL Editor both run this file
-- as one transaction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. JOIN DATE
-- ---------------------------------------------------------------------

alter table public.batch_memberships
  add column if not exists joined_at timestamptz;

update public.batch_memberships
set joined_at = created_at
where joined_at is null;

alter table public.batch_memberships
  alter column joined_at set default now();

alter table public.batch_memberships
  alter column joined_at set not null;


-- ---------------------------------------------------------------------
-- 2. TRANSFER AUDIT LOG (server-only)
-- ---------------------------------------------------------------------

create table if not exists public.batch_membership_transfers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  from_batch_id uuid not null,
  to_batch_id   uuid not null,
  moved_by      uuid,
  moved_at      timestamptz not null default now(),
  constraint batch_membership_transfers_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint batch_membership_transfers_from_batch_id_fkey
    foreign key (from_batch_id) references public.batches (id) on delete restrict,
  constraint batch_membership_transfers_to_batch_id_fkey
    foreign key (to_batch_id) references public.batches (id) on delete restrict,
  constraint batch_membership_transfers_moved_by_fkey
    foreign key (moved_by) references public.profiles (id) on delete set null
);

create index if not exists batch_membership_transfers_user_idx
  on public.batch_membership_transfers (user_id, moved_at desc);

alter table public.batch_membership_transfers enable row level security;
revoke all on public.batch_membership_transfers from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. MEMBERSHIP GUARD: transfers only through move_member_batch
-- ---------------------------------------------------------------------

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
  if tg_op = 'UPDATE' and old.membership_role = 'member' then
    -- A membership never changes owner or type.
    if new.user_id is distinct from old.user_id
       or new.membership_role is distinct from old.membership_role then
      raise exception 'لا يمكن تعديل عضوية الدفعة بهذه الطريقة'
        using errcode = 'check_violation';
    end if;

    -- Changing the batch is a transfer: only public.move_member_batch
    -- sets this transaction-local flag.
    if new.batch_id is distinct from old.batch_id
       and coalesce(current_setting('app.member_transfer', true), '') <> 'on' then
      raise exception 'نقل العضوة بين الدفعات يتم فقط من خلال إجراء النقل الآمن'
        using errcode = 'check_violation';
    end if;
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


-- ---------------------------------------------------------------------
-- 4. ATOMIC TRANSFER (service role only)
-- ---------------------------------------------------------------------
--
-- Only the CURRENT membership changes. The profile, Auth user, phone,
-- password, active/excluded state, recitations, revisions and listener
-- snapshots are never touched: old rows stay on the old batch's cycles.

create or replace function public.move_member_batch(
  p_user_id                  uuid,
  p_destination_batch_id     uuid,
  p_expected_source_batch_id uuid,
  p_actor                    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role         text;
  v_count        integer;
  v_membership   public.batch_memberships;
  v_dest         public.batches;
begin
  select p.role::text into v_role
  from public.profiles p
  where p.id = p_user_id;

  if v_role is null then
    raise exception 'العضوة غير موجودة' using errcode = 'no_data_found';
  end if;

  if v_role <> 'member' then
    raise exception 'يمكن نقل حسابات العضوات فقط' using errcode = 'check_violation';
  end if;

  -- Lock the member's current membership row(s) first, then inspect.
  perform 1
  from public.batch_memberships m
  where m.user_id = p_user_id
    and m.membership_role = 'member'
  for update;

  select count(*) into v_count
  from public.batch_memberships m
  where m.user_id = p_user_id
    and m.membership_role = 'member';

  if v_count = 0 then
    raise exception 'العضوة غير مرتبطة بأي دفعة' using errcode = 'no_data_found';
  end if;

  if v_count > 1 then
    raise exception 'خطأ في البيانات: العضوة مرتبطة بأكثر من دفعة' using errcode = 'check_violation';
  end if;

  select m.* into v_membership
  from public.batch_memberships m
  where m.user_id = p_user_id
    and m.membership_role = 'member';

  if p_expected_source_batch_id is not null
     and v_membership.batch_id <> p_expected_source_batch_id then
    raise exception 'تغيّرت دفعة العضوة، يرجى تحديث الصفحة والمحاولة مرة أخرى'
      using errcode = 'check_violation';
  end if;

  if v_membership.batch_id = p_destination_batch_id then
    raise exception 'العضوة موجودة بالفعل في هذه الدفعة' using errcode = 'check_violation';
  end if;

  select b.* into v_dest
  from public.batches b
  where b.id = p_destination_batch_id
  for share;

  if v_dest.id is null or v_dest.archived_at is not null then
    raise exception 'الدفعة المختارة غير موجودة' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.cycles c
    where c.batch_id = p_destination_batch_id
      and c.status = 'active'
  ) then
    raise exception 'لا توجد دورة نشطة في الدفعة المختارة' using errcode = 'check_violation';
  end if;

  perform set_config('app.member_transfer', 'on', true);

  update public.batch_memberships
  set batch_id = p_destination_batch_id,
      joined_at = now()
  where id = v_membership.id;

  perform set_config('app.member_transfer', 'off', true);

  insert into public.batch_membership_transfers (user_id, from_batch_id, to_batch_id, moved_by)
  values (p_user_id, v_membership.batch_id, p_destination_batch_id, p_actor);

  return jsonb_build_object(
    'from_batch_id', v_membership.batch_id,
    'to_batch_id', p_destination_batch_id
  );
end;
$$;

revoke all on function public.move_member_batch(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.move_member_batch(uuid, uuid, uuid, uuid)
  to service_role;


-- ---------------------------------------------------------------------
-- 5. NAMES FOR HISTORY ROWS (names only, no phones)
-- ---------------------------------------------------------------------
--
-- After a member moves, her old batch can no longer read her profile.
-- This returns just the display names of people appearing in a cycle's
-- history, limited to what the caller is allowed to see:
--   - admins of that batch: everyone in the cycle's recitations/revisions
--   - a member (her active cycle): reciters of rows she listened to

create or replace function public.history_member_names(p_cycle_id uuid)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select t.user_id as uid
    from public.tasmia_submissions t
    where t.cycle_id = p_cycle_id
      and p_cycle_id in (select app_private.managed_cycle_ids())
    union
    select t.listener_id
    from public.tasmia_submissions t
    where t.cycle_id = p_cycle_id
      and t.listener_id is not null
      and p_cycle_id in (select app_private.managed_cycle_ids())
    union
    select r.user_id
    from public.review_confirmations r
    where r.cycle_id = p_cycle_id
      and p_cycle_id in (select app_private.managed_cycle_ids())
    union
    select t.user_id
    from public.tasmia_submissions t
    where t.cycle_id = p_cycle_id
      and p_cycle_id = app_private.member_active_cycle_id()
      and t.listener_id = auth.uid()
  )
  select p.id, p.full_name
  from public.profiles p
  join people on people.uid = p.id;
$$;

revoke all on function public.history_member_names(uuid) from public, anon;
grant execute on function public.history_member_names(uuid) to authenticated, service_role;
