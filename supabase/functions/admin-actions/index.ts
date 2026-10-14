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

function getToday(): string {
  return new Intl.DateTimeFormat(
    'en-CA',
    {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }
  ).format(new Date());
}

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
              getToday(),
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
