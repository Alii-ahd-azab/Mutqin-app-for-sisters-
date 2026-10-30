-- Mutqin for Sisters (same change as Mutqin for Men 20261102000100):
--
-- 1. «المراجعة البعيدة» takes priority over pauses and rest days.
--    A scheduled distant-review day is an explicit obligation: it stays required on its date even
--    when the program is paused (open pause or a recorded pause period) or the date is a rest day.
--    The admin removes it only by deleting the (still-future) assignment.
--      * the rest-day XOR distant-review guards are lifted: a date may be both (the rest day keeps
--        its meaning for the normal program; the distant review stays required);
--      * complete_distant_review no longer refuses a paused or rest date.
--    The program calendar (shared TypeScript) still counts such a date once (a paused or rest date is
--    already a non-program day), so normal Tasmi'a / review progression stays paused and no program
--    day, review identity or history moves.
--
-- 2. Admin alert dismissals (notification visibility only).
--    An admin (batch admin or master admin) may hide ONE member's serious-debt alert from her own
--    active notifications until she restores it. Private to that admin; never touches the debt, the
--    member's state, exclusion rules or any other admin. Separate from notification_states.archived_at.
--
-- Existing rows are not touched (only a trigger and its function are dropped; no table or data).

-- ---------------------------------------------------------------------------------------------
-- 1. Distant review priority
-- ---------------------------------------------------------------------------------------------
drop trigger rest_day_distant_review_guard on public.group_rest_days;
drop function app_private.rest_day_distant_review_guard();

create or replace function app_private.distant_review_assignment_guard() returns trigger
    language plpgsql security definer
    set search_path to ''
    as $$
begin
  select c.batch_id into new.batch_id from public.cycles c where c.id = new.cycle_id;
  if new.batch_id is null then
    raise exception 'الدورة غير موجودة' using errcode = 'foreign_key_violation';
  end if;
  new.note := nullif(btrim(new.note), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- The member confirms one distant review that is owed to her: its date has come (today or late),
-- it belongs to her batch's ACTIVE cycle, it is not before the cycle start and she had joined the
-- batch by then. A pause or a rest day on that date does NOT cancel it. Idempotent.
create or replace function public.complete_distant_review(p_assignment_id uuid) returns jsonb
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
  if v_a.review_date < v_a.starts_on or (v_joined is not null and v_a.review_date < v_joined) then
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
-- 2. Admin alert dismissals
-- ---------------------------------------------------------------------------------------------
create table public.admin_alert_dismissals (
    admin_user_id uuid not null references public.profiles(id) on delete cascade,
    batch_id uuid not null references public.batches(id) on delete cascade,
    member_user_id uuid not null references public.profiles(id) on delete cascade,
    -- Display snapshot for «المستبعدة» (the member may later have no active alert).
    member_name text not null default '' check (char_length(member_name) <= 200),
    summary text not null default '' check (char_length(summary) <= 500),
    dismissed_at timestamptz not null default now(),
    primary key (admin_user_id, batch_id, member_user_id),
    check (admin_user_id <> member_user_id)
);

alter table public.admin_alert_dismissals enable row level security;
revoke all on table public.admin_alert_dismissals from public;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.admin_alert_dismissals from %I', r);
    end if;
  end loop;
end $$;
grant select on table public.admin_alert_dismissals to authenticated;
create policy admin_alert_dismissals_select_own on public.admin_alert_dismissals
  for select to authenticated using (admin_user_id = (select auth.uid()));

-- An admin may dismiss an alert of a member of a batch she manages (master admins: any batch).
create function public.admin_alert_dismiss(p_batch_id uuid, p_member_id uuid, p_member_name text, p_summary text)
    returns timestamptz
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := app_private.active_caller();
  v_at timestamptz;
begin
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'admin') then
    raise exception 'هذا الإجراء متاح للمشرفات فقط' using errcode = '42501';
  end if;
  if not (app_private.is_master_admin() or p_batch_id in (select app_private.managed_batch_ids())) then
    raise exception 'لا تملكين صلاحية على هذه الدفعة' using errcode = '42501';
  end if;
  if not exists (select 1 from public.batch_memberships m
                 where m.batch_id = p_batch_id and m.user_id = p_member_id and m.membership_role = 'member') then
    raise exception 'العضوة لا تنتمي إلى هذه الدفعة' using errcode = 'P0002';
  end if;
  insert into public.admin_alert_dismissals as d (admin_user_id, batch_id, member_user_id, member_name, summary)
  values (v_uid, p_batch_id, p_member_id, left(coalesce(p_member_name, ''), 200), left(coalesce(p_summary, ''), 500))
  on conflict (admin_user_id, batch_id, member_user_id) do update
    set member_name = excluded.member_name, summary = excluded.summary
  returning d.dismissed_at into v_at;
  return v_at;
end;
$$;

-- Restore: the admin's own dismissal only. The member's alert becomes active again for her (her
-- earlier "opened" marks on that member's alert keys are cleared too). Idempotent.
create function public.admin_alert_restore(p_batch_id uuid, p_member_id uuid) returns boolean
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_uid uuid := app_private.active_caller();
  v_found boolean;
begin
  delete from public.admin_alert_dismissals d
  where d.admin_user_id = v_uid and d.batch_id = p_batch_id and d.member_user_id = p_member_id;
  v_found := found;
  delete from public.notification_states s
  where s.user_id = v_uid and s.notification_key like 'alert:' || p_batch_id::text || ':' || p_member_id::text || ':%';
  return v_found;
end;
$$;

do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.admin_alert_dismiss(uuid, uuid, text, text)', 'public.admin_alert_restore(uuid, uuid)'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
