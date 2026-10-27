import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  corsHeaders,
  json,
  HttpError,
  isUuid,
  createAdminClient,
  getActiveCaller,
  canManageBatch,
  errorResponse,
  type ActiveCaller,
} from '../_shared/auth.ts';
import type { MemberDelayStatus } from '../_shared/logic/memberDelayStatus.ts';
import { computeBatchDelays, loadBatchProgram } from '../_shared/logic/batchDelays.ts';
import { programDate } from '../_shared/logic/programDate.ts';
import { estimateRangeLines, generateTestQuestions, type TestQuestion } from '../_shared/peer-tests/testGenerator.ts';
import {
  evaluateCandidate,
  isPeerTestLive,
  nextTasmiaQuarter,
  type PeerTestRow,
} from '../_shared/peer-tests/eligibility.ts';

/*
 * PEER TESTING (اختبار الزملاء)
 *
 * Members (examiners) and admins call this function; it re-checks every
 * rule server-side and writes only through service-role-only database
 * functions. Pass/fail is computed in SQL from the stored questions.
 */

type CycleRow = {
  id: string;
  batch_id: string;
  cycle_number: number;
  starts_on: string;
  status: string;
};

type BatchMember = {
  id: string;
  name: string;
  joined_at: string;
};

type BatchProgress = {
  quarterOfDay: number;
  members: BatchMember[];
  delayById: Map<string, MemberDelayStatus>;
  completedById: Map<string, Set<number>>;
};

const PAGE = 1000;

function toInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

// Fetch every row (PostgREST caps responses at 1000 rows).
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new HttpError(error.message, 500);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function loadTest(admin: SupabaseClient, testId: unknown): Promise<{ test: PeerTestRow; cycle: CycleRow }> {
  if (!isUuid(testId)) throw new HttpError('معرف الاختبار غير صالح', 400);

  const { data: test, error } = await admin.from('peer_tests').select('*').eq('id', testId).maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!test) throw new HttpError('الاختبار غير موجود', 404);

  const { data: cycle, error: cycleError } = await admin
    .from('cycles')
    .select('id, batch_id, cycle_number, starts_on, status')
    .eq('id', test.cycle_id)
    .single();
  if (cycleError || !cycle) throw new HttpError('دورة الاختبار غير موجودة', 404);

  return { test: test as PeerTestRow, cycle: cycle as CycleRow };
}

