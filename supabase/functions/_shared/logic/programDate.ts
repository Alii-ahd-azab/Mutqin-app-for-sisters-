// THE program date of Mutqin (Sisters): the Africa/Cairo local date, with the day starting at 05:00
// (not midnight). Shared by the web app and the Edge Functions (pure TypeScript, bundled by Vite and
// Deno); the database has the same rule in app_private.program_date(timestamptz) / program_today().
//
// Cairo's UTC offset changes with daylight saving time, so the rule is applied to the Cairo
// wall-clock time given by the IANA time-zone database, never to a fixed offset: 04:59:59 Cairo is
// still the previous program date, 05:00:00 Cairo starts the new one. The device's time zone plays
// no part, so every member sees the same program day wherever she is.

export const PROGRAM_TIME_ZONE = 'Africa/Cairo';
export const PROGRAM_DAY_START_HOUR = 5;

/**
 * Stored membership dates (joined_at) keep the calendar they were read with before the 05:00 rule:
 * the Makkah calendar date of the timestamp (as the Edge Functions did, and as SQL does). Reading them
 * with the 05:00 Cairo rule would move early-morning join dates one day earlier and create review
 * debt that was never owed.
 */
export const MEMBERSHIP_DATE_TIME_ZONE = 'Asia/Riyadh';

const wallClock = new Map<string, Intl.DateTimeFormat>();

function wallParts(instant: Date, timeZone: string) {
  let fmt = wallClock.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    wallClock.set(timeZone, fmt);
  }
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** YYYY-MM-DD plus n days (pure calendar arithmetic, independent of any time zone). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day of the week of a YYYY-MM-DD date (0 = Sunday … 6 = Saturday), independent of any time zone. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** The Mutqin program date at an instant: Cairo wall-clock time minus 5 hours, as a date. */
export function programDate(instant: Date = new Date()): string {
  const wall = wallParts(instant, PROGRAM_TIME_ZONE);
  return wall.hour < PROGRAM_DAY_START_HOUR ? addDays(wall.date, -1) : wall.date;
}

/** The calendar date of a stored membership timestamp (see MEMBERSHIP_DATE_TIME_ZONE). */
export function membershipDate(timestamp: string | Date): string | undefined {
  const instant = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (Number.isNaN(instant.getTime())) return undefined;
  return wallParts(instant, MEMBERSHIP_DATE_TIME_ZONE).date;
}

/** The instant when a program date starts: 05:00 Cairo local time on that date. */
export function programDayStart(date: string): Date {
  const wanted = Date.parse(`${date}T${String(PROGRAM_DAY_START_HOUR).padStart(2, '0')}:00:00Z`);
  // Start from the wall time read as UTC, then correct by Cairo's offset at the candidate instant
  // (twice, in case the first guess falls on the other side of a DST change).
  let t = wanted;
  for (let i = 0; i < 3; i++) {
    const wall = wallParts(new Date(t), PROGRAM_TIME_ZONE);
    const wallMs = Date.parse(
      `${wall.date}T${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:${String(wall.second).padStart(2, '0')}Z`
    );
    const offset = wallMs - t;
    const next = wanted - offset;
    if (next === t) break;
    t = next;
  }
  return new Date(t);
}

/** The instant the NEXT program day starts (the coming 05:00 Cairo). */
export function nextProgramDayStart(instant: Date = new Date()): Date {
  return programDayStart(addDays(programDate(instant), 1));
}
