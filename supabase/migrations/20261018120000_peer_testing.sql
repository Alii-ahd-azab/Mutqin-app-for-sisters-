-- =====================================================================
-- PEER TESTING (اختبار الزملاء)
-- =====================================================================
--
--   Admin-configured tests per batch cycle (manual quarter range,
--   question count, lines per question, error limit, mandatory or
--   recommended, difficulty, show / hide / schedule). A member (the
--   examiner) tests another member of her batch (the candidate); the
--   server issues the questions and computes the result.
--
--   * Tests belong to a cycle (the cycle determines the batch), so every
--     batch is independent and a new cycle starts with no tests.
--   * While a MANDATORY test is LIVE, Tasmi'a beyond its range_end is
--     rejected by the database until the member passes that test.
--   * The browser never writes to these tables: the peer-tests Edge
--     Function calls the service-role-only functions below.
--
-- Run AFTER 20261014120000, 20261016120000 and 20261017120000.
-- Do NOT add BEGIN/COMMIT: db push and the SQL Editor both run this file
-- as one transaction.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

create table if not exists public.peer_tests (
  id                 uuid primary key default gen_random_uuid(),
  cycle_id           uuid not null,
  title              text not null,
  range_start        smallint not null,
  range_end          smallint not null,
  questions_count    smallint not null,
  lines_per_question smallint not null,
  max_errors         smallint,                -- null = no limit
  test_type          text not null default 'mandatory',
  difficulty         text not null default 'any',
  status             text not null default 'draft',
  visible_from       timestamptz,             -- null = immediately
  visible_until      timestamptz,             -- null = no end
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  finished_at        timestamptz,
  constraint peer_tests_cycle_id_fkey
    foreign key (cycle_id) references public.cycles (id) on delete restrict,
  constraint peer_tests_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint peer_tests_title_check check (length(btrim(title)) between 1 and 120),
  constraint peer_tests_range_check
    check (range_start between 1 and 240 and range_end between 1 and 240 and range_start <= range_end),
  constraint peer_tests_questions_check check (questions_count between 1 and 50),
  constraint peer_tests_lines_check check (lines_per_question between 1 and 60),
  constraint peer_tests_max_errors_check check (max_errors is null or max_errors between 0 and 100),
  constraint peer_tests_type_check check (test_type in ('mandatory', 'recommended')),
  constraint peer_tests_difficulty_check check (difficulty in ('any', 'easy', 'medium', 'hard', 'mixed')),
  constraint peer_tests_status_check check (status in ('draft', 'published', 'hidden', 'finished')),
  constraint peer_tests_window_check
    check (visible_from is null or visible_until is null or visible_from < visible_until)
);

create index if not exists peer_tests_cycle_status_idx
  on public.peer_tests (cycle_id, status);

create table if not exists public.peer_test_attempts (
  id                     uuid primary key default gen_random_uuid(),
  test_id                uuid not null,
  candidate_id           uuid not null,
  candidate_name_snapshot text not null,
  examiner_id            uuid,
  examiner_name_snapshot text not null,
  status                 text not null default 'in_progress',
  total_errors           smallint,
  max_errors_snapshot    smallint,
  notes                  text,
  attempt_date           date not null,
  created_at             timestamptz not null default now(),
  completed_at           timestamptz,
  constraint peer_test_attempts_test_id_fkey
    foreign key (test_id) references public.peer_tests (id) on delete restrict,
  -- Deleting a member deletes her own attempts (as with her recitations).
  constraint peer_test_attempts_candidate_id_fkey
    foreign key (candidate_id) references public.profiles (id) on delete cascade,
  -- Deleting an examiner keeps the result (and its pass) with her name.
  constraint peer_test_attempts_examiner_id_fkey
    foreign key (examiner_id) references public.profiles (id) on delete set null,
  constraint peer_test_attempts_status_check
    check (status in ('in_progress', 'passed', 'failed', 'cancelled')),
  constraint peer_test_attempts_notes_check check (notes is null or length(notes) <= 300)
);

-- One open session per candidate and test.
create unique index if not exists peer_test_attempts_one_open_idx
  on public.peer_test_attempts (test_id, candidate_id)
  where status = 'in_progress';