async function loadActiveCycle(admin: SupabaseClient, batchId: string): Promise<CycleRow> {
  const { data, error } = await admin
    .from('cycles')
    .select('id, batch_id, cycle_number, starts_on, status')
    .eq('batch_id', batchId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw new HttpError(error.message, 500);
  if (!data) throw new HttpError('لا توجد دورة نشطة لهذه الدفعة', 400);
  return data as CycleRow;
}

/*
 * Progress of every active member of the cycle's batch, computed with the
 * SAME shared code as the dashboards (loadBatchProgram / computeBatchDelays:
 * pauses, rest days and «المراجعة البعيدة» days are non-program days) on the
 * program date (the day starts at 05:00 Africa/Cairo).
 */
async function loadBatchProgress(admin: SupabaseClient, cycle: CycleRow): Promise<BatchProgress> {
  let program;
  try {
    program = await loadBatchProgram(admin, cycle);
  } catch (e) {
    throw new HttpError((e as Error).message, 500);
  }
  const { cycleInfo, members, delayById } = computeBatchDelays(program, programDate());

  const completedById = new Map<string, Set<number>>(members.map((m) => [m.id, new Set<number>()]));
  for (const r of program.tasmia) {
    completedById.get(r.user_id)?.add(r.quarter_number);
  }

  return {
    quarterOfDay: cycleInfo.quarter_of_day,
    members: members.map((m) => ({ id: m.id, name: m.name, joined_at: m.joined_at })),
    delayById,
    completedById,
  };
}

async function passedCandidateIds(admin: SupabaseClient, testId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from('peer_test_attempts')
    .select('candidate_id')
    .eq('test_id', testId)
    .eq('status', 'passed');
  if (error) throw new HttpError(error.message, 500);
  return new Set((data || []).map((r) => r.candidate_id as string));
}

// Examiner rule: an active member of the test's batch. Elimination status
// is intentionally NOT checked for examiners.
function requireExaminer(caller: ActiveCaller, cycle: CycleRow, test: PeerTestRow) {
  if (caller.role !== 'member' || caller.memberBatchId !== cycle.batch_id) {
    throw new HttpError('اختبار الزملاء متاح لعضوات هذه الدفعة فقط', 403);
  }
  if (cycle.status !== 'active' || !isPeerTestLive(test)) {
    throw new HttpError('الاختبار غير متاح حاليًا', 400);
  }
}

function requireManager(caller: ActiveCaller, batchId: string) {
  if (caller.role !== 'admin' || !canManageBatch(caller, batchId)) {
    throw new HttpError('لا تملكين صلاحية إدارة اختبارات هذه الدفعة', 403);
  }
}

function questionPayload(questions: TestQuestion[]) {
  return questions.map((q) => ({
    question_number: q.question_number,
    start_surah: q.start_surah,
    start_surah_name: q.start_surah_name,
    start_ayah: q.start_ayah,
    end_surah: q.end_surah,
    end_surah_name: q.end_surah_name,
    end_ayah: q.end_ayah,
    start_page: q.start_page,
    start_line: q.start_line,
    end_page: q.end_page,
    end_line: q.end_line,
    actual_lines: q.actual_lines,
    difficulty_level: q.difficulty_level,
  }));
}

function generateOrFail(test: Pick<PeerTestRow, 'range_start' | 'range_end' | 'questions_count' | 'lines_per_question' | 'difficulty'>) {
  const questions = generateTestQuestions(
    test.range_start,
    test.range_end,
    test.questions_count,
    test.lines_per_question,
    test.difficulty || 'any'
  );
  if (questions.length < test.questions_count) {
    throw new HttpError('النطاق لا يتسع لهذا العدد من الأسئلة بهذا الطول', 422);
  }
  return questions;
}

// Arabic messages raised by our SQL functions are safe to show.
function rpcError(error: { code?: string; message: string; details?: string | null }, label: string): never {
  console.error(`peer-tests ${label} failed`, { code: error.code, message: error.message, details: error.details });
  if (error.code === '23514' || error.code === 'P0002' || error.code === 'P0001') {
    throw new HttpError(error.message, 400);
  }
  throw new HttpError('تعذر تنفيذ العملية. حاولي مرة أخرى.', 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'طريقة الطلب غير مسموحة' }, 405);
  }

  try {
    const admin = createAdminClient();
    const caller = await getActiveCaller(req, admin);
    const body = await req.json();
    const action = body?.action;

    /*
     * ============ MEMBER (EXAMINER) ACTIONS ============
     */

    // Candidates list with eligibility and Arabic reasons.
    if (action === 'candidates') {
      const { test, cycle } = await loadTest(admin, body.test_id);
      requireExaminer(caller, cycle, test);

      const [progress, passed] = await Promise.all([loadBatchProgress(admin, cycle), passedCandidateIds(admin, test.id)]);

      const candidates = progress.members
        .filter((m) => m.id !== caller.id)
        .map((m) => {
          const evaluation = evaluateCandidate({
            test,
            completedQuarters: progress.completedById.get(m.id) || new Set(),
            hasPassed: passed.has(m.id),
            delay: progress.delayById.get(m.id)!,
          });
          return { id: m.id, name: m.name, ...evaluation };
        })
        .sort((a, b) => Number(b.is_eligible) - Number(a.is_eligible) || a.name.localeCompare(b.name, 'ar'));

      return json({ candidates });
    }

    // Start a session: re-check both people, generate and store questions.
    if (action === 'start') {
      const { test, cycle } = await loadTest(admin, body.test_id);
      requireExaminer(caller, cycle, test);

      const candidateId = body.candidate_id;
      if (!isUuid(candidateId) || candidateId === caller.id) {
        throw new HttpError('يرجى اختيار أخت أخرى لاختبارها', 400);
      }

      const [progress, passed] = await Promise.all([loadBatchProgress(admin, cycle), passedCandidateIds(admin, test.id)]);
      const candidate = progress.members.find((m) => m.id === candidateId);
      if (!candidate) {
        throw new HttpError('العضوة المُختبَرة يجب أن تكون عضوة نشطة في هذه الدفعة', 400);
      }

      const evaluation = evaluateCandidate({
        test,
        completedQuarters: progress.completedById.get(candidate.id) || new Set(),
        hasPassed: passed.has(candidate.id),
        delay: progress.delayById.get(candidate.id)!,
      });
      if (!evaluation.is_eligible) {
        throw new HttpError(`العضوة غير مستوفية لشروط الاختبار: ${evaluation.reasons.join('، ')}`, 400);
      }

      const questions = generateOrFail(test);

      const { data: attemptId, error } = await admin.rpc('peer_test_start_attempt', {
        p_test_id: test.id,
        p_candidate_id: candidate.id,
        p_examiner_id: caller.id,
        p_questions: questionPayload(questions),
      });
      if (error || !attemptId) rpcError(error || { message: 'no attempt id' }, 'start');

      return json({
        attempt_id: attemptId,
        candidate: { id: candidate.id, name: candidate.name },
        questions,
      });
    }

    // Submit error counts only; pass/fail is computed in SQL.
    if (action === 'submit') {
      if (!isUuid(body.attempt_id)) throw new HttpError('معرف جلسة الاختبار غير صالح', 400);

      const { data: attempt, error: attemptError } = await admin
        .from('peer_test_attempts')
        .select('id, test_id, candidate_id, examiner_id, status')
        .eq('id', body.attempt_id)
        .maybeSingle();
      if (attemptError) throw new HttpError(attemptError.message, 500);
      if (!attempt || attempt.examiner_id !== caller.id) {
        throw new HttpError('جلسة الاختبار غير موجودة', 404);
      }

      const { test, cycle } = await loadTest(admin, attempt.test_id);
      requireExaminer(caller, cycle, test);

      // The candidate's elimination status is re-checked at submission time.
      const progress = await loadBatchProgress(admin, cycle);
      const delay = progress.delayById.get(attempt.candidate_id);
      if (!delay) {
        throw new HttpError('العضوة المُختبَرة لم تعد عضوة نشطة في هذه الدفعة', 400);
      }
      const evaluation = evaluateCandidate({
        test,
        completedQuarters: progress.completedById.get(attempt.candidate_id) || new Set(),
        hasPassed: false,
        delay,
      });
      if (!evaluation.is_eligible) {
        throw new HttpError(`العضوة غير مستوفية لشروط الاختبار: ${evaluation.reasons.join('، ')}`, 400);
      }

      const errors = Array.isArray(body.errors) ? body.errors.map(toInt) : [];
      if (errors.some((e: number | null) => e === null)) {
        throw new HttpError('عدد الأخطاء يجب أن يكون رقمًا صحيحًا', 400);
      }
      const questionNotes = Array.isArray(body.question_notes)
        ? body.question_notes.map((n: unknown) => (n == null ? '' : String(n).slice(0, 300)))
        : [];

      const { data, error } = await admin.rpc('peer_test_submit_attempt', {
        p_attempt_id: attempt.id,
        p_examiner_id: caller.id,
        p_errors: errors,
        p_question_notes: questionNotes,
        p_notes: body.notes ? String(body.notes).slice(0, 300) : null,
      });
      if (error || !data) rpcError(error || { message: 'no result' }, 'submit');

      const result = (data as { attempt: { status: string } }).attempt;
      return json({
        attempt: result,
        message:
          result.status === 'passed'
            ? 'تم اعتماد النتيجة: اجتازت العضوة الاختبار بنجاح'
            : 'تم اعتماد النتيجة: لم تجتز العضوة الاختبار (تجاوزت حد الأخطاء المسموح)',
      });
    }

    /*
     * ============ ADMIN ACTIONS (master or batch admin of that batch) ============
     */

    if (action === 'admin-save') {
      if (!isUuid(body.batch_id)) throw new HttpError('معرف الدفعة غير صالح', 400);
      requireManager(caller, body.batch_id);
      const cycle = await loadActiveCycle(admin, body.batch_id);

      const rangeStart = toInt(body.range_start);
      const rangeEnd = toInt(body.range_end);
      const questionsCount = toInt(body.questions_count);
      const linesPerQuestion = toInt(body.lines_per_question);
      if (rangeStart === null || rangeStart < 1 || rangeStart > 240 || rangeEnd === null || rangeEnd < 1 || rangeEnd > 240) {
        throw new HttpError('بداية ونهاية النطاق يجب أن تكونا بين الربع 1 والربع 240', 400);
      }
      if (rangeStart > rangeEnd) throw new HttpError('بداية النطاق يجب أن تسبق نهايته أو تساويها', 400);
      if (questionsCount === null || questionsCount < 1 || questionsCount > 50) {
        throw new HttpError('عدد الأسئلة يجب أن يكون بين 1 و 50', 400);
      }
      if (linesPerQuestion === null || linesPerQuestion < 1 || linesPerQuestion > 60) {
        throw new HttpError('عدد الأسطر لكل سؤال يجب أن يكون بين 1 و 60', 400);
      }
      if (questionsCount * linesPerQuestion > 0.8 * estimateRangeLines(rangeStart, rangeEnd)) {
        throw new HttpError('النطاق لا يتسع لهذا العدد من الأسئلة بهذا الطول، قلّلي العدد أو الأسطر أو وسّعي النطاق', 400);
      }

      let maxErrors: number | null = null;
      if (body.max_errors !== null && body.max_errors !== undefined && body.max_errors !== '') {
        maxErrors = toInt(body.max_errors);
        if (maxErrors === null || maxErrors < 0 || maxErrors > 100) {
          throw new HttpError('حد الأخطاء يجب أن يكون بين 0 و 100', 400);
        }
      }

      const testType = body.test_type === 'recommended' ? 'recommended' : 'mandatory';
      const difficulty = ['any', 'easy', 'medium', 'hard', 'mixed'].includes(body.difficulty) ? body.difficulty : 'any';

      const parseTime = (v: unknown): string | null => {
        if (v === null || v === undefined || v === '') return null;
        const t = Date.parse(String(v));
        if (Number.isNaN(t)) throw new HttpError('تاريخ العرض غير صالح', 400);
        return new Date(t).toISOString();
      };

      let status: 'draft' | 'published' | 'hidden';
      let visibleFrom: string | null = null;
      let visibleUntil: string | null = parseTime(body.visible_until);
      switch (body.visibility) {
        case 'now':
          status = 'published';
          break;
        case 'schedule':
          status = 'published';
          visibleFrom = parseTime(body.visible_from);
          if (!visibleFrom) throw new HttpError('يرجى تحديد موعد بدء العرض', 400);
          break;
        case 'hidden':
          status = 'hidden';
          visibleFrom = parseTime(body.visible_from);
          break;
        default:
          status = 'draft';
          visibleFrom = parseTime(body.visible_from);
      }
      if (visibleFrom && visibleUntil && Date.parse(visibleFrom) >= Date.parse(visibleUntil)) {
        throw new HttpError('موعد انتهاء العرض يجب أن يكون بعد موعد بدئه', 400);
      }

      // The range must be able to hold the questions.
      generateOrFail({
        range_start: rangeStart,
        range_end: rangeEnd,
        questions_count: questionsCount,
        lines_per_question: linesPerQuestion,
        difficulty,
      });

      const title = String(body.title || '').trim().slice(0, 120) || `اختبار الأرباع (${rangeStart} - ${rangeEnd})`;

      const { data, error } = await admin.rpc('peer_test_save', {
        p_test_id: isUuid(body.test_id) ? body.test_id : null,
        p_cycle_id: cycle.id,
        p_title: title,
        p_range_start: rangeStart,
        p_range_end: rangeEnd,
        p_questions_count: questionsCount,
        p_lines_per_question: linesPerQuestion,
        p_max_errors: maxErrors,
        p_test_type: testType,
        p_difficulty: difficulty,
        p_status: status,
        p_visible_from: visibleFrom,
        p_visible_until: visibleUntil,
        p_actor: caller.id,
      });
      if (error || !data) rpcError(error || { message: 'no result' }, 'admin-save');

      const saved = data as { test: PeerTestRow; versioned: boolean };
      return json({
        ...saved,
        message: saved.versioned
          ? 'لوجود نتائج سابقة، حُفظت التعديلات كاختبار جديد وأُنهي الاختبار السابق مع الاحتفاظ بنتائجه'
          : 'تم حفظ الاختبار بنجاح',
      });
    }

    if (action === 'admin-status') {
      const { test, cycle } = await loadTest(admin, body.test_id);
      requireManager(caller, cycle.batch_id);
      if (!['show', 'hide', 'finish'].includes(body.status_action)) {
        throw new HttpError('إجراء غير معروف', 400);
      }
      const { data, error } = await admin.rpc('peer_test_set_status', {
        p_test_id: test.id,
        p_action: body.status_action,
        p_actor: caller.id,
      });
      if (error || !data) rpcError(error || { message: 'no result' }, 'admin-status');
      const messages: Record<string, string> = {
        show: 'أصبح الاختبار ظاهرًا الآن',
        hide: 'تم إخفاء الاختبار',
        finish: 'تم إنهاء الاختبار نهائيًا',
      };
      return json({ ...(data as object), message: messages[body.status_action] });
    }

    if (action === 'admin-preview') {
      const { test, cycle } = await loadTest(admin, body.test_id);
      requireManager(caller, cycle.batch_id);
      return json({ questions: generateOrFail(test) });
    }

    // How many members would be blocked right now by this (mandatory) test.
    if (action === 'admin-impact') {
      const { test, cycle } = await loadTest(admin, body.test_id);
      requireManager(caller, cycle.batch_id);
      const [progress, passed] = await Promise.all([loadBatchProgress(admin, cycle), passedCandidateIds(admin, test.id)]);
      const blocked = progress.members.filter(
        (m) =>
          !passed.has(m.id) &&
          nextTasmiaQuarter(progress.delayById.get(m.id)!, progress.quarterOfDay) > test.range_end
      );
      return json({
        blocked_count: test.test_type === 'mandatory' ? blocked.length : 0,
        blocked_members: test.test_type === 'mandatory' ? blocked.map((m) => ({ id: m.id, name: m.name })) : [],
      });
    }

    return json({ error: 'إجراء غير معروف' }, 400);
  } catch (error) {
    return errorResponse(error, 'peer-tests');
  }
});
