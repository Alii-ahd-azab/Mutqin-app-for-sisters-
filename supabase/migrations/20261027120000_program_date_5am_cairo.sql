-- Mutqin for Sisters: the program day starts at 05:00 Africa/Cairo (not midnight).
--
-- One SQL definition of "today", the same rule as programDate() in
-- supabase/functions/_shared/logic/programDate.ts (web app and Edge Functions):
-- the Cairo wall-clock time minus five hours, as a date. "at time zone 'Africa/Cairo'" uses the
-- IANA rules of the server, so the daylight-saving offset of the day is applied (no fixed UTC
-- offset); the subtraction is done on the local wall-clock time, so 04:59:59 Cairo is still the
-- previous date and 05:00:00 starts the new one in summer and in winter.
--
-- Used by the «المراجعة البعيدة» functions (next migration) and by peer-test attempts, whose
-- attempt_date was the Cairo calendar date (midnight). Stored rows are not touched.

create function app_private.program_date(p_at timestamptz) returns date
    language sql stable
    set search_path to ''
    as $$ select ((p_at at time zone 'Africa/Cairo') - interval '5 hours')::date $$;

comment on function app_private.program_date(timestamptz) is
  'Mutqin program date at an instant: Africa/Cairo local date with the day starting at 05:00.';

create function app_private.program_today() returns date
    language sql stable
    set search_path to ''
    as $$ select app_private.program_date(now()) $$;

comment on function app_private.program_today() is
  'The program date now (05:00 Africa/Cairo day boundary).';

do $$
declare
  f text;
  r text;
begin
  foreach f in array array['app_private.program_date(timestamptz)', 'app_private.program_today()'] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
  end loop;
end;
$$;

-- Peer-test attempts are dated with the program date (unchanged otherwise).
create or replace function public.peer_test_start_attempt(p_test_id uuid, p_candidate_id uuid, p_examiner_id uuid, p_questions jsonb) returns uuid
    language plpgsql security definer
    set search_path to ''
    as $$
declare
  v_test       public.peer_tests;
  v_batch_id   uuid;
  v_cycle_open boolean;
  v_cand_name  text;
  v_exam_name  text;
  v_done       integer;
  v_attempt_id uuid;
begin
  select t.* into v_test from public.peer_tests t where t.id = p_test_id for share;
  if v_test.id is null
     or not app_private.peer_test_is_live(v_test.status, v_test.visible_from, v_test.visible_until) then
    raise exception 'الاختبار غير متاح حاليًا' using errcode = 'check_violation';
  end if;

  select c.batch_id, c.status = 'active' into v_batch_id, v_cycle_open
  from public.cycles c where c.id = v_test.cycle_id;
  if not coalesce(v_cycle_open, false) then
    raise exception 'دورة هذا الاختبار غير نشطة' using errcode = 'check_violation';
  end if;

  if p_candidate_id = p_examiner_id then
    raise exception 'لا يمكن للعضوة اختبار نفسها' using errcode = 'check_violation';
  end if;

  select p.full_name into v_exam_name
  from public.profiles p
  join public.batch_memberships m on m.user_id = p.id and m.membership_role = 'member'
  where p.id = p_examiner_id and p.role = 'member' and p.active and m.batch_id = v_batch_id;
  if v_exam_name is null then
    raise exception 'المُختبِرة يجب أن تكون عضوة نشطة في هذه الدفعة' using errcode = 'check_violation';
  end if;

  select p.full_name into v_cand_name
  from public.profiles p
  join public.batch_memberships m on m.user_id = p.id and m.membership_role = 'member'
  where p.id = p_candidate_id and p.role = 'member' and p.active and m.batch_id = v_batch_id;
  if v_cand_name is null then
    raise exception 'العضوة المُختبَرة يجب أن تكون عضوة نشطة في هذه الدفعة' using errcode = 'check_violation';
  end if;

  -- Every quarter of the range must already be recited in this cycle.
  select count(distinct s.quarter_number) into v_done
  from public.tasmia_submissions s
  where s.cycle_id = v_test.cycle_id
    and s.user_id = p_candidate_id
    and s.quarter_number between v_test.range_start and v_test.range_end;
  if v_done < (v_test.range_end - v_test.range_start + 1) then
    raise exception 'لم تُتمّ العضوة تسميع جميع أرباع نطاق الاختبار بعد' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.peer_test_attempts a
    where a.test_id = p_test_id and a.candidate_id = p_candidate_id and a.status = 'passed'
  ) then
    raise exception 'اجتازت العضوة هذا الاختبار من قبل' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) <> v_test.questions_count then
    raise exception 'عدد الأسئلة لا يطابق إعدادات الاختبار' using errcode = 'check_violation';
  end if;

  -- A new session replaces any unfinished one for this candidate.
  update public.peer_test_attempts
  set status = 'cancelled'
  where test_id = p_test_id and candidate_id = p_candidate_id and status = 'in_progress';

  insert into public.peer_test_attempts (
    test_id, candidate_id, candidate_name_snapshot, examiner_id, examiner_name_snapshot,
    status, max_errors_snapshot, attempt_date
  )
  values (
    p_test_id, p_candidate_id, v_cand_name, p_examiner_id, v_exam_name,
    'in_progress', v_test.max_errors, app_private.program_today()
  )
  returning id into v_attempt_id;

  insert into public.peer_test_attempt_questions (
    attempt_id, question_number, start_surah, start_surah_name, start_ayah,
    end_surah, end_surah_name, end_ayah,
    start_page, start_line, end_page, end_line, actual_lines, difficulty_level
  )
  select v_attempt_id, q.question_number, q.start_surah, q.start_surah_name, q.start_ayah,
         q.end_surah, q.end_surah_name, q.end_ayah,
         q.start_page, q.start_line, q.end_page, q.end_line, q.actual_lines, q.difficulty_level
  from jsonb_to_recordset(p_questions) as q(
    question_number smallint, start_surah smallint, start_surah_name text, start_ayah smallint,
    end_surah smallint, end_surah_name text, end_ayah smallint, start_page smallint, start_line smallint,
    end_page smallint, end_line smallint, actual_lines smallint, difficulty_level text
  );

  return v_attempt_id;
end;
$$;
