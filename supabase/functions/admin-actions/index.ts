import {
  corsHeaders,
  json,
  HttpError,
  isUuid,
  createAdminClient,
  getAdminCaller,
  requireMaster,
  requireManagedBatch,
  errorResponse,
} from '../_shared/auth.ts';
// The program date (the day starts at 05:00 Africa/Cairo).
import { programDate } from '../_shared/logic/programDate.ts';

function isIsoDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const parsed = Date.parse(
    `${value}T00:00:00Z`
  );

  return (
    !Number.isNaN(parsed) &&
    new Date(parsed)
      .toISOString()
      .slice(0, 10) === value
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return json(
      {
        error:
          'طريقة الطلب غير مسموحة',
      },
      405
    );
  }

  try {
    const admin =
      createAdminClient();

    /*
     * Verifies the session and that the
     * caller is an ACTIVE ADMIN, and loads
     * the batches they manage.
     */
    const caller =
      await getAdminCaller(
        req,
        admin
      );

    const body =
      await req.json();

    const action =
      body?.action;

    /*
     * ====================================
     * FACTORY RESET / START NEW CYCLE
     * ====================================
     *
     * Scoped to ONE batch. Only that
     * batch's active cycle is archived
     * and only its daily thought is
     * unpublished. Nothing is deleted:
     * submissions, confirmations, rest
     * days and pauses stay attached to
     * the archived cycle.
     *
     * The database function runs all
     * steps in a single transaction.
     */
    if (
      action ===
      'factory-reset'
    ) {
      const batch =
        await requireManagedBatch(
          admin,
          caller,
          body.batch_id
        );

      if (
        body.cycle_id !== undefined &&
        body.cycle_id !== null &&
        !isUuid(body.cycle_id)
      ) {
        throw new HttpError(
          'معرف الدورة غير صالح',
          400
        );
      }

      const {
        data,
        error,
      } =
        await admin.rpc(
          'start_next_cycle',
          {
            p_batch_id:
              batch.id,
            p_today:
              programDate(),
            p_actor:
              caller.id,
            p_expected_cycle_id:
              body.cycle_id ?? null,
          }
        );

      if (error || !data) {
        return json(
          {
            error:
              error?.message ||
              'تعذر إنشاء الدورة الجديدة',
          },
          400
        );
      }

      const result = data as {
        previous_cycle_id: string | null;
        previous_cycle_number: number | null;
        cycle: {
          cycle_number: number;
        };
      };

      const nextNumber =
        result.cycle.cycle_number;

      return json({
        success: true,

        previous_cycle_id:
          result.previous_cycle_id,

        previous_cycle_number:
          result.previous_cycle_number,

        cycle:
          result.cycle,

        message:
          result.previous_cycle_number
            ? `تم حفظ الدورة ${result.previous_cycle_number} لـ«${batch.name}» في السجل وبدء الدورة ${nextNumber} من اليوم رقم 1 بنجاح`
            : `تم إنشاء الدورة الأولى لـ«${batch.name}» وبدء اليوم رقم 1 بنجاح`,
      });
    }

    /*
     * ====================================
     * CREATE NEW BATCH (master admin)
     * ====================================
     *
     * Creates the batch AND its Cycle 1
     * in one transaction, so a failure
     * never leaves a batch without a cycle.
     */
    if (
      action ===
      'create-batch'
    ) {
      requireMaster(caller);

      const name =
        String(
          body.name || ''
        ).trim();

      if (!name) {
        throw new HttpError(
          'اسم الدفعة مطلوب',
          400
        );
      }

      if (name.length > 100) {
        throw new HttpError(
          'اسم الدفعة طويل جداً',
          400
        );
      }

      if (
        !isIsoDate(
          body.start_date
        )
      ) {
        throw new HttpError(
          'تاريخ البداية غير صالح',
          400
        );
      }

      const {
        data,
        error,
      } =
        await admin.rpc(
          'create_batch_with_cycle',
          {
            p_name: name,
            p_start_date:
              body.start_date,
            p_actor:
              caller.id,
          }
        );

      if (error || !data) {
        if (
          error?.code ===
          '23505'
        ) {
          return json(
            {
              error:
                'توجد دفعة بهذا الاسم بالفعل',
            },
            409
          );
        }

        return json(
          {
            error:
              error?.message ||
              'تعذر إنشاء الدفعة',
          },
          400
        );
      }

      return json({
        success: true,
        batch: data,
        message:
          `تم إنشاء «${name}» بنجاح`,
      });
    }

    /*
     * ====================================
     * «المراجعة البعيدة» (distant-review days)
     * ====================================
     *
     * One manually chosen date per call (no
     * recurrence, no bulk). Master admin: any
     * batch; batch admin: her assigned batches
     * (checked here, before the service-role
     * database function). The database allows
     * only future dates, keeps past days as
     * history and refuses a rest-day date.
     */
    if (
      action ===
        'distant-review-create' ||
      action ===
        'distant-review-update' ||
      action ===
        'distant-review-delete'
    ) {
      let batchId =
        body.batch_id;
      let assignmentId: string | null =
        null;

      if (
        action !==
        'distant-review-create'
      ) {
        if (
          !isUuid(
            body.assignment_id
          )
        ) {
          throw new HttpError(
            'معرف يوم المراجعة البعيدة غير صالح',
            400
          );
        }

        const {
          data: existing,
          error: existingError,
        } =
          await admin
            .from('distant_review_assignments')
            .select('id, batch_id')
            .eq('id', body.assignment_id)
            .maybeSingle();

        if (existingError) {
          throw new HttpError(
            'تعذر قراءة يوم المراجعة البعيدة',
            500
          );
        }

        if (!existing) {
          throw new HttpError(
            'يوم المراجعة البعيدة غير موجود',
            404
          );
        }

        assignmentId =
          existing.id;
        batchId =
          existing.batch_id;
      }

      const batch =
        await requireManagedBatch(
          admin,
          caller,
          batchId
        );

      const rpc =
        action ===
        'distant-review-delete'
          ? admin.rpc(
              'distant_review_delete',
              {
                p_assignment_id:
                  assignmentId,
                p_batch_id:
                  batch.id,
              }
            )
          : (() => {
              if (
                !isIsoDate(
                  body.review_date
                )
              ) {
                throw new HttpError(
                  'يرجى تحديد تاريخ صحيح للمراجعة البعيدة',
                  400
                );
              }

              const start =
                Number(
                  body.start_quarter
                );
              const end =
                Number(
                  body.end_quarter
                );

              if (
                !Number.isInteger(start) ||
                !Number.isInteger(end) ||
                start < 1 ||
                end > 240 ||
                // «إلى الربع» is the stopping
                // boundary (its beginning).
                start >= end
              ) {
                throw new HttpError(
                  'نطاق الأرباع غير صالح: «إلى الربع» هو موضع التوقف (بداية ذلك الربع)، فيجب أن يكون بعد «من الربع» وضمن 1–240.',
                  400
                );
              }

              const note =
                String(
                  body.note ?? ''
                ).trim();

              if (note.length > 300) {
                throw new HttpError(
                  'الملاحظة طويلة جدًا (300 حرف كحد أقصى).',
                  400
                );
              }

              return admin.rpc(
                'distant_review_save',
                {
                  p_assignment_id:
                    assignmentId,
                  p_batch_id:
                    batch.id,
                  p_review_date:
                    body.review_date,
                  p_start_quarter:
                    start,
                  p_end_quarter:
                    end,
                  p_note:
                    note || null,
                  p_actor:
                    caller.id,
                }
              );
            })();

      const {
        data,
        error,
      } = await rpc;

      if (error || !data) {
        // Arabic messages raised by the database function are safe to show.
        const known =
          error?.code === '23514' ||
          error?.code === '23505' ||
          error?.code === 'P0002';

        if (!known) {
          console.error(
            'admin-actions distant-review failed',
            { action, batchId: batch.id, code: error?.code, message: error?.message }
          );
        }

        return json(
          {
            error:
              known && error?.message
                ? error.message
                : 'تعذر حفظ يوم المراجعة البعيدة',
          },
          error?.code === '23505'
            ? 409
            : error?.code === 'P0002'
            ? 404
            : 400
        );
      }

      return json({
        success: true,
        assignment: data,
        message:
          action ===
          'distant-review-create'
            ? `تمت إضافة يوم المراجعة البعيدة (${body.review_date})`
            : action ===
              'distant-review-update'
            ? 'تم تعديل يوم المراجعة البعيدة'
            : 'تم حذف يوم المراجعة البعيدة، وعاد هذا التاريخ يومًا عاديًا في البرنامج',
      });
    }

    /*
     * Unknown action
     */
    return json(
      {
        error:
          'إجراء غير معروف',
      },
      400
    );
  } catch (error) {
    return errorResponse(
      error,
      'admin-actions'
    );
  }
});
