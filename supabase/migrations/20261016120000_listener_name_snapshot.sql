-- =====================================================================
-- FIX: permanent member deletion ("Database error deleting user")
-- =====================================================================
--
-- Cause:
--   tasmia_submissions.listener_id references profiles(id) with
--   ON DELETE RESTRICT (and is NOT NULL). Deleting the Auth user cascades
--   to profiles, and Postgres refuses the whole delete if the member was
--   ever chosen as the listener on ANOTHER member's Tasmi'a.
--
-- Fix (history-preserving):
--   - Store the listener's name on each submission (listener_name_snapshot),
--     filled by the database at insert time and backfilled for old rows.
--   - listener_id becomes nullable and the FK becomes ON DELETE SET NULL,
--     so deleting a listener keeps other members' recitations and still
--     shows who listened.
--
-- Nothing is deleted by this migration. Run AFTER 20261014120000.
-- Do NOT add BEGIN/COMMIT: db push and the SQL Editor both run this file
-- as one transaction.
-- =====================================================================


-- 1. Snapshot column, backfilled from current listener names.
alter table public.tasmia_submissions
  add column if not exists listener_name_snapshot text;

update public.tasmia_submissions t
set listener_name_snapshot = p.full_name
from public.profiles p
where p.id = t.listener_id
  and t.listener_name_snapshot is null;

-- Every existing row has a live listener (NOT NULL + RESTRICT until now),
-- so this cannot fail on current data.
alter table public.tasmia_submissions
  alter column listener_name_snapshot set not null;


-- 2. Allow the listener reference to be cleared when that account is deleted.
alter table public.tasmia_submissions
  alter column listener_id drop not null;

alter table public.tasmia_submissions
  drop constraint if exists tasmia_submissions_listener_id_fkey;

alter table public.tasmia_submissions
  add constraint tasmia_submissions_listener_id_fkey
  foreign key (listener_id) references public.profiles (id) on delete set null;

-- A recitation always records who listened: a live account or its name.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tasmia_submissions'::regclass
      and conname = 'tasmia_listener_present'
  ) then
    alter table public.tasmia_submissions
      add constraint tasmia_listener_present
      check (listener_id is not null or listener_name_snapshot is not null);
  end if;
end $$;


-- 3. Insert guard: same checks as before, plus the server-side name snapshot.
--    INSERT only, so ON DELETE SET NULL is never blocked and old snapshots
--    never change. (create or replace keeps the existing grants/revokes.)
create or replace function app_private.tasmia_batch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id      uuid;
  v_status        text;
  v_listener_name text;
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

  select p.full_name
  into v_listener_name
  from public.batch_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = new.listener_id
    and m.batch_id = v_batch_id
    and m.membership_role = 'member'
    and p.role = 'member'
    and p.active;

  if v_listener_name is null then
    raise exception 'المستمعة يجب أن تكون عضوة نشطة من نفس الدفعة'
      using errcode = 'check_violation';
  end if;

  -- Set by the server; any value sent by the browser is ignored.
  new.listener_name_snapshot := v_listener_name;

  return new;
end;
$$;
