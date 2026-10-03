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
  status = 200,
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    },
  );
}

function normalizePhone(phone: string) {
  return String(phone || '')
    .replace(/\s+/g, '')
    .trim();
}

function phoneToEmail(phone: string) {
  return `${normalizePhone(phone)}@members.mutqin.local`;
}

function mapProfile(profile: any) {
  return {
    id: profile.id,
    name: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    is_active: profile.active,
    created_at: profile.created_at,
    auth_uid: profile.id,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    });
  }

  if (req.method !== 'POST') {
    return json(
      { error: 'Method not allowed' },
      405,
    );
  }

  try {
    const supabaseUrl =
      Deno.env.get('SUPABASE_URL');

    const serviceRoleKey =
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY',
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
        500,
      );
    }

    /*
     * This client has server-side admin
     * privileges. It never reaches the browser.
     */
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    /*
     * Verify the caller's logged-in
     * Supabase session.
     */
    const authHeader =
      req.headers.get('Authorization');

    if (
      !authHeader ||
      !authHeader.startsWith('Bearer ')
    ) {
      return json(
        {
          error:
            'يجب تسجيل الدخول أولاً',
        },
        401,
      );
    }

    const token =
      authHeader.replace(
        'Bearer ',
        '',
      );

    const {
      data: userData,
      error: userError,
    } =
      await admin.auth.getUser(token);

    if (
      userError ||
      !userData.user
    ) {
      return json(
        {
          error:
            'جلسة تسجيل الدخول غير صالحة',
        },
        401,
      );
    }

    const caller =
      userData.user;

    /*
     * Verify that the caller is an
     * ACTIVE ADMIN in profiles.
     */
    const {
      data: callerProfile,
      error: callerProfileError,
    } =
      await admin
        .from('profiles')
        .select(
          'id, role, active',
        )
        .eq('id', caller.id)
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
        403,
      );
    }

    if (
      callerProfile.role !== 'admin' ||
      callerProfile.active !== true
    ) {
      return json(
        {
          error:
            'غير مصرح لك بتنفيذ هذا الإجراء',
        },
        403,
      );
    }

    const body =
      await req.json();

    const action =
      body?.action;

    /*
     * =================================
     * CREATE MEMBER / ADMIN
     * =================================
     */
    if (action === 'create') {
      const name =
        String(body.name || '').trim();

      const phone =
        normalizePhone(body.phone);

      const password =
        String(body.password || '');

      const role =
        body.role === 'admin'
          ? 'admin'
          : 'member';

      if (!name) {
        return json(
          {
            error:
              'الاسم مطلوب',
          },
          400,
        );
      }

      if (!phone) {
        return json(
          {
            error:
              'رقم الهاتف مطلوب',
          },
          400,
        );
      }


      const email =
        phoneToEmail(phone);

      /*
       * Create Supabase Auth user.
       */
      const {
        data: createdAuth,
        error: createAuthError,
      } =
        await admin.auth.admin
          .createUser({
            email,
            password,
            email_confirm: true,
          });

      if (
        createAuthError ||
        !createdAuth.user
      ) {
        const message =
          createAuthError?.message ||
          'تعذر إنشاء الحساب';

        if (
          message
            .toLowerCase()
            .includes('already')
        ) {
          return json(
            {
              error:
                'يوجد حساب بهذا الرقم بالفعل',
            },
            409,
          );
        }

        return json(
          { error: message },
          400,
        );
      }

      const newUserId =
        createdAuth.user.id;

      /*
       * Create matching application
       * profile.
       */
      const {
        data: profile,
        error: profileError,
      } =
        await admin
          .from('profiles')
          .insert({
            id: newUserId,
            full_name: name,
            phone,
            role,
            active: true,
          })
          .select(
            `
            id,
            full_name,
            phone,
            role,
            active,
            created_at
            `,
          )
          .single();

      if (
        profileError ||
        !profile
      ) {
        /*
         * Roll back Auth user if profile
         * creation failed.
         */
        await admin.auth.admin
          .deleteUser(newUserId);

        return json(
          {
            error:
              profileError?.message ||
              'تعذر إنشاء ملف العضو',
          },
          400,
        );
      }

      return json({
        user: mapProfile(profile),
        message:
          role === 'admin'
            ? 'تمت إضافة المشرفة بنجاح'
            : 'تمت إضافة العضوة بنجاح',
      });
    }

    /*
     * =================================
     * UPDATE MEMBER / ADMIN
     * =================================
     */
    if (action === 'update') {
      const userId =
        String(
          body.user_id || '',
        );

      if (!userId) {
        return json(
          {
            error:
              'معرف العضو مطلوب',
          },
          400,
        );
      }

      const {
        data: existingProfile,
        error: existingError,
      } =
        await admin
          .from('profiles')
          .select(
            `
            id,
            full_name,
            phone,
            role,
            active,
            created_at
            `,
          )
          .eq('id', userId)
          .single();

      if (
        existingError ||
        !existingProfile
      ) {
        return json(
          {
            error:
              'العضو غير موجود',
          },
          404,
        );
      }
      if (
  body.password !== undefined &&
  body.password !== '' &&
  existingProfile.role === 'admin'
) {
  return json(
    {
      error:
        'لا يمكن للمشرف تغيير كلمة مرور مشرف آخر',
    },
    403,
  );
}

      const profileUpdate:
        Record<string, unknown> = {};

      const authUpdate:
        Record<string, unknown> = {};

      if (
        body.name !== undefined
      ) {
        const name =
          String(
            body.name,
          ).trim();

        if (!name) {
          return json(
            {
              error:
                'الاسم غير صالح',
            },
            400,
          );
        }

        profileUpdate.full_name =
          name;
      }

      if (
        body.phone !== undefined
      ) {
        const phone =
          normalizePhone(
            body.phone,
          );

        if (!phone) {
          return json(
            {
              error:
                'رقم الهاتف غير صالح',
            },
            400,
          );
        }

        profileUpdate.phone =
          phone;

        authUpdate.email =
          phoneToEmail(phone);
      }

      if (
        body.password !== undefined &&
        body.password !== ''
      ) {
        const password =
          String(body.password);


        authUpdate.password =
          password;
      }

      if (
        body.role !== undefined
      ) {
        if (
          body.role !== 'member' &&
          body.role !== 'admin'
        ) {
          return json(
            {
              error:
                'الدور غير صالح',
            },
            400,
          );
        }

        /*
         * Prevent accidentally removing
         * your own admin permissions.
         */
        if (
          userId === caller.id &&
          body.role !== 'admin'
        ) {
          return json(
            {
              error:
                'لا يمكنك إزالة صلاحية المشرف من حسابك الحالي',
            },
            400,
          );
        }

        profileUpdate.role =
          body.role;
      }

      if (
        body.is_active !==
        undefined
      ) {
        const active =
          Boolean(
            body.is_active,
          );

        if (
          userId === caller.id &&
          active === false
        ) {
          return json(
            {
              error:
                'لا يمكنك إيقاف حسابك الحالي',
            },
            400,
          );
        }

        profileUpdate.active =
          active;

        profileUpdate.deactivated_at =
          active
            ? null
            : new Date()
                .toISOString();
      }

      /*
       * Update Auth email/password if
       * needed.
       */
      if (
        Object.keys(authUpdate)
          .length > 0
      ) {
        const {
          error: authUpdateError,
        } =
          await admin.auth.admin
            .updateUserById(
              userId,
              authUpdate,
            );

        if (authUpdateError) {
          return json(
            {
              error:
                authUpdateError.message,
            },
            400,
          );
        }
      }

      if (
        Object.keys(profileUpdate)
          .length > 0
      ) {
        const {
          error: profileUpdateError,
        } =
          await admin
            .from('profiles')
            .update(
              profileUpdate,
            )
            .eq('id', userId);

        if (
          profileUpdateError
        ) {
          return json(
            {
              error:
                profileUpdateError.message,
            },
            400,
          );
        }
      }

      const {
        data: updatedProfile,
        error: reloadError,
      } =
        await admin
          .from('profiles')
          .select(
            `
            id,
            full_name,
            phone,
            role,
            active,
            created_at
            `,
          )
          .eq('id', userId)
          .single();

      if (
        reloadError ||
        !updatedProfile
      ) {
        return json(
          {
            error:
              'تم التحديث ولكن تعذر إعادة تحميل العضو',
          },
          500,
        );
      }

      return json({
        user:
          mapProfile(
            updatedProfile,
          ),

        message:
          'تم تحديث الحساب بنجاح',
      });
    }

    /*
     * =================================
     * DELETE MEMBER COMPLETELY
     * =================================
     */
    if (action === 'delete') {
      const userId =
        String(
          body.user_id || '',
        );

      if (!userId) {
        return json(
          {
            error:
              'معرف العضو مطلوب',
          },
          400,
        );
      }

      if (
        userId === caller.id
      ) {
        return json(
          {
            error:
              'لا يمكنك حذف حسابك الحالي',
          },
          400,
        );
      }

      /*
       * profiles.id references auth.users
       * with ON DELETE CASCADE,
       * so deleting the Auth user also
       * removes the profile.
       */
      const {
        error: deleteError,
      } =
        await admin.auth.admin
          .deleteUser(userId);

      if (deleteError) {
        return json(
          {
            error:
              deleteError.message,
          },
          400,
        );
      }

      return json({
        success: true,
        message:
          'تم حذف الحساب نهائياً',
      });
    }

    return json(
      {
        error:
          'إجراء غير معروف',
      },
      400,
    );
  } catch (error) {
    console.error(
      'admin-users error:',
      error,
    );

    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'حدث خطأ غير متوقع',
      },
      500,
    );
  }
});