create index if not exists peer_test_attempts_test_candidate_idx
  on public.peer_test_attempts (test_id, candidate_id, status);

create index if not exists peer_test_attempts_candidate_idx
  on public.peer_test_attempts (candidate_id);

create index if not exists peer_test_attempts_examiner_idx
  on public.peer_test_attempts (examiner_id);

create table if not exists public.peer_test_attempt_questions (
  attempt_id       uuid not null,
  question_number  smallint not null,
  start_surah      smallint not null,
  start_surah_name text not null,
  start_ayah       smallint not null,
  end_surah        smallint not null,
  end_surah_name   text not null,
  end_ayah         smallint not null,
  start_page       smallint not null,
  start_line       smallint not null,
  end_page         smallint not null,
  end_line         smallint not null,
  actual_lines     smallint not null,
  difficulty_level text,
  errors_count     smallint,
  notes            text,
  constraint peer_test_attempt_questions_pkey primary key (attempt_id, question_number),
  constraint peer_test_attempt_questions_attempt_id_fkey
    foreign key (attempt_id) references public.peer_test_attempts (id) on delete cascade,
  constraint peer_test_attempt_questions_errors_check
    check (errors_count is null or errors_count between 0 and 99),
  constraint peer_test_attempt_questions_level_check
    check (difficulty_level is null or difficulty_level in ('easy', 'medium', 'hard')),
  constraint peer_test_attempt_questions_notes_check check (notes is null or length(notes) <= 300)
);


-- ---------------------------------------------------------------------
-- 2. HELPERS (private schema, as the existing RLS helpers)
-- ---------------------------------------------------------------------

