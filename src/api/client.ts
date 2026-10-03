import {
  User,
  GroupSettings,
  RestDay,
  RecitationLog,
  RevisionLog,
  CycleInfo,
} from '../types';

import { supabase } from '../lib/supabase';

import {
  formatDate,
  calculateCycleInfo,
  getActiveCycleDates,
} from '../lib/calculations';

import { phoneToAuthEmail } from '../lib/authHelpers';


type CycleRow = {
  id: string;
  cycle_number: number;
  name: string | null;
  starts_on: string;
  status: 'active' | 'archived';
  ended_on: string | null;
  created_by: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string;
  role: 'member' | 'admin';
  active: boolean;
  created_at: string;
  deactivated_at: string | null;
};

type RestDayRow = {
  id: string;
  cycle_id: string;
  rest_date: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type PauseRow = {
  id: string;
  cycle_id: string;
  paused_on: string;
  resumed_on: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

type ThoughtRow = {
  id: string;
  content_html: string;
  published_by: string | null;
  published_at: string;
  is_published: boolean;
};


function mapProfile(row: ProfileRow): User {
  return {
    id: row.id,
    name: row.full_name,
    phone: row.phone,
    role: row.role,
    is_active: row.active,
    created_at: row.created_at,
    auth_uid: row.id,
  };
}


async function getCurrentAuthUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error('يجب تسجيل الدخول أولاً');
  }

  return user;
}


async function getCurrentProfile(): Promise<ProfileRow> {
  const user = await getCurrentAuthUser();

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, role, active, created_at, deactivated_at'
    )
    .eq('id', user.id)
    .single();

  if (error) {
    throw error;
  }

  return data as ProfileRow;
}


async function getAllProfiles(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, role, active, created_at, deactivated_at'
    )
    .order('created_at', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []) as ProfileRow[];
}


async function getActiveCycle(): Promise<CycleRow> {
  const { data, error } = await supabase
    .from('cycles')
    .select('*')
    .eq('status', 'active')
    .order('cycle_number', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data as CycleRow;
  }

  const profile = await getCurrentProfile();

  if (profile.role !== 'admin') {
    throw new Error(
      'لا توجد دورة نشطة حالياً'
    );
  }

  const today = formatDate(new Date());

  const { data: created, error: createError } =
    await supabase
      .from('cycles')
      .insert({
        cycle_number: 1,
        name: 'الدورة الأولى',
        starts_on: today,
        status: 'active',
        created_by: profile.id,
      })
      .select('*')
      .single();

  if (createError) {
    throw createError;
  }

  return created as CycleRow;
}


async function getRestDayRows(
  cycleId: string
): Promise<RestDayRow[]> {
  const { data, error } = await supabase
    .from('group_rest_days')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('rest_date', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []) as RestDayRow[];
}


async function getPauseRows(
  cycleId: string
): Promise<PauseRow[]> {
  const { data, error } = await supabase
    .from('program_pauses')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('paused_on', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data || []) as PauseRow[];
}


function dayDifference(
  startDate: string,
  endDate: string
): number {
  const start = Date.parse(
    `${startDate}T00:00:00Z`
  );

  const end = Date.parse(
    `${endDate}T00:00:00Z`
  );

  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    end <= start
  ) {
    return 0;
  }

  return Math.floor(
    (end - start) /
      (1000 * 60 * 60 * 24)
  );
}


function buildSettings(
  cycle: CycleRow,
  pauses: PauseRow[],
  latestThought?: ThoughtRow | null,
  publisherName?: string
): GroupSettings {
  const currentPause =
    pauses.find(
      (pause) => pause.resumed_on === null
    ) || null;

  const completedPauseDays =
    pauses.reduce((total, pause) => {
      if (!pause.resumed_on) {
        return total;
      }

      return (
        total +
        dayDifference(
          pause.paused_on,
          pause.resumed_on
        )
      );
    }, 0);

  return {
    id: cycle.id,
    start_date: cycle.starts_on,
    total_quarters: 240,
    review_window: 8,
    current_cycle_number: cycle.cycle_number,
    is_paused: !!currentPause,
    paused_at: currentPause?.paused_on || null,
    total_paused_days: completedPauseDays,
    daily_thought: latestThought?.content_html || '',
    daily_thought_updated_at:
      latestThought?.published_at,
    daily_thought_updated_by:
      publisherName,
  };
}


