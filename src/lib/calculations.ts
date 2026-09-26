import { CycleInfo, GroupSettings, RestDay, RevisionLog, RecitationLog, User } from '../types';

/**
 * Format a Date object to YYYY-MM-DD string with timezone support.
 * On server, defaults to Makkah time (Asia/Riyadh, UTC+3) where the halaqah operates.
 * In browser, formats according to the user device's local calendar day.
 */
export function formatDate(date: Date = new Date(), timeZone?: string): string {
  try {
    if (typeof window !== 'undefined' && !timeZone) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    const targetTz = timeZone || 'Asia/Riyadh';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: targetTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * Parse YYYY-MM-DD string to pure UTC timestamp at midnight to avoid timezone shifting
 */
function parseDateStringToMidnightMs(dateStr: string): number {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return Date.now();
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  return Date.UTC(year, month, day);
}

/**
 * Format date string (YYYY-MM-DD) into full Arabic text with day name
 * Example: "2026-09-18" -> "الجمعة 18 سبتمبر 2026"
 */
export function formatArabicDateWithDayName(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '';
  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const date = new Date(y, m, d);
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  return `${dayName} ${d} ${monthName} ${y}`;
}

/**
 * Generate dynamic countdown message for pre-launch
 */
export function getPreLaunchMessage(daysUntilStart: number, startDateStr: string): string {
  const formattedDate = formatArabicDateWithDayName(startDateStr);
  if (daysUntilStart <= 1) {
    return `البرنامج سيبدأ غدًا ${formattedDate} — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }
  if (daysUntilStart === 2) {
    return `البرنامج سيبدأ بعد يومين (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }
  if (daysUntilStart >= 3 && daysUntilStart <= 10) {
    return `البرنامج سيبدأ بعد ${daysUntilStart} أيام (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
  }
  return `البرنامج سيبدأ بعد ${daysUntilStart} يومًا (${formattedDate}) — استعد لتبدأ رحلتك مع القرآن الكريم!`;
}

/**
 * Calculate the number of calendar days between two dates inclusive of start day.
 * If targetDate === startDate, returns 1.
 * If targetDate < startDate, returns 0.
 */
export function getCalendarDaysElapsed(startDateStr: string, targetDateStr: string): number {
  const startMs = parseDateStringToMidnightMs(startDateStr);
  const targetMs = parseDateStringToMidnightMs(targetDateStr);
  
  if (targetMs < startMs) {
    return 0;
  }
  
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.floor((targetMs - startMs) / msPerDay);
  return diffDays + 1;
}

/**
 * Core mathematical calculation engine for Motqin group plan:
 * - TOTAL_QUARTERS = 240
 * - REVIEW_WINDOW = 8
 * - Cycle Day = calendar days elapsed - rest days in the period - paused days
 * - quarter_of_day(n) = n (clamped at 240 with completion state)
 * - review_start(n) = max(1, n - REVIEW_WINDOW + 1)
 * - review_end(n) = n
 */
export function calculateCycleInfo(
  settings: GroupSettings,
  restDays: RestDay[],
  targetDateStr: string = formatDate()
): CycleInfo {
  const totalQuarters = settings.total_quarters || 240;
  const reviewWindow = settings.review_window || 8;
  const startDate = settings.start_date || targetDateStr;

  const startMs = parseDateStringToMidnightMs(startDate);
  const targetMs = parseDateStringToMidnightMs(targetDateStr);
  const hasStarted = targetMs >= startMs;
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilStart = hasStarted ? 0 : Math.ceil((startMs - targetMs) / msPerDay);

  // If the program hasn't started yet
  if (!hasStarted) {
    return {
      has_started: false,
      days_until_start: daysUntilStart,
      cycle_day: 0,
      quarter_of_day: 0,
      review_start: 0,
      review_end: 0,
      review_count: 0,
      is_rest_day: false,
      rest_day_note: undefined,
      is_paused: !!settings.is_paused,
      paused_at: settings.paused_at,
      is_completed: false,
      days_elapsed: 0,
      rest_days_count: 0,
      paused_days_count: 0,
      start_date: startDate,
      current_cycle_number: settings.current_cycle_number || 1,
      today_date: targetDateStr,
    };
  }

  const daysElapsed = getCalendarDaysElapsed(startDate, targetDateStr);

  // Check if target date itself is a rest day
  const todayRestDay = restDays.find((rd) => rd.date === targetDateStr);
  const isRestDay = !!todayRestDay;

  // Count rest days that occurred between start_date and targetDate (inclusive)
  const restDaysInPeriod = restDays.filter((rd) => {
    return rd.date >= startDate && rd.date <= targetDateStr;
  });
  const restDaysCount = restDaysInPeriod.length;

  // Calculate paused days
  let currentPauseDays = 0;
  if (settings.is_paused && settings.paused_at) {
    if (targetDateStr >= settings.paused_at) {
      // Days between paused_at and targetDateStr (inclusive of the paused duration)
      currentPauseDays = getCalendarDaysElapsed(settings.paused_at, targetDateStr);
    }
  }
  const totalPausedDays = (settings.total_paused_days || 0) + currentPauseDays;

  // Calculate raw cycle day: subtract rest days and paused days
  let calculatedCycleDay = daysElapsed - restDaysCount - totalPausedDays;
  if (calculatedCycleDay < 1) {
    calculatedCycleDay = 1;
  }

  // Check completion
  const isCompleted = calculatedCycleDay >= totalQuarters;
  const effectiveCycleDay = isCompleted ? totalQuarters : calculatedCycleDay;

  const quarterOfDay = effectiveCycleDay;
  const reviewStart = Math.max(1, effectiveCycleDay - reviewWindow + 1);
  const reviewEnd = effectiveCycleDay;
  const reviewCount = reviewEnd - reviewStart + 1;

  return {
    has_started: true,
    days_until_start: 0,
    cycle_day: effectiveCycleDay,
    quarter_of_day: quarterOfDay,
    review_start: reviewStart,
    review_end: reviewEnd,
    review_count: reviewCount,
    is_rest_day: isRestDay,
    rest_day_note: todayRestDay?.note,
    is_paused: !!settings.is_paused,
    paused_at: settings.paused_at,
    is_completed: isCompleted,
    days_elapsed: daysElapsed,
    rest_days_count: restDaysCount,
    paused_days_count: totalPausedDays,
    start_date: startDate,
    current_cycle_number: settings.current_cycle_number || 1,
    today_date: targetDateStr,
  };
}

/**
 * Calculate the currently required quarter for a member:
 * = Smallest quarter number (from 1 up to the group's quarter_of_day)
 *   that does NOT have a recitation log for this member.
 * If all quarters from 1 to quarter_of_day are completed:
 * - Returns quarter_of_day (up to date).
 */
export function calculateMemberRequiredQuarter(
  memberId: string,
  groupQuarterOfDay: number,
  recitationLogs: { member_id?: string; reciter_id?: string; quarter_number: number }[]
): {
  requiredQuarter: number;
  isBehind: boolean;
  missedQuarters: number[];
  pastMissedQuarters: number[];
  pastMissedQuartersCount: number;
  allCompletedUpToToday: boolean;
  hasCompletedToday: boolean;
} {
  // If the program hasn't started yet (quarter_of_day is 0)
  if (groupQuarterOfDay <= 0) {
    return {
      requiredQuarter: 1,
      isBehind: false,
      missedQuarters: [],
      pastMissedQuarters: [],
      pastMissedQuartersCount: 0,
      allCompletedUpToToday: true,
      hasCompletedToday: false,
    };
  }

  // Set of completed quarter numbers for this member
  const completedQuarters = new Set<number>();
  for (const log of recitationLogs) {
    const logMemberId = log.member_id || log.reciter_id;
    if (logMemberId === memberId) {
      completedQuarters.add(log.quarter_number);
    }
  }

  const missedQuarters: number[] = [];
  const pastMissedQuarters: number[] = [];
  let firstMissingQuarter: number | null = null;

  for (let q = 1; q <= groupQuarterOfDay; q++) {
    if (!completedQuarters.has(q)) {
      missedQuarters.push(q);
      if (firstMissingQuarter === null) {
        firstMissingQuarter = q;
      }
      if (q < groupQuarterOfDay) {
        pastMissedQuarters.push(q);
      }
    }
  }

  const hasCompletedToday = completedQuarters.has(groupQuarterOfDay);

  // If there is any missing quarter from 1..groupQuarterOfDay
  if (firstMissingQuarter !== null) {
    const isBehind = firstMissingQuarter < groupQuarterOfDay;
    return {
      requiredQuarter: firstMissingQuarter,
      isBehind,
      missedQuarters,
      pastMissedQuarters,
      pastMissedQuartersCount: pastMissedQuarters.length,
      allCompletedUpToToday: false,
      hasCompletedToday,
    };
  }

  // If member has already completed all quarters up to groupQuarterOfDay
  return {
    requiredQuarter: groupQuarterOfDay,
    isBehind: false,
    missedQuarters: [],
    pastMissedQuarters: [],
    pastMissedQuartersCount: 0,
    allCompletedUpToToday: true,
    hasCompletedToday: true,
  };
}

/**
 * Returns all active cycle calendar dates from start_date up to targetDateStr (inclusive),
 * excluding rest days and any paused periods.
 */
export function getActiveCycleDates(
  startDateStr: string,
  targetDateStr: string,
  restDays: RestDay[] = [],
  settings?: GroupSettings
): string[] {
  const startMs = parseDateStringToMidnightMs(startDateStr);
  const targetMs = parseDateStringToMidnightMs(targetDateStr);
  if (targetMs < startMs) {
    return [];
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.floor((targetMs - startMs) / msPerDay) + 1;
  const restDaySet = new Set(restDays.map((r) => r.date));
  const activeDates: string[] = [];

  for (let i = 0; i < totalDays; i++) {
    const curDate = new Date(startMs + i * msPerDay);
    const dStr = formatDate(curDate);

    // Skip rest days
    if (restDaySet.has(dStr)) continue;

    // Skip paused dates if currently paused
    if (settings?.is_paused && settings.paused_at && dStr >= settings.paused_at) {
      continue;
    }

    activeDates.push(dStr);
  }

  return activeDates;
}

export interface MemberRevisionStatus {
  missedRevisionDaysCount: number; // Only past days that actually elapsed before today
  pastMissedRevisionDaysCount: number;
  pastMissedDates: string[];
  missedDates: string[];
  hasReviewedToday: boolean;
  totalCompletedRevisions: number;
  isBehindRevision: boolean; // 1 or more past missed days
  isSeverelyBehindRevision: boolean; // more than 3 past missed days (4+)
}

/**
 * Calculates the revision status for a member:
 * - Counts active cycle dates BEFORE today that have no RevisionLog for this member (actual past delays)
 * - Flags if 1 or more past days are missed (member warning)
 * - Flags if more than 3 past days are missed (severe delay / eligible for admin exclusion)
 */
export function calculateMemberRevisionStatus(
  memberId: string,
  activeCycleDates: string[],
  revisionLogs: RevisionLog[],
  todayDateStr: string = formatDate()
): MemberRevisionStatus {
  const memberLogs = revisionLogs.filter((r) => r.member_id === memberId);
  const reviewedDates = new Set(memberLogs.map((r) => r.date));

  const missedDates: string[] = [];
  const pastMissedDates: string[] = [];

  for (const date of activeCycleDates) {
    if (!reviewedDates.has(date)) {
      missedDates.push(date);
      if (date < todayDateStr) {
        pastMissedDates.push(date);
      }
    }
  }

  const pastMissedCount = pastMissedDates.length;
  const hasReviewedToday = reviewedDates.has(todayDateStr);

  return {
    missedRevisionDaysCount: pastMissedCount,
    pastMissedRevisionDaysCount: pastMissedCount,
    pastMissedDates,
    missedDates,
    hasReviewedToday,
    totalCompletedRevisions: memberLogs.length,
    isBehindRevision: pastMissedCount >= 1,
    isSeverelyBehindRevision: pastMissedCount > 3,
  };
}

export interface WeekRange {
  startDate: string; // Saturday YYYY-MM-DD
  endDate: string; // Friday YYYY-MM-DD
  todayDate: string; // Today YYYY-MM-DD
  daysPassedInWeek: number; // 1 to 7
  activeRecitationDaysThisWeek: string[]; // Active recitation dates up to today in this week
}

/**
 * Calculates the current week range starting on Saturday (السبت) and ending on Friday (الجمعة).
 * Automatically rolls over every Saturday, resetting weekly statistics without data deletion.
 */
export function getCurrentWeekRange(
  todayDateStr: string = formatDate(),
  settingsStartDate?: string,
  restDays: RestDay[] = []
): WeekRange {
  const parts = todayDateStr.split('-').map(Number);
  const localDate = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  const dayOfWeek = localDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysSinceSaturday = (dayOfWeek + 1) % 7;

  const satDate = new Date(localDate);
  satDate.setDate(localDate.getDate() - daysSinceSaturday);

  const friDate = new Date(satDate);
  friDate.setDate(satDate.getDate() + 6);

  const startDate = formatDate(satDate);
  const endDate = formatDate(friDate);
  const daysPassed = daysSinceSaturday + 1;

  const activeRecitationDaysThisWeek: string[] = [];
  const restDaySet = new Set(restDays.map((r) => r.date));
  const effectiveStart = settingsStartDate || startDate;

  const iter = new Date(satDate);
  for (let i = 0; i < daysPassed; i++) {
    const dStr = formatDate(iter);
    if (dStr <= todayDateStr && dStr >= effectiveStart) {
      if (!restDaySet.has(dStr)) {
        activeRecitationDaysThisWeek.push(dStr);
      }
    }
    iter.setDate(iter.getDate() + 1);
  }

  return {
    startDate,
    endDate,
    todayDate: todayDateStr,
    daysPassedInWeek: daysPassed,
    activeRecitationDaysThisWeek,
  };
}

/**
 * Format a YYYY-MM-DD date string into an accurate Umm al-Qura Hijri date string.
 * Example output: "الأحد، ٣ رمضان ١٤٤٧هـ"
 */
export function getHijriDate(dateStr?: string): string {
  try {
    let date: Date;
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.split('-');
      // Midday to avoid timezone shifting
      date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    } else {
      date = new Date();
    }

    const formatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let formatted = formatter.format(date);
    formatted = formatted.replace(/\s+هـ$/, 'هـ');
    if (!formatted.includes('هـ')) {
      formatted = `${formatted}هـ`;
    }

    return formatted;
  } catch (error) {
    console.error('Failed to format Hijri date:', error);
    return '';
  }
}

export interface ListenerStatsItem {
  user: User;
  timesListened: number;
}

/**
 * Calculate the listening peer leaderboard for active members over an optional date range.
 * If startDate and endDate are omitted, calculates all-time listening since course start.
 */
export function calculateListenersLeaderboard(
  activeMembers: User[],
  recitations: RecitationLog[],
  startDate?: string,
  endDate?: string
): ListenerStatsItem[] {
  const filteredRecitations = recitations.filter((r) => {
    if (!r.listener_id) return false;
    const reciterId = r.member_id || r.reciter_id;
    if (reciterId === r.listener_id) return false;
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    return true;
  });

  const countsMap = new Map<string, number>();
  for (const r of filteredRecitations) {
    if (r.listener_id) {
      countsMap.set(r.listener_id, (countsMap.get(r.listener_id) || 0) + 1);
    }
  }

  const list: ListenerStatsItem[] = activeMembers.map((m) => ({
    user: m,
    timesListened: countsMap.get(m.id) || 0,
  }));

  list.sort((a, b) => {
    if (b.timesListened !== a.timesListened) {
      return b.timesListened - a.timesListened;
    }
    return a.user.name.localeCompare(b.user.name, 'ar');
  });

  return list;
}

/**
 * Calculate total listening count for a specific user over an optional date range.
 */
export function calculateUserListeningCount(
  userId: string,
  recitations: RecitationLog[],
  startDate?: string,
  endDate?: string
): number {
  return recitations.filter((r) => {
    if (r.listener_id !== userId) return false;
    const reciterId = r.member_id || r.reciter_id;
    if (reciterId === userId) return false;
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    return true;
  }).length;
}

