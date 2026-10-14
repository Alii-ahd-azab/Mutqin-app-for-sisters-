import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import {
  corsHeaders,
  json,
  HttpError,
  isUuid,
  createAdminClient,
  getAdminCaller,
  canManageBatch,
  requireMaster,
  requireManagedBatch,
  getMemberBatchId,
  errorResponse,
  type AdminCaller,
} from '../_shared/auth.ts';

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string;
  role: 'member' | 'admin';
  active: boolean;
  created_at: string;
  is_master_admin: boolean;
};

const PROFILE_COLUMNS =
  'id, full_name, phone, role, active, created_at, is_master_admin';

function normalizePhone(phone: string) {
  return String(phone || '')
    .replace(/\s+/g, '')
    .trim();
}

function phoneToEmail(phone: string) {
  return `${normalizePhone(phone)}@members.mutqin.local`;
}

function mapProfile(profile: ProfileRow) {
  return {
    id: profile.id,
    name: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    is_active: profile.active,
    created_at: profile.created_at,
    auth_uid: profile.id,
    is_master_admin: !!profile.is_master_admin,
  };
}

/*
 * Validates a list of batch IDs sent by a
 * master admin: all must be UUIDs of
 * existing, non-archived batches.
 */
async function validateBatchIds(
  admin: SupabaseClient,
  value: unknown,
): Promise<string[]> {
  if (!Array.isArray(value)) {
    throw new HttpError(
      'قائمة الدفعات غير صالحة',
      400,
    );
  }

  const ids = Array.from(new Set(value));

  if (ids.length === 0) {
    throw new HttpError(
      'يرجى اختيار دفعة واحدة على الأقل',
      400,
    );
  }

  if (!ids.every(isUuid)) {
    throw new HttpError(
      'معرف دفعة غير صالح',
      400,
    );
  }

  const { data, error } = await admin
    .from('batches')
    .select('id')
    .in('id', ids)
    .is('archived_at', null);

  if (error) {
    throw new HttpError(error.message, 500);
  }

  if ((data || []).length !== ids.length) {
    throw new HttpError(
      'إحدى الدفعات المختارة غير موجودة',
      400,
    );
  }

  return ids as string[];
}

async function loadProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<ProfileRow> {
  const { data, error } = await admin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(error.message, 500);
  }

  if (!data) {
    throw new HttpError(
      'العضو غير موجود',
      404,
    );
  }

  return data as ProfileRow;
}

/*
 * Who may manage an existing account:
 * - members: master admins, or admins of
 *   the member's batch
 * - admins: master admins only (an admin
 *   may also edit their own basic data)
 */
