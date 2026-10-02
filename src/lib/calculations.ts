import {
  CycleInfo,
  GroupSettings,
  RestDay,
  RevisionLog,
  RecitationLog,
  User,
} from '../types';

/**
 * Format a Date object to YYYY-MM-DD.
 * In the browser, uses the user's local calendar date.
 * Outside the browser, defaults to Makkah/Riyadh time.
 */
export function formatDate(
  date: Date = new Date(),
  timeZone?: string
): string {
  try {
    if (
      typeof window !== 'undefined' &&
      !timeZone
    ) {
      const year = date.getFullYear();

      const month = String(
        date.getMonth() + 1
      ).padStart(2, '0');

      const day = String(
        date.getDate()
      ).padStart(2, '0');

      return `${year}-${month}-${day}`;
    }

    const targetTz =
      timeZone || 'Asia/Riyadh';

    const formatter =
      new Intl.DateTimeFormat(
        'en-CA',
        {
          timeZone: targetTz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }
      );

    return formatter.format(date);
  } catch {
    const year =
      date.getFullYear();

    const month = String(
      date.getMonth() + 1
    ).padStart(2, '0');

    const day = String(
      date.getDate()
    ).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }
}


/**
 * Parse YYYY-MM-DD as UTC midnight.
 */
function parseDateStringToMidnightMs(
  dateStr: string
): number {
  const parts =
    dateStr.split('-');

  if (parts.length !== 3) {
    return Date.now();
  }

  const year =
    parseInt(parts[0], 10);

  const month =
    parseInt(parts[1], 10) - 1;

  const day =
    parseInt(parts[2], 10);

  return Date.UTC(
    year,
    month,
    day
  );
}


/**
 * Example:
 * 2026-09-18
 * →
 * الجمعة 18 سبتمبر 2026
 */
export function formatArabicDateWithDayName(
  dateStr: string
): string {
  if (
    !dateStr ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      dateStr
    )
  ) {
    return dateStr || '';
  }

  const parts =
    dateStr.split('-');

  const y =
    parseInt(parts[0], 10);

  const m =
    parseInt(parts[1], 10) - 1;

  const d =
    parseInt(parts[2], 10);

  const date =
    new Date(y, m, d);

  const days = [
    'الأحد',
    'الاثنين',
    'الثلاثاء',
    'الأربعاء',
    'الخميس',
    'الجمعة',
    'السبت',
  ];

  const months = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ];

  return `${
    days[date.getDay()]
  } ${d} ${
    months[date.getMonth()]
  } ${y}`;
}


/**
 * Message before program start.
 */