function mapRestDays(
  rows: RestDayRow[],
  userMap: Map<string, User>
): RestDay[] {
  return rows.map((row) => ({
    id: row.id,
    date: row.rest_date,
    note: row.reason || '',
    added_by_admin_id:
      row.created_by || '',
    added_by_name:
      row.created_by
        ? userMap.get(row.created_by)?.name
        : undefined,
    created_at: row.created_at,
  }));
}


async function getLatestThought(): Promise<ThoughtRow | null> {
  const { data, error } = await supabase
    .from('daily_thoughts')
    .select('*')
    .eq('is_published', true)
    .order('published_at', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? (data as ThoughtRow)
    : null;
}


async function buildBootstrap() {
  const [cycle, profiles] = await Promise.all([
    getActiveCycle(),
    getAllProfiles(),
  ]);

  const [
    restRows,
    pauseRows,
    latestThought,
  ] = await Promise.all([
    getRestDayRows(cycle.id),
    getPauseRows(cycle.id),
    getLatestThought(),
  ]);

  const users = profiles.map(mapProfile);

  const userMap = new Map(
    users.map((user) => [
      user.id,
      user,
    ])
  );

  const publisherName =
    latestThought?.published_by
      ? userMap.get(
          latestThought.published_by
        )?.name
      : undefined;

  const settings =
    buildSettings(
      cycle,
      pauseRows,
      latestThought,
      publisherName
    );

  const restDays =
    mapRestDays(
      restRows,
      userMap
    );

  const cycleInfo =
    calculateCycleInfo(
      settings,
      restDays,
      formatDate(new Date())
    );

  return {
    cycle,
    cycleInfo,
    settings,
    restDays,
    users,
  };
}


async function getRecitationRows(
  cycleId: string
) {
  const { data, error } = await supabase
    .from('tasmia_submissions')
    .select(
      `
      id,
      cycle_id,
      user_id,
      listener_id,
      quarter_number,
      notes,
      submitted_at
      `
    )
    .eq('cycle_id', cycleId)
    .order('submitted_at', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data || [];
}


async function mapRecitations(
  cycle: CycleRow,
  rows: any[],
  users?: User[]
): Promise<RecitationLog[]> {
  const allUsers =
    users ||
    (await getAllProfiles()).map(
      mapProfile
    );

  const userMap = new Map(
    allUsers.map((user) => [
      user.id,
      user,
    ])
  );

  return rows.map((row) => {
    const member =
      userMap.get(row.user_id);

    const listener =
      userMap.get(row.listener_id);

    const submittedDate =
      String(
        row.submitted_at || ''
      ).slice(0, 10);

    return {
      id: row.id,
      member_id: row.user_id,
      member_name:
        member?.name || 'عضو',
      listener_id:
        row.listener_id,
      listener_name:
        listener?.name,
      quarter_number:
        row.quarter_number,
      cycle_number:
        cycle.cycle_number,
      date:
        submittedDate,
      notes:
        row.notes || undefined,
      created_at:
        row.submitted_at,
      reciter_id:
        row.user_id,
      reciter_name:
        member?.name || 'عضو',
    };
  });
}


async function buildRevisionDateMap(
  cycle: CycleRow,
  settings: GroupSettings,
  restDays: RestDay[]
) {
  const today =
    formatDate(new Date());

  return getActiveCycleDates(
    cycle.starts_on,
    today,
    restDays,
    settings
  );
}


async function getRevisionRows(
  cycleId: string
) {
  const { data, error } = await supabase
    .from('review_confirmations')
    .select(
      `
      id,
      cycle_id,
      user_id,
      program_day,
      start_quarter,
      end_quarter,
      confirmed_at
      `
    )
    .eq('cycle_id', cycleId)
    .order('program_day', {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return data || [];
}


async function mapRevisions(
  cycle: CycleRow,
  rows: any[],
  users?: User[],
  settingsArg?: GroupSettings,
  restDaysArg?: RestDay[]
): Promise<RevisionLog[]> {
  const allUsers =
    users ||
    (await getAllProfiles()).map(
      mapProfile
    );

  const userMap = new Map(
    allUsers.map((user) => [
      user.id,
      user,
    ])
  );

  let settings = settingsArg;
  let restDays = restDaysArg;

  if (!settings || !restDays) {
    const bootstrap =
      await buildBootstrap();

    settings =
      bootstrap.settings;

    restDays =
      bootstrap.restDays;
  }

  const activeDates =
    await buildRevisionDateMap(
      cycle,
      settings,
      restDays
    );

  return rows.map((row) => {
    const member =
      userMap.get(row.user_id);

    const historicalDate =
      activeDates[
        row.program_day - 1
      ] ||
      String(
        row.confirmed_at
      ).slice(0, 10);

    return {
      id: row.id,
      member_id:
        row.user_id,
      member_name:
        member?.name || 'عضو',
      date:
        historicalDate,
      cycle_number:
        cycle.cycle_number,
      review_start_quarter:
        row.start_quarter,
      review_end_quarter:
        row.end_quarter,
      created_at:
        row.confirmed_at,
    };
  });
}


export const api = {
  async login(
    phone: string,
    password: string
  ): Promise<{
    user: User;
    token: string;
  }> {
    const email =
      phoneToAuthEmail(phone);

    const {
      data,
      error,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password,
        });

    if (
      error ||
      !data.user
    ) {
      throw new Error(
        'رقم الهاتف أو كلمة المرور غير صحيحة'
      );
    }

    const {
      data: profile,
      error: profileError,
    } =
      await supabase
        .from('profiles')
        .select(
          'id, full_name, phone, role, active, created_at, deactivated_at'
        )
        .eq(
          'id',
          data.user.id
        )
        .single();

    if (profileError) {
      throw profileError;
    }

    return {
      user:
        mapProfile(
          profile as ProfileRow
        ),
      token:
        data.session
          ?.access_token || '',
    };
  },


  async logout(): Promise<void> {
    const { error } =
      await supabase.auth
        .signOut();

    if (error) {
      throw error;
    }
  },


  async getMe(): Promise<{ user: User }> {
    const profile =
      await getCurrentProfile();

    return {
      user:
        mapProfile(profile),
    };
  },


  async changePassword(
    payload: {
      currentPassword: string;
      newPassword: string;
      confirmPassword?: string;
    }
  ): Promise<{
    message: string;
  }> {
    if (
      payload.confirmPassword &&
      payload.confirmPassword !==
        payload.newPassword
    ) {
      throw new Error(
        'كلمتا المرور غير متطابقتين'
      );
    }

    if (
      payload.newPassword.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    const profile =
      await getCurrentProfile();

    const email =
      phoneToAuthEmail(
        profile.phone
      );

    const {
      error: verifyError,
    } =
      await supabase.auth
        .signInWithPassword({
          email,
          password:
            payload.currentPassword,
        });

    if (verifyError) {
      throw new Error(
        'كلمة المرور الحالية غير صحيحة'
      );
    }

    const {
      error,
    } =
      await supabase.auth
        .updateUser({
          password:
            payload.newPassword,
        });

    if (error) {
      throw error;
    }

    return {
      message:
        'تم تغيير كلمة المرور بنجاح',
    };
  },


  async getBootstrap(
    _params?: {
      client_date?: string;
    }
  ): Promise<{
    cycleInfo: CycleInfo;
    settings: GroupSettings;
    restDays: RestDay[];
    users: User[];
    todayRecitations:
      RecitationLog[];
    todayRevisions:
      RevisionLog[];
  }> {
    const bootstrap =
      await buildBootstrap();

    const [
      recitationRows,
      revisionRows,
    ] =
      await Promise.all([
        getRecitationRows(
          bootstrap.cycle.id
        ),
        getRevisionRows(
          bootstrap.cycle.id
        ),
      ]);

    const recitations =
      await mapRecitations(
        bootstrap.cycle,
        recitationRows,
        bootstrap.users
      );

    const revisions =
      await mapRevisions(
        bootstrap.cycle,
        revisionRows,
        bootstrap.users,
        bootstrap.settings,
        bootstrap.restDays
      );

    const today =
      formatDate(new Date());

    return {
      cycleInfo:
        bootstrap.cycleInfo,

      settings:
        bootstrap.settings,

      restDays:
        bootstrap.restDays,

      users:
        bootstrap.users,

      todayRecitations:
        recitations.filter(
          (item) =>
            item.date === today
        ),

      todayRevisions:
        revisions.filter(
          (item) =>
            item.date === today
        ),
    };
  },


  async getRecitations(
    params?: {
      member_id?: string;
      reciter_id?: string;
      date?: string;
    }
  ): Promise<{
    recitations:
      RecitationLog[];
  }> {
    const bootstrap =
      await buildBootstrap();

    const rows =
      await getRecitationRows(
        bootstrap.cycle.id
      );

    let recitations =
      await mapRecitations(
        bootstrap.cycle,
        rows,
        bootstrap.users
      );

    const memberId =
      params?.member_id ||
      params?.reciter_id;

    if (memberId) {
      recitations =
        recitations.filter(
          (item) =>
            item.member_id ===
            memberId
        );
    }

    if (params?.date) {
      recitations =
        recitations.filter(
          (item) =>
            item.date ===
            params.date
        );
    }

    return {
      recitations,
    };
  },


  async recordRecitation(
    payload: {
      quarter_number: number;
      listener_id: string;
      notes?: string;
      date?: string;
    }
  ): Promise<{
    recitation:
      RecitationLog;
    message: string;
  }> {
    const user =
      await getCurrentAuthUser();

    const bootstrap =
      await buildBootstrap();

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'tasmia_submissions'
        )
        .insert({
          cycle_id:
            bootstrap.cycle.id,
          user_id:
            user.id,
          listener_id:
            payload.listener_id,
          quarter_number:
            payload.quarter_number,
          notes:
            payload.notes || null,
        })
        .select('*')
        .single();

    if (error) {
      if (
        error.code === '23505'
      ) {
        throw new Error(
          'تم تسجيل هذا الربع من قبل'
        );
      }

      throw error;
    }

    const [mapped] =
      await mapRecitations(
        bootstrap.cycle,
        [data],
        bootstrap.users
      );

    return {
      recitation:
        mapped,
      message:
        'تم تسجيل التسميع بنجاح',
    };
  },


  async getRevisions(
    params?: {
      member_id?: string;
      date?: string;
    }
  ): Promise<{
    revisions:
      RevisionLog[];
  }> {
    const bootstrap =
      await buildBootstrap();

    const rows =
      await getRevisionRows(
        bootstrap.cycle.id
      );

    let revisions =
      await mapRevisions(
        bootstrap.cycle,
        rows,
        bootstrap.users,
        bootstrap.settings,
        bootstrap.restDays
      );

    if (
      params?.member_id
    ) {
      revisions =
        revisions.filter(
          (item) =>
            item.member_id ===
            params.member_id
        );
    }

    if (params?.date) {
      revisions =
        revisions.filter(
          (item) =>
            item.date ===
            params.date
        );
    }

    return {
      revisions,
    };
  },


  async recordRevision(
    payload: {
      notes?: string;
      date?: string;
    }
  ): Promise<{
    revision:
      RevisionLog;
    message: string;
  }> {
    const user =
      await getCurrentAuthUser();

    const bootstrap =
      await buildBootstrap();

    const targetDate =
      payload.date ||
      formatDate(new Date());

    const activeDates =
      getActiveCycleDates(
        bootstrap.settings
          .start_date,

        targetDate,

        bootstrap.restDays,

        bootstrap.settings
      );

    let programDay =
      activeDates.indexOf(
        targetDate
      ) + 1;

    if (programDay < 1) {
      const targetInfo =
        calculateCycleInfo(
          bootstrap.settings,
          bootstrap.restDays,
          targetDate
        );

      programDay =
        targetInfo.cycle_day;
    }

    const endQuarter =
      Math.min(
        240,
        programDay
      );

    const startQuarter =
      Math.max(
        1,
        endQuarter -
          bootstrap.settings
            .review_window +
          1
      );

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'review_confirmations'
        )
        .insert({
          cycle_id:
            bootstrap.cycle.id,
          user_id:
            user.id,
          program_day:
            programDay,
          start_quarter:
            startQuarter,
          end_quarter:
            endQuarter,
        })
        .select('*')
        .single();

    if (error) {
      if (
        error.code === '23505'
      ) {
        throw new Error(
          'تم تأكيد مراجعة هذا اليوم من قبل'
        );
      }

      throw error;
    }

    const [revision] =
      await mapRevisions(
        bootstrap.cycle,
        [data],
        bootstrap.users,
        bootstrap.settings,
        bootstrap.restDays
      );

    return {
      revision,
      message:
        'تم تأكيد المراجعة بنجاح',
    };
  },


  async adminAddMember(
    payload: {
      name: string;
      phone: string;
      password: string;
      role:
        | 'member'
        | 'admin';
    }
  ): Promise<{
    user: User;
    message: string;
  }> {
    /*
     * IMPORTANT:
     * Supabase hosted Auth requires
     * passwords of at least 6 characters.
     *
     * Validate here BEFORE calling the
     * Edge Function so the admin gets a
     * clear Arabic message.
     */
    if (
      payload.password.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    const {
      data,
      error,
    } =
      await supabase.functions
        .invoke(
          'admin-users',
          {
            body: {
              action:
                'create',
              ...payload,
            },
          }
        );

    if (error) {
      throw new Error(
        'تعذر إضافة الحساب. حاول مرة أخرى.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.error
      );
    }

    return data;
  },


  async adminUpdateMember(
    id: string,
    payload: {
      name?: string;
      phone?: string;
      password?: string;
      role?:
        | 'member'
        | 'admin';
      is_active?: boolean;
    }
  ): Promise<{
    user: User;
    message: string;
  }> {
    /*
     * If password is being changed,
     * validate before calling the server.
     */
    if (
      payload.password !== undefined &&
      payload.password !== '' &&
      payload.password.length < 6
    ) {
      throw new Error(
        'كلمة المرور يجب أن تكون 6 أحرف أو أكثر'
      );
    }

    /*
     * Password and phone changes must go
     * through the Edge Function because
     * they also affect Supabase Auth.
     */
    if (
      payload.password ||
      payload.phone !== undefined 
    ) {
      const {
        data,
        error,
      } =
        await supabase.functions
          .invoke(
            'admin-users',
            {
              body: {
                action:
                  'update',
                user_id:
                  id,
                ...payload,
              },
            }
          );

      if (error) {
        throw new Error(
          'تعذر تحديث الحساب. حاول مرة أخرى.'
        );
      }

      if (data?.error) {
        throw new Error(
          data.error
        );
      }

      return data;
    }

    const update: Record<
      string,
      unknown
    > = {};

    if (
      payload.name !==
      undefined
    ) {
      update.full_name =
        payload.name;
    }

    if (
      payload.role !==
      undefined
    ) {
      update.role =
        payload.role;
    }

    if (
      payload.is_active !==
      undefined
    ) {
      update.active =
        payload.is_active;

      update.deactivated_at =
        payload.is_active
          ? null
          : new Date()
              .toISOString();
    }

    const {
      data,
      error,
    } =
      await supabase
        .from('profiles')
        .update(update)
        .eq('id', id)
        .select(
          'id, full_name, phone, role, active, created_at, deactivated_at'
        )
        .single();

    if (error) {
      throw error;
    }

    return {
      user:
        mapProfile(
          data as ProfileRow
        ),
      message:
        'تم تحديث العضو بنجاح',
    };
  },


  async adminDeleteMemberCompletely(
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const {
      data,
      error,
    } =
      await supabase.functions
        .invoke(
          'admin-users',
          {
            body: {
              action:
                'delete',
              user_id:
                id,
            },
          }
        );

    if (error) {
      throw new Error(
        'تعذر حذف الحساب. حاول مرة أخرى.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.error
      );
    }

    return data;
  },


  async adminAddRestDay(
    payload: {
      date: string;
      note: string;
    }
  ): Promise<{
    restDay: RestDay;
    message: string;
  }> {
    const profile =
      await getCurrentProfile();

    const bootstrap =
      await buildBootstrap();

    const {
      data,
      error,
    } =
      await supabase
        .from(
          'group_rest_days'
        )
        .insert({
          cycle_id:
            bootstrap.cycle.id,
          rest_date:
            payload.date,
          reason:
            payload.note || null,
          created_by:
            profile.id,
        })
        .select('*')
        .single();

    if (error) {
      throw error;
    }

    const restDay:
      RestDay = {
      id: data.id,
      date:
        data.rest_date,
      note:
        data.reason || '',
      added_by_admin_id:
        profile.id,
      added_by_name:
        profile.full_name,
      created_at:
        data.created_at,
    };

    return {
      restDay,
      message:
        'تمت إضافة يوم الراحة',
    };
  },


  async adminDeleteRestDay(
    id: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const {
      error,
    } =
      await supabase
        .from(
          'group_rest_days'
        )
        .delete()
        .eq('id', id);

    if (error) {
      throw error;
    }

    return {
      success: true,
      message:
        'تم حذف يوم الراحة',
    };
  },


  async adminPause():
    Promise<{
      settings:
        GroupSettings;
      cycleInfo:
        CycleInfo;
      message: string;
    }> {
    const profile =
      await getCurrentProfile();

    const bootstrap =
      await buildBootstrap();

    const today =
      formatDate(new Date());

    const {
      error,
    } =
      await supabase
        .from(
          'program_pauses'
        )
        .insert({
          cycle_id:
            bootstrap.cycle.id,
          paused_on:
            today,
          created_by:
            profile.id,
        });

    if (error) {
      throw error;
    }

    const refreshed =
      await buildBootstrap();

    return {
      settings:
        refreshed.settings,
      cycleInfo:
        refreshed.cycleInfo,
      message:
        'تم إيقاف البرنامج مؤقتاً',
    };
  },


  async adminResume():
    Promise<{
      settings:
        GroupSettings;
      cycleInfo:
        CycleInfo;
      message: string;
    }> {
    const bootstrap =
      await buildBootstrap();

    const pauses =
      await getPauseRows(
        bootstrap.cycle.id
      );

    const activePause =
      pauses.find(
        (pause) =>
          !pause.resumed_on
      );

    if (
      !activePause
    ) {
      throw new Error(
        'البرنامج غير متوقف حالياً'
      );
    }

    const {
      error,
    } =
      await supabase
        .from(
          'program_pauses'
        )
        .update({
          resumed_on:
            formatDate(
              new Date()
            ),
        })
        .eq(
          'id',
          activePause.id
        );

    if (error) {
      throw error;
    }

    const refreshed =
      await buildBootstrap();

    return {
      settings:
        refreshed.settings,
      cycleInfo:
        refreshed.cycleInfo,
      message:
        'تم استئناف البرنامج',
    };
  },


  async adminUpdateSettings(
    payload: {
      start_date?: string;
    }
  ): Promise<{
    settings:
      GroupSettings;
    message: string;
  }> {
    const bootstrap =
      await buildBootstrap();

    if (
      payload.start_date
    ) {
      const {
        error,
      } =
        await supabase
          .from('cycles')
          .update({
            starts_on:
              payload.start_date,
          })
          .eq(
            'id',
            bootstrap.cycle.id
          );

      if (error) {
        throw error;
      }
    }

    const refreshed =
      await buildBootstrap();

    return {
      settings:
        refreshed.settings,
      message:
        'تم حفظ الإعدادات',
    };
  },


  async adminUpdateDailyThought(
    payload: {
      daily_thought:
        string;
    }
  ): Promise<{
    settings:
      GroupSettings;
    message: string;
  }> {
    const profile =
      await getCurrentProfile();

    const {
      error,
    } =
      await supabase
        .from(
          'daily_thoughts'
        )
        .insert({
          content_html:
            payload.daily_thought,
          published_by:
            profile.id,
          is_published:
            true,
        });

    if (error) {
      throw error;
    }

    const refreshed =
      await buildBootstrap();

    return {
      settings:
        refreshed.settings,
      message:
        'تم حفظ ونشر الخاطرة',
    };
  },


  async adminDeleteDailyThought():
    Promise<{
      settings:
        GroupSettings;
      message: string;
    }> {
    const latest =
      await getLatestThought();

    if (latest) {
      const {
        error,
      } =
        await supabase
          .from(
            'daily_thoughts'
          )
          .update({
            is_published:
              false,
          })
          .eq(
            'id',
            latest.id
          );

      if (error) {
        throw error;
      }
    }

    const refreshed =
      await buildBootstrap();

    return {
      settings:
        refreshed.settings,
      message:
        'تم حذف الخاطرة الحالية',
    };
  },


  async adminFactoryReset():
    Promise<{
      success: boolean;
      message: string;
      cycleInfo:
        CycleInfo;
      settings:
        GroupSettings;
    }> {
    const {
      data,
      error,
    } =
      await supabase.functions
        .invoke(
          'admin-actions',
          {
            body: {
              action:
                'factory-reset',
            },
          }
        );

    if (error) {
      throw new Error(
        'تعذر بدء دورة جديدة. حاول مرة أخرى.'
      );
    }

    if (data?.error) {
      throw new Error(
        data.error
      );
    }

    const refreshed =
      await buildBootstrap();

    return {
      success: true,
      message:
        data?.message ||
        'تم بدء دورة جديدة',
      cycleInfo:
        refreshed.cycleInfo,
      settings:
        refreshed.settings,
    };
  },


  async adminGetStats():
    Promise<{
      total_members: number;

      completed_recitation_count:
        number;

      completed_revision_count:
        number;

      pending_recitation_today:
        any[];

      pending_revision_today:
        any[];

      member_stats:
        any[];
    }> {
    const bootstrap =
      await buildBootstrap();

    const [
      recitationsResult,
      revisionsResult,
    ] =
      await Promise.all([
        api.getRecitations(),
        api.getRevisions(),
      ]);

    const members =
      bootstrap.users.filter(
        (user) =>
          user.role ===
            'member' &&
          user.is_active
      );

    const today =
      formatDate(new Date());

    const todayRecitations =
      recitationsResult
        .recitations
        .filter(
          (item) =>
            item.date === today
        );

    const todayRevisions =
      revisionsResult
        .revisions
        .filter(
          (item) =>
            item.date === today
        );

    const recitedIds =
      new Set(
        todayRecitations.map(
          (item) =>
            item.member_id
        )
      );

    const reviewedIds =
      new Set(
        todayRevisions.map(
          (item) =>
            item.member_id
        )
      );

    return {
      total_members:
        members.length,

      completed_recitation_count:
        recitedIds.size,

      completed_revision_count:
        reviewedIds.size,

      pending_recitation_today:
        members.filter(
          (member) =>
            !recitedIds.has(
              member.id
            )
        ),

      pending_revision_today:
        members.filter(
          (member) =>
            !reviewedIds.has(
              member.id
            )
        ),

      member_stats: [],
    };
  },


  async getFirestoreStatus():
    Promise<{
      projectId: string;
      databaseId: string;
      connected: boolean;
      error: string | null;
    }> {
    return {
      projectId:
        'supabase',
      databaseId:
        'postgres',
      connected:
        true,
      error:
        null,
    };
  },
};