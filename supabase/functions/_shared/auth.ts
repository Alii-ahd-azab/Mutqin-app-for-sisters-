import {
  createClient,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2';

/*
 * Shared server-side helpers for the
 * admin Edge Functions.
 *
 * All permission decisions about batches
 * live here so admin-users and
 * admin-actions apply the same rules.
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
};

export function json(
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

export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/*
 * Server-side privileged client.
 * Never expose this key in React.
 */
export function createAdminClient(): SupabaseClient {
  const supabaseUrl =
    Deno.env.get('SUPABASE_URL');

  const serviceRoleKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(
      'إعدادات الخادم غير مكتملة',
      500,
    );
  }

  return createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

/*
 * Verifies the Bearer token and returns the
 * authenticated user's id.
 */
async function authenticateRequest(
  req: Request,
  admin: SupabaseClient,
): Promise<string> {
  const authHeader =
    req.headers.get('Authorization');

  if (
    !authHeader ||
    !authHeader.startsWith('Bearer ')
  ) {
    throw new HttpError(
      'يجب تسجيل الدخول أولاً',
      401,
    );
  }

  const token =
    authHeader.replace('Bearer ', '');

  const {
    data: authData,
    error: authError,
  } = await admin.auth.getUser(token);

  if (authError || !authData.user) {
    throw new HttpError(
      'جلسة تسجيل الدخول غير صالحة',
      401,
    );
  }

  return authData.user.id;
}

export type AdminCaller = {
  id: string;
  isMaster: boolean;
  managedBatchIds: Set<string>;
};

/*
 * Verifies the caller's session and that
 * they are an ACTIVE ADMIN, then loads
 * which batches they manage.
 */
export async function getAdminCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<AdminCaller> {
  const callerId =
    await authenticateRequest(req, admin);

  const {
    data: profile,
    error: profileError,
  } = await admin
    .from('profiles')
    .select('id, role, active, is_master_admin')
    .eq('id', callerId)
    .single();

  if (profileError || !profile) {
    throw new HttpError(
      'تعذر العثور على حساب المشرف',
      403,
    );
  }

  if (
    profile.role !== 'admin' ||
    profile.active !== true
  ) {
    throw new HttpError(
      'غير مصرح لك بتنفيذ هذا الإجراء',
      403,
    );
  }

  const isMaster =
    profile.is_master_admin === true;

  const managedBatchIds = new Set<string>();

  if (!isMaster) {
    const {
      data: memberships,
      error: membershipsError,
    } = await admin
      .from('batch_memberships')
      .select('batch_id')
      .eq('user_id', callerId)
      .eq('membership_role', 'admin');

    if (membershipsError) {
      throw new HttpError(
        membershipsError.message,
        500,
      );
    }

    for (const row of memberships || []) {
      managedBatchIds.add(row.batch_id);
    }
  }

  return {
    id: callerId,
    isMaster,
    managedBatchIds,
  };
}

export function canManageBatch(
  caller: AdminCaller,
  batchId: string,
): boolean {
  return (
    caller.isMaster ||
    caller.managedBatchIds.has(batchId)
  );
}

/*
 * Who may set another account's password
 * through admin-users (without knowing the
 * current one):
 * - members: yes (the batch permission is
 *   checked separately)
 * - batch admins: only by a master admin
 * - master admins and yourself: never here
 *   (your own password uses the normal
 *   current-password flow)
 */
export function canChangeAccountPassword(
  caller: AdminCaller,
  target: {
    id: string;
    role: string;
    is_master_admin: boolean;
  },
): boolean {
  if (target.id === caller.id) {
    return false;
  }

  if (target.role === 'member') {
    return true;
  }

  return (
    caller.isMaster &&
    target.role === 'admin' &&
    !target.is_master_admin
  );
}

export function requireMaster(
  caller: AdminCaller,
) {
  if (!caller.isMaster) {
    throw new HttpError(
      'هذا الإجراء متاح للمشرفة العامة فقط',
      403,
    );
  }
}

/*
 * Ensures the batch exists and the caller
 * manages it. Never trust a batch_id sent
 * from the browser without this check.
 */
export async function requireManagedBatch(
  admin: SupabaseClient,
  caller: AdminCaller,
  batchId: unknown,
): Promise<{ id: string; name: string }> {
  if (!isUuid(batchId)) {
    throw new HttpError(
      'معرف الدفعة غير صالح',
      400,
    );
  }

  if (!canManageBatch(caller, batchId)) {
    throw new HttpError(
      'لا تملكين صلاحية إدارة هذه الدفعة',
      403,
    );
  }

  const { data, error } = await admin
    .from('batches')
    .select('id, name, archived_at')
    .eq('id', batchId)
    .maybeSingle();

  if (error) {
    throw new HttpError(error.message, 500);
  }

  if (!data || data.archived_at) {
    throw new HttpError(
      'الدفعة غير موجودة',
      404,
    );
  }

  return { id: data.id, name: data.name };
}

/*
 * The single batch a member belongs to
 * (null for admins / unassigned users).
 */
export async function getMemberBatchId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('batch_memberships')
    .select('batch_id')
    .eq('user_id', userId)
    .eq('membership_role', 'member')
    .maybeSingle();

  if (error) {
    throw new HttpError(error.message, 500);
  }

  return data?.batch_id ?? null;
}

export function errorResponse(
  error: unknown,
  label: string,
) {
  if (error instanceof HttpError) {
    return json(
      { error: error.message },
      error.status,
    );
  }

  console.error(`${label} error:`, error);

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

export type ActiveCaller = {
  id: string;
  role: 'member' | 'admin';
  isMaster: boolean;
  managedBatchIds: Set<string>;
  // The member's current batch (null for admins).
  memberBatchId: string | null;
};

/*
 * Verifies the session of ANY active account
 * (member or admin) and loads its batch scope.
 * Used by features where members act too
 * (e.g. peer testing examiners).
 */
export async function getActiveCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<ActiveCaller> {
  const callerId =
    await authenticateRequest(req, admin);

  const {
    data: profile,
    error: profileError,
  } = await admin
    .from('profiles')
    .select('id, role, active, is_master_admin')
    .eq('id', callerId)
    .single();

  if (profileError || !profile || profile.active !== true) {
    throw new HttpError(
      'الحساب غير نشط أو غير موجود',
      403,
    );
  }

  const role: 'member' | 'admin' =
    profile.role === 'admin' ? 'admin' : 'member';

  const isMaster =
    role === 'admin' && profile.is_master_admin === true;

  const managedBatchIds = new Set<string>();
  let memberBatchId: string | null = null;

  const {
    data: memberships,
    error: membershipsError,
  } = await admin
    .from('batch_memberships')
    .select('batch_id, membership_role')
    .eq('user_id', callerId);

  if (membershipsError) {
    throw new HttpError(membershipsError.message, 500);
  }

  for (const row of memberships || []) {
    if (role === 'admin' && row.membership_role === 'admin') {
      managedBatchIds.add(row.batch_id);
    }
    if (role === 'member' && row.membership_role === 'member') {
      memberBatchId = row.batch_id;
    }
  }

  return {
    id: callerId,
    role,
    isMaster,
    managedBatchIds,
    memberBatchId,
  };
}
