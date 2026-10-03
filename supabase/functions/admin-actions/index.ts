import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
};

function json(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type':
          'application/json',
      },
    }
  );
}

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
    const supabaseUrl =
      Deno.env.get(
        'SUPABASE_URL'
      );

    const serviceRoleKey =
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY'
      );

    if (
      !supabaseUrl ||
      !serviceRoleKey
    ) {
      return json(
        {
          error:
            'إعدادات الخادم غير مكتملة',
        },
        500
      );
    }

    /*
     * Server-side privileged client.
     * Never expose this key in React.
     */
    const admin =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken:
              false,
            persistSession:
              false,
          },
        }
      );

    /*
     * ====================================
     * VERIFY LOGGED-IN CALLER
     * ====================================
     */

    const authHeader =
      req.headers.get(
        'Authorization'
      );

    if (
      !authHeader ||
      !authHeader.startsWith(
        'Bearer '
      )
    ) {
      return json(
        {
          error:
            'يجب تسجيل الدخول أولاً',
        },
        401
      );
    }

    const token =
      authHeader.replace(
        'Bearer ',
        ''
      );

    const {
      data: authData,
      error: authError,
    } =
      await admin.auth.getUser(
        token
      );

    if (
      authError ||
      !authData.user
    ) {
      return json(
        {
          error:
            'جلسة تسجيل الدخول غير صالحة',
        },
        401
      );
    }

    const caller =
      authData.user;

    /*
     * ====================================
     * VERIFY CALLER IS ACTIVE ADMIN
     * ====================================
     */

    const {
      data: callerProfile,
      error:
        callerProfileError,
    } =
      await admin
        .from('profiles')
        .select(
          'id, role, active'
        )
        .eq(
          'id',
          caller.id
        )
        .single();

    if (
      callerProfileError ||
      !callerProfile
    ) {
      return json(
        {
          error:
            'تعذر العثور على حساب المشرف',
        },
        403
      );
    }

    if (
      callerProfile.role !==
        'admin' ||
      callerProfile.active !==
        true
    ) {
      return json(
        {
          error:
            'غير مصرح لك بتنفيذ هذا الإجراء',
        },
        403
      );
    }

    const body =
      await req.json();

    const action =
      body?.action;

    /*
     * ====================================
     * FACTORY RESET / START NEW CYCLE
     * ====================================
     */

    if (
      action ===
      'factory-reset'
    ) {
      const today =
        getToday();

      /*
       * Get the currently active cycle.
       */
      const {
        data: currentCycle,
        error:
          currentCycleError,
      } =
        await admin
          .from('cycles')
          .select(
            `
            id,
            cycle_number,
            starts_on,
            status
            `
          )
          .eq(
            'status',
            'active'
          )
          .order(
            'cycle_number',
            {
              ascending:
                false,
            }
          )
          .limit(1)
          .maybeSingle();

      if (
        currentCycleError
      ) {
        return json(
          {
            error:
              currentCycleError.message,
          },
          500
        );
      }

      /*
       * If somehow no active cycle exists,
       * create Cycle 1 instead.
       */
      if (!currentCycle) {
        const {
          data: firstCycle,
          error:
            firstCycleError,
        } =
          await admin
            .from('cycles')
            .insert({
              cycle_number: 1,
              name:
                'الدورة 1',
              starts_on:
                today,
              status:
                'active',
              created_by:
                caller.id,
            })
            .select('*')
            .single();

        if (
          firstCycleError ||
          !firstCycle
        ) {
          return json(
            {
              error:
                firstCycleError
                  ?.message ||
                'تعذر إنشاء الدورة الجديدة',
            },
            500
          );
        }

        return json({
          success: true,
          cycle:
            firstCycle,
          message:
            'تم إنشاء الدورة الأولى وبدء اليوم رقم 1 بنجاح',
        });
      }

      const oldCycleId =
        currentCycle.id;

      const nextCycleNumber =
        Number(
          currentCycle.cycle_number ||
            0
        ) + 1;

      /*
       * ====================================
       * 1. CLOSE ACTIVE PAUSE, IF ANY
       * ====================================
       *
       * This keeps the archived cycle's
       * pause history complete.
       */

      const {
        error:
          closePauseError,
      } =
        await admin
          .from(
            'program_pauses'
          )
          .update({
            resumed_on:
              today,
          })
          .eq(
            'cycle_id',
            oldCycleId
          )
          .is(
            'resumed_on',
            null
          );

      if (
        closePauseError
      ) {
        return json(
          {
            error:
              closePauseError.message,
          },
          500
        );
      }

      /*
       * ====================================
       * 2. ARCHIVE CURRENT CYCLE
       * ====================================
       *
       * IMPORTANT:
       * We do NOT delete:
       *
       * - tasmia_submissions
       * - review_confirmations
       * - group_rest_days
       * - program_pauses
       *
       * They remain attached to this
       * archived cycle for historical stats.
       */

      const {
        error:
          archiveError,
      } =
        await admin
          .from('cycles')
          .update({
            status:
              'archived',
            ended_on:
              today,
          })
          .eq(
            'id',
            oldCycleId
          );

      if (archiveError) {
        return json(
          {
            error:
              archiveError.message,
          },
          500
        );
      }

      /*
       * ====================================
       * 3. UNPUBLISH CURRENT DAILY THOUGHT
       * ====================================
       *
       * Nothing is deleted.
       *
       * Previous thoughts remain stored
       * for the future history/feed feature.
       */

      const {
        error:
          thoughtError,
      } =
        await admin
          .from(
            'daily_thoughts'
          )
          .update({
            is_published:
              false,
          })
          .eq(
            'is_published',
            true
          );

      if (thoughtError) {
        /*
         * Restore old cycle if this fails
         * before the new cycle is created.
         */
        await admin
          .from('cycles')
          .update({
            status:
              'active',
            ended_on:
              null,
          })
          .eq(
            'id',
            oldCycleId
          );

        return json(
          {
            error:
              thoughtError.message,
          },
          500
        );
      }

      /*
       * ====================================
       * 4. CREATE NEW ACTIVE CYCLE
       * ====================================
       */

      const {
        data: newCycle,
        error:
          newCycleError,
      } =
        await admin
          .from('cycles')
          .insert({
            cycle_number:
              nextCycleNumber,

            name:
              `الدورة ${nextCycleNumber}`,

            starts_on:
              today,

            status:
              'active',

            created_by:
              caller.id,
          })
          .select('*')
          .single();

      if (
        newCycleError ||
        !newCycle
      ) {
        /*
         * If creating the new cycle fails,
         * restore the previous one as active.
         */
        await admin
          .from('cycles')
          .update({
            status:
              'active',
            ended_on:
              null,
          })
          .eq(
            'id',
            oldCycleId
          );

        return json(
          {
            error:
              newCycleError
                ?.message ||
              'تعذر إنشاء الدورة الجديدة',
          },
          500
        );
      }

      /*
       * ====================================
       * SUCCESS
       * ====================================
       */

      return json({
        success: true,

        previous_cycle_id:
          oldCycleId,

        previous_cycle_number:
          currentCycle.cycle_number,

        cycle:
          newCycle,

        message:
          `تم حفظ الدورة ${currentCycle.cycle_number} في السجل وبدء الدورة ${nextCycleNumber} من اليوم رقم 1 بنجاح`,
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
    console.error(
      'admin-actions error:',
      error
    );

    return json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : 'حدث خطأ غير متوقع',
      },
      500
    );
  }
});