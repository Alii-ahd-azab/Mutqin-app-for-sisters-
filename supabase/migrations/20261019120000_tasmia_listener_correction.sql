-- =====================================================================
-- MEMBER CORRECTS THE LISTENER ON HER OWN TASMI'A (once, within 12h)
-- =====================================================================
--
--   1. tasmia_submissions.listener_changed_at: NULL = the one allowed
--      correction is still available; non-NULL = it has been used.
--   2. app_private.tasmia_listener_name: the single listener-eligibility
--      rule (another active member of the same batch), shared by the
--      insert guard and the correction RPC.
--   3. tasmia_batch_guard: uses that helper; the server also owns
--      submitted_at (no future dates, so the 12h window cannot be
--      stretched) and listener_changed_at (always NULL on insert).
--   4. public.correct_tasmia_listener: member-callable, atomic. Only the
--      listener (listener_id + listener_name_snapshot) changes. Direct
--      UPDATE on tasmia_submissions stays revoked.
--
-- Listener credit/statistics are derived from listener_id, so they move
-- to the corrected listener automatically.
--
-- Run AFTER 20261018120000 (this re-creates its tasmia_batch_guard).
-- Do NOT add BEGIN/COMMIT: db push and the SQL Editor both run this file
-- as one transaction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ONE-CORRECTION MARKER
-- ---------------------------------------------------------------------

alter table public.tasmia_submissions
  add column if not exists listener_changed_at timestamptz;


-- ---------------------------------------------------------------------
-- 2. LISTENER ELIGIBILITY (single source of truth)
-- ---------------------------------------------------------------------
--
-- The listener's current name if she may listen to this reciter in this
-- batch: not the reciter herself, an ACTIVE member account with a member
-- membership in the batch. NULL otherwise.

create or replace function app_private.tasmia_listener_name(
  p_batch_id    uuid,
  p_reciter_id  uuid,
  p_listener_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name
  from public.batch_memberships m
  join public.profiles p on p.id = m.user_id
  where m.user_id = p_listener_id
    and p_listener_id <> p_reciter_id
    and m.batch_id = p_batch_id
    and m.membership_role = 'member'
    and p.role = 'member'
    and p.active;
$$;

revoke all on function app_private.tasmia_listener_name(uuid, uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. TASMI'A INSERT GUARD
-- ---------------------------------------------------------------------
--
-- Same checks as 20261018120000 (active cycle, same batch, eligible
-- listener, peer-test checkpoint, server-side name snapshot), with the
-- listener rule read from the shared helper, plus server-owned
-- submitted_at / listener_changed_at. INSERT only, as before.

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
  v_block_start   smallint;
  v_block_end     smallint;
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

  v_listener_name := app_private.tasmia_listener_name(v_batch_id, new.user_id, new.listener_id);

  if v_listener_name is null then
    raise exception 'المستمعة يجب أن تكون عضوة نشطة من نفس الدفعة'
      using errcode = 'check_violation';
  end if;

  -- Mandatory peer-test checkpoint (database-enforced).
  select t.range_start, t.range_end
  into v_block_start, v_block_end
  from public.peer_tests t
  where t.cycle_id = new.cycle_id
    and t.test_type = 'mandatory'
    and app_private.peer_test_is_live(t.status, t.visible_from, t.visible_until)
    and new.quarter_number > t.range_end
    and not exists (
      select 1 from public.peer_test_attempts a
      where a.test_id = t.id
        and a.candidate_id = new.user_id
        and a.status = 'passed'
    )
  order by t.range_end
  limit 1;

  if v_block_end is not null then
    raise exception 'يجب اجتياز الاختبار الإلزامي للأرباع (% - %) بنجاح أولاً قبل متابعة تسميع الأرباع التالية',
      v_block_start, v_block_end
      using errcode = 'P0001', hint = 'peer_test_required';
  end if;

  -- Set by the server; any value sent by the browser is ignored.
  new.listener_name_snapshot := v_listener_name;

  -- The correction window counts from submitted_at, so it can never be
  -- in the future, and a new row always has its one correction available.
  new.submitted_at := least(coalesce(new.submitted_at, now()), now());
  new.listener_changed_at := null;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. CORRECT THE LISTENER (member-callable, atomic)
-- ---------------------------------------------------------------------
--
-- The row is locked first, so of two simultaneous corrections the second
-- waits, then sees listener_changed_at already set and is rejected.

create or replace function public.correct_tasmia_listener(
  p_submission_id   uuid,
  p_new_listener_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_row           public.tasmia_submissions;
  v_batch_id      uuid;
  v_listener_name text;
  v_saved         public.tasmia_submissions;
begin
  select t.* into v_row
  from public.tasmia_submissions t
  where t.id = p_submission_id
  for update;

  -- Missing and not-hers look the same, so existence is not revealed.
  -- The member_active_cycle_id() check also requires an active member
  -- whose batch's active cycle this row belongs to.
  if v_uid is null
     or v_row.id is null
     or v_row.user_id <> v_uid
     or v_row.cycle_id is distinct from app_private.member_active_cycle_id() then
    raise exception 'لا يمكن تعديل هذا التسميع'
      using errcode = 'check_violation';
  end if;

  if v_row.listener_changed_at is not null then
    raise exception 'تم تعديل المستمعة مسبقًا'
      using errcode = 'check_violation';
  end if;

  if now() > v_row.submitted_at + interval '12 hours' then
    raise exception 'انتهت مهلة التعديل'
      using errcode = 'check_violation';
  end if;

  if p_new_listener_id is null then
    raise exception 'يجب اختيار الأخت المستمعة'
      using errcode = 'check_violation';
  end if;

  if p_new_listener_id is not distinct from v_row.listener_id then
    raise exception 'هذه هي المستمعة المسجلة حاليًا'
      using errcode = 'check_violation';
  end if;

  if p_new_listener_id = v_uid then
    raise exception 'لا يمكن اختيار نفسكِ كمستمعة'
      using errcode = 'check_violation';
  end if;

  select c.batch_id into v_batch_id
  from public.cycles c
  where c.id = v_row.cycle_id;

  v_listener_name := app_private.tasmia_listener_name(v_batch_id, v_row.user_id, p_new_listener_id);

  if v_listener_name is null then
    raise exception 'المستمعة يجب أن تكون عضوة نشطة من نفس الدفعة'
      using errcode = 'check_violation';
  end if;

  -- The corrected listener replaces the wrong one everywhere, including
  -- the name snapshot kept for after an account deletion.
  update public.tasmia_submissions
  set listener_id = p_new_listener_id,
      listener_name_snapshot = v_listener_name,
      listener_changed_at = now()
  where id = v_row.id
  returning * into v_saved;

  return jsonb_build_object(
    'id', v_saved.id,
    'listener_id', v_saved.listener_id,
    'listener_name_snapshot', v_saved.listener_name_snapshot,
    'listener_changed_at', v_saved.listener_changed_at
  );
end;
$$;

revoke all on function public.correct_tasmia_listener(uuid, uuid) from public, anon;
grant execute on function public.correct_tasmia_listener(uuid, uuid) to authenticated, service_role;