async function requireCanManageAccount(
  admin: SupabaseClient,
  caller: AdminCaller,
  target: ProfileRow,
) {
  if (target.role === 'admin') {
    if (
      !caller.isMaster &&
      target.id !== caller.id
    ) {
      throw new HttpError(
        'إدارة حسابات المشرفات متاحة للمشرفة العامة فقط',
        403,
      );
    }

    return;
  }

  if (caller.isMaster) {
    return;
  }

  const batchId =
    await getMemberBatchId(admin, target.id);

  if (
    !batchId ||
    !canManageBatch(caller, batchId)
  ) {
    throw new HttpError(
      'لا تملكين صلاحية إدارة هذه العضوة',
      403,
    );
  }
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
    const admin = createAdminClient();

    /*
     * Verify the caller's session and that
     * they are an ACTIVE ADMIN.
     */
    const caller =
      await getAdminCaller(req, admin);

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

      if (password.length < 6) {
        return json(
          {
            error:
              'كلمة المرور يجب أن تكون 6 أحرف أو أكثر',
          },
          400,
        );
      }

      /*
       * Resolve and authorize the batch
       * assignment BEFORE creating anything.
       */
      let memberBatchId: string | null = null;
      let isMasterAdmin = false;
      let adminBatchIds: string[] = [];

      if (role === 'member') {
        const batch =
          await requireManagedBatch(
            admin,
            caller,
            body.batch_id,
          );

        memberBatchId = batch.id;
      } else {
        /*
         * Only a master admin may create
         * admin accounts of any type.
         */
        requireMaster(caller);

        isMasterAdmin =
          body.is_master_admin === true;

        if (!isMasterAdmin) {
          adminBatchIds =
            await validateBatchIds(
              admin,
              body.batch_ids,
            );
        }
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
       * Create the profile and its batch
       * membership(s) in ONE database
       * transaction.
       */
      const {
        error: profileError,
      } =
        await admin.rpc(
          'create_profile_with_membership',
          {
            p_id: newUserId,
            p_full_name: name,
            p_phone: phone,
            p_role: role,
            p_is_master_admin: isMasterAdmin,
            p_member_batch_id: memberBatchId,
            p_admin_batch_ids: adminBatchIds,
            p_actor: caller.id,
          },
        );

      let profile: ProfileRow | null = null;

      if (!profileError) {
        const {
          data: created,
        } = await admin
          .from('profiles')
          .select(PROFILE_COLUMNS)
          .eq('id', newUserId)
          .maybeSingle();

        profile = (created as ProfileRow) || null;
      }

      if (
        profileError ||
        !profile
      ) {
        /*
         * Roll back the Auth user so no
         * orphan login is left behind.
         */
        const {
          error: rollbackError,
        } =
          await admin.auth.admin
            .deleteUser(newUserId);

        if (rollbackError) {
          console.error(
            'admin-users rollback failed:',
            newUserId,
            rollbackError,
          );
        }

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

      if (!isUuid(userId)) {
        return json(
          {
            error:
              'معرف العضو مطلوب',
          },
          400,
        );
      }

      const existingProfile =
        await loadProfile(admin, userId);

      await requireCanManageAccount(
        admin,
        caller,
        existingProfile,
      );

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

      /*
       * Changing an account between member
       * and admin would break its batch
       * memberships, so it is not supported.
       */
      if (
        body.role !== undefined &&
        body.role !== existingProfile.role
      ) {
        return json(
          {
            error:
              'تغيير نوع الحساب غير مدعوم حالياً',
          },
          400,
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

        if (password.length < 6) {
          return json(
            {
              error:
                'كلمة المرور يجب أن تكون 6 أحرف أو أكثر',
            },
            400,
          );
        }

        authUpdate.password =
          password;
      }

      /*
       * Exclusion / reactivation only flips
       * the account flags. The batch
       * membership is kept untouched, so a
       * reactivated member returns to the
       * SAME batch with all history intact.
       */
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

      const updatedProfile =
        await loadProfile(admin, userId);

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

      if (!isUuid(userId)) {
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

      const target =
        await loadProfile(admin, userId);

      await requireCanManageAccount(
        admin,
        caller,
        target,
      );

      /*
       * profiles.id references auth.users
       * with ON DELETE CASCADE, and
       * batch_memberships.user_id references
       * profiles with ON DELETE CASCADE,
       * so deleting the Auth user also
       * removes the profile and memberships.
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

    /*
     * =================================
     * SET BATCH ADMIN ASSIGNMENTS
     * (master admin only)
     * =================================
     */
    if (action === 'set-admin-batches') {
      requireMaster(caller);

      const userId =
        String(
          body.user_id || '',
        );

      if (!isUuid(userId)) {
        return json(
          {
            error:
              'معرف المشرفة مطلوب',
          },
          400,
        );
      }

      const target =
        await loadProfile(admin, userId);

      if (
        target.role !== 'admin' ||
        target.is_master_admin
      ) {
        return json(
          {
            error:
              'يمكن تعيين الدفعات لمشرفات الدفعات فقط',
          },
          400,
        );
      }

      const batchIds =
        await validateBatchIds(
          admin,
          body.batch_ids,
        );

      const {
        error: setError,
      } =
        await admin.rpc(
          'set_admin_batches',
          {
            p_user_id: userId,
            p_batch_ids: batchIds,
            p_actor: caller.id,
          },
        );

      if (setError) {
        return json(
          {
            error:
              setError.message,
          },
          400,
        );
      }

      return json({
        success: true,
        message:
          'تم تحديث دفعات المشرفة بنجاح',
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
    return errorResponse(
      error,
      'admin-users',
    );
  }
});
