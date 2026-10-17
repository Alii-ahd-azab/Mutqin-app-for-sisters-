// Program state helpers shared by the web app and the Edge Functions.
// Pure TypeScript only (bundled by both Vite and Deno).

import type { GroupSettings } from './programTypes.ts';

export interface ProgramCycleRow {
  id: string;
  starts_on: string;
  cycle_number: number;
}

export interface ProgramPauseRow {
  paused_on: string;
  resumed_on: string | null;
}

/** Whole days between two YYYY-MM-DD dates (0 if invalid or not after). */
export function dayDifference(
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

/**
 * Program settings of one cycle (start date + pause state),
 * built from its cycle row and pause rows.
 */
export function buildProgramSettings(
  cycle: ProgramCycleRow,
  pauses: ProgramPauseRow[]
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
  };
}

/**
 * Calendar date of a revision confirmation: the active program date
 * of its program_day, falling back to the confirmation timestamp.
 */
export function revisionDateForProgramDay(
  activeDates: string[],
  programDay: number,
  confirmedAt: string
): string {
  return (
    activeDates[programDay - 1] ||
    String(confirmedAt).slice(0, 10)
  );
}