export function getPreLaunchMessage(
  daysUntilStart: number,
  startDateStr: string
): string {
  const formattedDate =
    formatArabicDateWithDayName(
      startDateStr
    );

  if (daysUntilStart <= 1) {
    return `البرنامج سيبدأ غدًا ${formattedDate} — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }

  if (daysUntilStart === 2) {
    return `البرنامج سيبدأ بعد يومين (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }

  if (
    daysUntilStart >= 3 &&
    daysUntilStart <= 10
  ) {
    return `البرنامج سيبدأ بعد ${daysUntilStart} أيام (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }

  return `البرنامج سيبدأ بعد ${daysUntilStart} يومًا (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
}


/**
 * Inclusive calendar days.
 *
 * Same date = 1
 * Target before start = 0
 */
export function getCalendarDaysElapsed(
  startDateStr: string,
  targetDateStr: string
): number {
  const startMs =
    parseDateStringToMidnightMs(
      startDateStr
    );

  const targetMs =
    parseDateStringToMidnightMs(
      targetDateStr
    );

  if (targetMs < startMs) {
    return 0;
  }

  const msPerDay =
    1000 * 60 * 60 * 24;

  const diffDays =
    Math.floor(
      (targetMs - startMs) /
        msPerDay
    );

  return diffDays + 1;
}


/**
 * Core 240-day program calculation.
 *
 * One active day = one new quarter.
 *
 * Rest days do not count.
 * Paused days do not count.
 *
 * Revision window = latest 8 quarters.
 */
export function calculateCycleInfo(
  settings: GroupSettings,
  restDays: RestDay[],
  targetDateStr: string =
    formatDate()
): CycleInfo {
  const totalQuarters =
    settings.total_quarters || 240;

  const reviewWindow =
    settings.review_window || 8;

  const startDate =
    settings.start_date ||
    targetDateStr;

  const startMs =
    parseDateStringToMidnightMs(
      startDate
    );

  const targetMs =
    parseDateStringToMidnightMs(
      targetDateStr
    );

  const hasStarted =
    targetMs >= startMs;

  const msPerDay =
    1000 * 60 * 60 * 24;

  const daysUntilStart =
    hasStarted
      ? 0
      : Math.ceil(
          (startMs - targetMs) /
            msPerDay
        );

  if (!hasStarted) {
    return {
      has_started: false,
      days_until_start:
        daysUntilStart,

      cycle_day: 0,
      quarter_of_day: 0,

      review_start: 0,
      review_end: 0,
      review_count: 0,

      is_rest_day: false,
      rest_day_note:
        undefined,

      is_paused:
        !!settings.is_paused,

      paused_at:
        settings.paused_at,

      is_completed: false,

      days_elapsed: 0,
      rest_days_count: 0,
      paused_days_count: 0,

      start_date:
        startDate,

      current_cycle_number:
        settings.current_cycle_number ||
        1,

      today_date:
        targetDateStr,
    };
  }

  const daysElapsed =
    getCalendarDaysElapsed(
      startDate,
      targetDateStr
    );

  const todayRestDay =
    restDays.find(
      (rd) =>
        rd.date ===
        targetDateStr
    );

  const isRestDay =
    !!todayRestDay;

  const restDaysInPeriod =
    restDays.filter(
      (rd) =>
        rd.date >= startDate &&
        rd.date <= targetDateStr
    );

  const restDaysCount =
    restDaysInPeriod.length;

  let currentPauseDays = 0;

  if (
    settings.is_paused &&
    settings.paused_at &&
    targetDateStr >=
      settings.paused_at
  ) {
    currentPauseDays =
      getCalendarDaysElapsed(
        settings.paused_at,
        targetDateStr
      );
  }

  const totalPausedDays =
    (settings.total_paused_days ||
      0) +
    currentPauseDays;

  let calculatedCycleDay =
    daysElapsed -
    restDaysCount -
    totalPausedDays;

  /*
   * Once the program has begun,
   * the visible program day should
   * never fall below Day 1.
   */
  if (
    calculatedCycleDay < 1
  ) {
    calculatedCycleDay = 1;
  }

  const isCompleted =
    calculatedCycleDay >=
    totalQuarters;

  const effectiveCycleDay =
    isCompleted
      ? totalQuarters
      : calculatedCycleDay;

  const quarterOfDay =
    effectiveCycleDay;

  const reviewStart =
    Math.max(
      1,
      effectiveCycleDay -
        reviewWindow +
        1
    );

  const reviewEnd =
    effectiveCycleDay;

  const reviewCount =
    reviewEnd -
    reviewStart +
    1;

  return {
    has_started: true,
    days_until_start: 0,

    cycle_day:
      effectiveCycleDay,

    quarter_of_day:
      quarterOfDay,

    review_start:
      reviewStart,

    review_end:
      reviewEnd,

    review_count:
      reviewCount,

    is_rest_day:
      isRestDay,

    rest_day_note:
      todayRestDay?.note,

    is_paused:
      !!settings.is_paused,

    paused_at:
      settings.paused_at,

    is_completed:
      isCompleted,

    days_elapsed:
      daysElapsed,

    rest_days_count:
      restDaysCount,

    paused_days_count:
      totalPausedDays,

    start_date:
      startDate,

    current_cycle_number:
      settings.current_cycle_number ||
      1,

    today_date:
      targetDateStr,
  };
}


/**
 * TASMI'A / RECITATION LOGIC
 *
 * The member must always complete the
 * OLDEST missing quarter first.
 *
 * Example:
 *
 * Group is on quarter 14.
 * Member completed only 1..8.
 *
 * Required quarter = 9.
 *
 * After submitting 9:
 * required = 10.
 *
 * Catch-up can continue several times
 * on the same calendar day.
 *
 * The CURRENT group quarter does not
 * count as a past missed quarter yet.
 */
export function calculateMemberRequiredQuarter(
  memberId: string,
  groupQuarterOfDay: number,
  recitationLogs: {
    member_id?: string;
    reciter_id?: string;
    quarter_number: number;
  }[]
): {
  requiredQuarter: number;

  isBehind: boolean;

  missedQuarters: number[];

  pastMissedQuarters: number[];

  pastMissedQuartersCount:
    number;

  allCompletedUpToToday:
    boolean;

  hasCompletedToday:
    boolean;
} {
  if (
    groupQuarterOfDay <= 0
  ) {
    return {
      requiredQuarter: 1,
      isBehind: false,

      missedQuarters: [],

      pastMissedQuarters: [],

      pastMissedQuartersCount:
        0,

      allCompletedUpToToday:
        true,

      hasCompletedToday:
        false,
    };
  }

  const completedQuarters =
    new Set<number>();

  for (
    const log of
    recitationLogs
  ) {
    const logMemberId =
      log.member_id ||
      log.reciter_id;

    if (
      logMemberId === memberId
    ) {
      completedQuarters.add(
        log.quarter_number
      );
    }
  }

  const missedQuarters:
    number[] = [];

  const pastMissedQuarters:
    number[] = [];

  let firstMissingQuarter:
    number | null = null;

  for (
    let q = 1;
    q <= groupQuarterOfDay;
    q++
  ) {
    if (
      completedQuarters.has(q)
    ) {
      continue;
    }

    missedQuarters.push(q);

    if (
      firstMissingQuarter ===
      null
    ) {
      firstMissingQuarter = q;
    }

    /*
     * IMPORTANT:
     *
     * q === today's group quarter
     * is NOT a past delay.
     *
     * Only earlier obligations count
     * toward severe delay / removal.
     */
    if (
      q < groupQuarterOfDay
    ) {
      pastMissedQuarters.push(
        q
      );
    }
  }

  const hasCompletedToday =
    completedQuarters.has(
      groupQuarterOfDay
    );

  if (
    firstMissingQuarter !== null
  ) {
    return {
      requiredQuarter:
        firstMissingQuarter,

      isBehind:
        firstMissingQuarter <
        groupQuarterOfDay,

      missedQuarters,

      pastMissedQuarters,

      pastMissedQuartersCount:
        pastMissedQuarters.length,

      allCompletedUpToToday:
        false,

      hasCompletedToday,
    };
  }

  return {
    requiredQuarter:
      groupQuarterOfDay,

    isBehind: false,

    missedQuarters: [],

    pastMissedQuarters: [],

    pastMissedQuartersCount:
      0,

    allCompletedUpToToday:
      true,

    hasCompletedToday:
      true,
  };
}


/**
 * Returns all obligation dates from the
 * cycle beginning until target date.
 *
 * Global rest days are excluded.
 *
 * While the program is currently paused,
 * dates beginning at paused_at are also
 * excluded.
 */
export function getActiveCycleDates(
  startDateStr: string,
  targetDateStr: string,
  restDays: RestDay[] = [],
  settings?: GroupSettings
): string[] {
  const startMs =
    parseDateStringToMidnightMs(
      startDateStr
    );

  const targetMs =
    parseDateStringToMidnightMs(
      targetDateStr
    );

  if (targetMs < startMs) {
    return [];
  }

  const msPerDay =
    1000 * 60 * 60 * 24;

  const totalDays =
    Math.floor(
      (targetMs - startMs) /
        msPerDay
    ) + 1;

  const restDaySet =
    new Set(
      restDays.map(
        (r) => r.date
      )
    );

  const activeDates:
    string[] = [];

  for (
    let i = 0;
    i < totalDays;
    i++
  ) {
    const curDate =
      new Date(
        startMs +
          i * msPerDay
      );

    const dStr =
      formatDate(curDate);

    if (
      restDaySet.has(dStr)
    ) {
      continue;
    }

    if (
      settings?.is_paused &&
      settings.paused_at &&
      dStr >=
        settings.paused_at
    ) {
      continue;
    }

    activeDates.push(dStr);
  }

  return activeDates;
}


export interface MemberRevisionStatus {
  /*
   * Past obligation days only.
   * Today is not counted as missed.
   */
  missedRevisionDaysCount:
    number;

  pastMissedRevisionDaysCount:
    number;

  pastMissedDates:
    string[];

  /*
   * This can include today if the member
   * has not reviewed yet today.
   */
  missedDates:
    string[];

  hasReviewedToday:
    boolean;

  totalCompletedRevisions:
    number;

  /*
   * At least one PAST missed day.
   */
  isBehindRevision:
    boolean;

  /*
   * YOUR RULE:
   *
   * Severe delay / eligible for removal
   * begins when THREE PAST obligation
   * days are missing.
   *
   * Example:
   *
   * Day 1 missed
   * Day 2 missed
   * Day 3 missed
   *
   * On Day 4:
   * pastMissedCount = 3
   * => severe = true
   *
   * Day 4 itself is NOT counted yet.
   */
  isSeverelyBehindRevision:
    boolean;
}


/**
 * REVIEW LOGIC
 *
 * Every active program day has one
 * review obligation covering up to
 * eight quarters.
 *
 * Only PAST days count toward delay.
 * Today's unfinished review does not
 * count as a missed past day yet.
 */
export function calculateMemberRevisionStatus(
  memberId: string,
  activeCycleDates: string[],
  revisionLogs: RevisionLog[],
  todayDateStr: string =
    formatDate()
): MemberRevisionStatus {
  const memberLogs =
    revisionLogs.filter(
      (r) =>
        r.member_id ===
        memberId
    );

  const reviewedDates =
    new Set(
      memberLogs.map(
        (r) => r.date
      )
    );

  const missedDates:
    string[] = [];

  const pastMissedDates:
    string[] = [];

  for (
    const date of
    activeCycleDates
  ) {
    if (
      reviewedDates.has(date)
    ) {
      continue;
    }

    missedDates.push(date);

    /*
     * Strictly before today.
     *
     * Today's obligation never counts
     * toward removal eligibility.
     */
    if (
      date < todayDateStr
    ) {
      pastMissedDates.push(
        date
      );
    }
  }

  const pastMissedCount =
    pastMissedDates.length;

  const hasReviewedToday =
    reviewedDates.has(
      todayDateStr
    );

  return {
    missedRevisionDaysCount:
      pastMissedCount,

    pastMissedRevisionDaysCount:
      pastMissedCount,

    pastMissedDates,

    missedDates,

    hasReviewedToday,

    totalCompletedRevisions:
      memberLogs.length,

    isBehindRevision:
      pastMissedCount >= 1,

    /*
     * THREE previous missed days
     * means severe delay.
     */
    isSeverelyBehindRevision:
      pastMissedCount >= 3,
  };
}


export interface WeekRange {
  startDate: string;

  endDate: string;

  todayDate: string;

  daysPassedInWeek: number;

  activeRecitationDaysThisWeek:
    string[];
}


/**
 * Current statistics week:
 * Saturday → Friday.
 */
export function getCurrentWeekRange(
  todayDateStr: string =
    formatDate(),
  settingsStartDate?: string,
  restDays: RestDay[] = []
): WeekRange {
  const parts =
    todayDateStr
      .split('-')
      .map(Number);

  const localDate =
    new Date(
      parts[0],
      parts[1] - 1,
      parts[2],
      12,
      0,
      0
    );

  const dayOfWeek =
    localDate.getDay();

  const daysSinceSaturday =
    (dayOfWeek + 1) % 7;

  const satDate =
    new Date(localDate);

  satDate.setDate(
    localDate.getDate() -
      daysSinceSaturday
  );

  const friDate =
    new Date(satDate);

  friDate.setDate(
    satDate.getDate() + 6
  );

  const startDate =
    formatDate(satDate);

  const endDate =
    formatDate(friDate);

  const daysPassed =
    daysSinceSaturday + 1;

  const activeRecitationDaysThisWeek:
    string[] = [];

  const restDaySet =
    new Set(
      restDays.map(
        (r) => r.date
      )
    );

  const effectiveStart =
    settingsStartDate ||
    startDate;

  const iter =
    new Date(satDate);

  for (
    let i = 0;
    i < daysPassed;
    i++
  ) {
    const dStr =
      formatDate(iter);

    if (
      dStr <= todayDateStr &&
      dStr >= effectiveStart &&
      !restDaySet.has(dStr)
    ) {
      activeRecitationDaysThisWeek.push(
        dStr
      );
    }

    iter.setDate(
      iter.getDate() + 1
    );
  }

  return {
    startDate,
    endDate,
    todayDate:
      todayDateStr,

    daysPassedInWeek:
      daysPassed,

    activeRecitationDaysThisWeek,
  };
}


/**
 * Umm al-Qura Hijri date.
 */
export function getHijriDate(
  dateStr?: string
): string {
  try {
    let date: Date;

    if (
      dateStr &&
      /^\d{4}-\d{2}-\d{2}$/.test(
        dateStr
      )
    ) {
      const parts =
        dateStr.split('-');

      date = new Date(
        Number(parts[0]),
        Number(parts[1]) - 1,
        Number(parts[2]),
        12,
        0,
        0
      );
    } else {
      date = new Date();
    }

    const formatter =
      new Intl.DateTimeFormat(
        'ar-SA-u-ca-islamic-umalqura',
        {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }
      );

    let formatted =
      formatter.format(date);

    formatted =
      formatted.replace(
        /\s+هـ$/,
        'هـ'
      );

    if (
      !formatted.includes('هـ')
    ) {
      formatted =
        `${formatted}هـ`;
    }

    return formatted;
  } catch (error) {
    console.error(
      'Failed to format Hijri date:',
      error
    );

    return '';
  }
}


export interface ListenerStatsItem {
  user: User;

  timesListened: number;
}


/**
 * Listening leaderboard.
 *
 * One submitted recitation =
 * one listening credit for the listener.
 *
 * Therefore:
 *
 * 3 quarters submitted in one call
 * = 3 forms
 * = 3 listening credits.
 */
export function calculateListenersLeaderboard(
  activeMembers: User[],
  recitations:
    RecitationLog[],
  startDate?: string,
  endDate?: string
): ListenerStatsItem[] {
  const filteredRecitations =
    recitations.filter(
      (r) => {
        if (
          !r.listener_id
        ) {
          return false;
        }

        const reciterId =
          r.member_id ||
          r.reciter_id;

        /*
         * Do not award listening credit
         * for listening to oneself.
         */
        if (
          reciterId ===
          r.listener_id
        ) {
          return false;
        }

        if (
          startDate &&
          r.date < startDate
        ) {
          return false;
        }

        if (
          endDate &&
          r.date > endDate
        ) {
          return false;
        }

        return true;
      }
    );

  const countsMap =
    new Map<
      string,
      number
    >();

  for (
    const r of
    filteredRecitations
  ) {
    if (
      !r.listener_id
    ) {
      continue;
    }

    countsMap.set(
      r.listener_id,

      (
        countsMap.get(
          r.listener_id
        ) || 0
      ) + 1
    );
  }

  const list:
    ListenerStatsItem[] =
    activeMembers.map(
      (member) => ({
        user: member,

        timesListened:
          countsMap.get(
            member.id
          ) || 0,
      })
    );

  list.sort(
    (a, b) => {
      if (
        b.timesListened !==
        a.timesListened
      ) {
        return (
          b.timesListened -
          a.timesListened
        );
      }

      return a.user.name
        .localeCompare(
          b.user.name,
          'ar'
        );
    }
  );

  return list;
}


/**
 * Total listening credits for one member.
 */
export function calculateUserListeningCount(
  userId: string,
  recitations:
    RecitationLog[],
  startDate?: string,
  endDate?: string
): number {
  return recitations.filter(
    (r) => {
      if (
        r.listener_id !==
        userId
      ) {
        return false;
      }

      const reciterId =
        r.member_id ||
        r.reciter_id;

      if (
        reciterId === userId
      ) {
        return false;
      }

      if (
        startDate &&
        r.date < startDate
      ) {
        return false;
      }

      if (
        endDate &&
        r.date > endDate
      ) {
        return false;
      }

      return true;
    }
  ).length;
}