-- A test is LIVE when it is published and inside its show window.
create or replace function app_private.peer_test_is_live(
  p_status        text,
  p_visible_from  timestamptz,
  p_visible_until timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_status = 'published'
     and (p_visible_from is null or p_visible_from <= now())
     and (p_visible_until is null or p_visible_until > now());
$$;

create or replace function app_private.managed_peer_test_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.peer_tests t
  where t.cycle_id in (select app_private.managed_cycle_ids());
$$;

-- Attempts the caller may see: all attempts of tests she manages, plus
-- the attempts where she was the candidate or the examiner.
create or replace function app_private.visible_peer_attempt_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.peer_test_attempts a
  where a.test_id in (select app_private.managed_peer_test_ids())
     or a.candidate_id = auth.uid()
     or a.examiner_id = auth.uid();
$$;

-- Remaining part of a test's show window (from now on), used to keep at
-- most ONE live test per cycle at any moment.
create or replace function app_private.peer_test_future_window(
  p_visible_from  timestamptz,
  p_visible_until timestamptz
)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(p_visible_until, 'infinity'::timestamptz)
         <= greatest(coalesce(p_visible_from, '-infinity'::timestamptz), now())
      then 'empty'::tstzrange
    else tstzrange(
      greatest(coalesce(p_visible_from, '-infinity'::timestamptz), now()),
      coalesce(p_visible_until, 'infinity'::timestamptz),
      '[)'
    )
  end;
$$;

create or replace function app_private.assert_no_overlapping_peer_test(
  p_cycle_id      uuid,
  p_exclude_ids   uuid[],
  p_visible_from  timestamptz,
  p_visible_until timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.peer_tests t
    where t.cycle_id = p_cycle_id
      and t.status = 'published'
      and not (t.id = any (coalesce(p_exclude_ids, '{}'::uuid[])))
      and app_private.peer_test_future_window(t.visible_from, t.visible_until)
          && app_private.peer_test_future_window(p_visible_from, p_visible_until)
  ) then
    raise exception 'يوجد اختبار آخر ظاهر في نفس الفترة لهذه الدفعة. أخفيه أو عدّلي فترة العرض أولاً'
      using errcode = 'check_violation';
  end if;
end;
$$;

revoke all on function app_private.peer_test_is_live(text, timestamptz, timestamptz) from public, anon;
revoke all on function app_private.managed_peer_test_ids() from public, anon;
revoke all on function app_private.visible_peer_attempt_ids() from public, anon;
revoke all on function app_private.peer_test_future_window(timestamptz, timestamptz) from public, anon;
revoke all on function app_private.assert_no_overlapping_peer_test(uuid, uuid[], timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function app_private.peer_test_is_live(text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function app_private.managed_peer_test_ids() to authenticated, service_role;
grant execute on function app_private.visible_peer_attempt_ids() to authenticated, service_role;
grant execute on function app_private.peer_test_future_window(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function app_private.assert_no_overlapping_peer_test(uuid, uuid[], timestamptz, timestamptz) to service_role;


-- ---------------------------------------------------------------------
-- 3. SERVER-ONLY FUNCTIONS (called by the peer-tests Edge Function)
-- ---------------------------------------------------------------------

-- Create or update a test. Editing range / questions / lines / difficulty
-- after attempts exist finishes the old test and creates a new version,
-- so earlier results stay tied to the conditions they were taken under.
create or replace function public.peer_test_save(
  p_test_id            uuid,
  p_cycle_id           uuid,
  p_title              text,
  p_range_start        integer,
  p_range_end          integer,
  p_questions_count    integer,
  p_lines_per_question integer,
  p_max_errors         integer,
  p_test_type          text,
  p_difficulty         text,
  p_status             text,
  p_visible_from       timestamptz,
  p_visible_until      timestamptz,
  p_actor              uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle     public.cycles;
  v_existing  public.peer_tests;
  v_saved     public.peer_tests;
  v_versioned boolean := false;
  v_exclude   uuid[] := '{}';
begin
  if p_status not in ('draft', 'published', 'hidden') then
    raise exception 'حالة العرض غير صالحة' using errcode = 'check_violation';
  end if;

  -- Serialize changes per cycle (keeps the one-live-test rule race-safe).
  select c.* into v_cycle from public.cycles c where c.id = p_cycle_id for update;
  if v_cycle.id is null or v_cycle.status <> 'active' then
    raise exception 'لا توجد دورة نشطة لهذه الدفعة' using errcode = 'check_violation';
  end if;

  if p_status = 'published' and p_visible_until is not null and p_visible_until <= now() then
    raise exception 'وقت انتهاء العرض يجب أن يكون في المستقبل' using errcode = 'check_violation';
  end if;

  if p_test_id is not null then
    select t.* into v_existing from public.peer_tests t where t.id = p_test_id for update;
    if v_existing.id is null or v_existing.cycle_id <> p_cycle_id then
      raise exception 'الاختبار غير موجود' using errcode = 'no_data_found';
    end if;
    if v_existing.status = 'finished' then
      raise exception 'هذا الاختبار منتهٍ نهائيًا ولا يمكن تعديله، أنشئي اختبارًا جديدًا'
        using errcode = 'check_violation';
    end if;

    v_exclude := array[v_existing.id];

    v_versioned := (
      v_existing.range_start <> p_range_start
      or v_existing.range_end <> p_range_end
      or v_existing.questions_count <> p_questions_count
      or v_existing.lines_per_question <> p_lines_per_question
      or v_existing.difficulty <> p_difficulty
    ) and exists (
      select 1 from public.peer_test_attempts a
      where a.test_id = v_existing.id and a.status <> 'cancelled'
    );
  end if;

  if p_status = 'published' then
    perform app_private.assert_no_overlapping_peer_test(p_cycle_id, v_exclude, p_visible_from, p_visible_until);
  end if;

  if p_test_id is not null and not v_versioned then
    update public.peer_tests
    set title = btrim(p_title),
        range_start = p_range_start,
        range_end = p_range_end,
        questions_count = p_questions_count,
        lines_per_question = p_lines_per_question,
        max_errors = p_max_errors,
        test_type = p_test_type,
        difficulty = p_difficulty,
        status = p_status,
        visible_from = p_visible_from,
        visible_until = p_visible_until,
        updated_at = now()
    where id = p_test_id
    returning * into v_saved;
  else
    if v_versioned then
      update public.peer_tests
      set status = 'finished', finished_at = now(), updated_at = now()
      where id = v_existing.id;

      update public.peer_test_attempts
      set status = 'cancelled'
      where test_id = v_existing.id and status = 'in_progress';
    end if;

    insert into public.peer_tests (
      cycle_id, title, range_start, range_end, questions_count, lines_per_question,
      max_errors, test_type, difficulty, status, visible_from, visible_until, created_by
    )
    values (
      p_cycle_id, btrim(p_title), p_range_start, p_range_end, p_questions_count, p_lines_per_question,
      p_max_errors, p_test_type, p_difficulty, p_status, p_visible_from, p_visible_until, p_actor
    )
    returning * into v_saved;
  end if;

  return jsonb_build_object('test', to_jsonb(v_saved), 'versioned', v_versioned);
end;
$$;

-- Show now / hide / finish (finish is permanent).
create or replace function public.peer_test_set_status(
  p_test_id uuid,
  p_action  text,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test  public.peer_tests;
  v_saved public.peer_tests;
  v_until timestamptz;
begin
  select t.* into v_test from public.peer_tests t where t.id = p_test_id;
  if v_test.id is null then
    raise exception 'الاختبار غير موجود' using errcode = 'no_data_found';
  end if;

  perform 1 from public.cycles c where c.id = v_test.cycle_id for update;
  select t.* into v_test from public.peer_tests t where t.id = p_test_id for update;

  if v_test.status = 'finished' then
    raise exception 'هذا الاختبار منتهٍ نهائيًا' using errcode = 'check_violation';
  end if;

  if p_action = 'show' then
    v_until := case when v_test.visible_until is not null and v_test.visible_until <= now()
                    then null else v_test.visible_until end;
    perform app_private.assert_no_overlapping_peer_test(v_test.cycle_id, array[v_test.id], null, v_until);
    update public.peer_tests
    set status = 'published', visible_from = null, visible_until = v_until, updated_at = now()
    where id = p_test_id
    returning * into v_saved;
  elsif p_action = 'hide' then
    update public.peer_tests
    set status = 'hidden', updated_at = now()
    where id = p_test_id
    returning * into v_saved;
  elsif p_action = 'finish' then
    update public.peer_tests
    set status = 'finished', finished_at = now(), updated_at = now()
    where id = p_test_id
    returning * into v_saved;

    update public.peer_test_attempts
    set status = 'cancelled'
    where test_id = p_test_id and status = 'in_progress';
  else
    raise exception 'إجراء غير معروف' using errcode = 'check_violation';
  end if;

  return jsonb_build_object('test', to_jsonb(v_saved));
end;
$$;

-- Start a session: the questions generated by the server are stored here,
-- so the examiner later submits only error counts.
create or replace function public.peer_test_start_attempt(
  p_test_id      uuid,
  p_candidate_id uuid,
  p_examiner_id  uuid,
  p_questions    jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
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
    'in_progress', v_test.max_errors, (now() at time zone 'Africa/Cairo')::date
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

-- Submit error counts; total and pass/fail are computed here.
create or replace function public.peer_test_submit_attempt(
  p_attempt_id     uuid,
  p_examiner_id    uuid,
  p_errors         integer[],
  p_question_notes text[],
  p_notes          text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.peer_test_attempts;
  v_test    public.peer_tests;
  v_count   integer;
  v_total   integer;
  v_passed  boolean;
  v_saved   public.peer_test_attempts;
begin
  select a.* into v_attempt from public.peer_test_attempts a where a.id = p_attempt_id for update;
  if v_attempt.id is null or v_attempt.status <> 'in_progress' then
    raise exception 'جلسة الاختبار غير موجودة أو انتهت' using errcode = 'check_violation';
  end if;
  if v_attempt.examiner_id is distinct from p_examiner_id then
    raise exception 'لا يمكن اعتماد نتيجة اختبار أجرته أخت أخرى' using errcode = 'check_violation';
  end if;

  select t.* into v_test from public.peer_tests t where t.id = v_attempt.test_id;
  if not app_private.peer_test_is_live(v_test.status, v_test.visible_from, v_test.visible_until)
     or not exists (select 1 from public.cycles c where c.id = v_test.cycle_id and c.status = 'active') then
    raise exception 'الاختبار غير متاح حاليًا' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.peer_test_attempts a
    where a.test_id = v_attempt.test_id and a.candidate_id = v_attempt.candidate_id and a.status = 'passed'
  ) then
    raise exception 'اجتازت العضوة هذا الاختبار من قبل' using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.peer_test_attempt_questions q where q.attempt_id = p_attempt_id;
  if coalesce(array_length(p_errors, 1), 0) <> v_count then
    raise exception 'يجب تسجيل أخطاء جميع الأسئلة' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(p_errors) e where e is null or e < 0 or e > 99) then
    raise exception 'عدد الأخطاء لكل سؤال يجب أن يكون بين 0 و 99' using errcode = 'check_violation';
  end if;

  update public.peer_test_attempt_questions q
  set errors_count = p_errors[q.question_number],
      notes = nullif(left(btrim(coalesce(p_question_notes[q.question_number], '')), 300), '')
  where q.attempt_id = p_attempt_id;

  select coalesce(sum(e), 0) into v_total from unnest(p_errors) e;
  v_passed := v_attempt.max_errors_snapshot is null or v_total <= v_attempt.max_errors_snapshot;

  update public.peer_test_attempts
  set status = case when v_passed then 'passed' else 'failed' end,
      total_errors = v_total,
      notes = nullif(left(btrim(coalesce(p_notes, '')), 300), ''),
      completed_at = now()
  where id = p_attempt_id
  returning * into v_saved;

  return jsonb_build_object('attempt', to_jsonb(v_saved));
end;
$$;

revoke all on function public.peer_test_save(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.peer_test_set_status(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.peer_test_start_attempt(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.peer_test_submit_attempt(uuid, uuid, integer[], text[], text)
  from public, anon, authenticated;

grant execute on function public.peer_test_save(uuid, uuid, text, integer, integer, integer, integer, integer, text, text, text, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.peer_test_set_status(uuid, text, uuid) to service_role;
grant execute on function public.peer_test_start_attempt(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.peer_test_submit_attempt(uuid, uuid, integer[], text[], text) to service_role;


-- ---------------------------------------------------------------------
-- 4. TASMI'A GUARD: mandatory peer-test checkpoint
-- ---------------------------------------------------------------------
--
-- Same checks as before (active cycle, same batch, same-batch active
-- listener, server-side listener name snapshot), plus: while a LIVE
-- MANDATORY test exists in this cycle, a quarter beyond its range_end is
-- rejected until the member has a passed attempt for that test.
-- Quarters inside or before the range are never affected.

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

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. NEW CYCLE: finish the old cycle's peer tests
-- ---------------------------------------------------------------------

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

    -- 4. Finish this cycle's peer tests (results stay as history).
    update public.peer_test_attempts
    set status = 'cancelled'
    where status = 'in_progress'
      and test_id in (select t.id from public.peer_tests t where t.cycle_id = v_current.id);

    update public.peer_tests
    set status = 'finished', finished_at = now(), updated_at = now()
    where cycle_id = v_current.id
      and status <> 'finished';
  end if;

  select coalesce(max(c.cycle_number), 0) + 1
  into v_next
  from public.cycles c
  where c.batch_id = p_batch_id;

  -- 5. Create the new active cycle.
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


-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.peer_tests                  enable row level security;
alter table public.peer_test_attempts          enable row level security;
alter table public.peer_test_attempt_questions enable row level security;

revoke all on public.peer_tests, public.peer_test_attempts, public.peer_test_attempt_questions from anon;
revoke insert, update, delete on public.peer_tests, public.peer_test_attempts, public.peer_test_attempt_questions
  from authenticated;
grant select on public.peer_tests, public.peer_test_attempts, public.peer_test_attempt_questions
  to authenticated;

drop policy if exists peer_tests_select on public.peer_tests;
create policy peer_tests_select
  on public.peer_tests for select to authenticated
  using (
    cycle_id in (select app_private.managed_cycle_ids())
    or (
      cycle_id = (select app_private.member_active_cycle_id())
      and app_private.peer_test_is_live(status, visible_from, visible_until)
    )
  );

drop policy if exists peer_test_attempts_select on public.peer_test_attempts;
create policy peer_test_attempts_select
  on public.peer_test_attempts for select to authenticated
  using (id in (select app_private.visible_peer_attempt_ids()));

drop policy if exists peer_test_attempt_questions_select on public.peer_test_attempt_questions;
create policy peer_test_attempt_questions_select
  on public.peer_test_attempt_questions for select to authenticated
  using (attempt_id in (select app_private.visible_peer_attempt_ids()));
