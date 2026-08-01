import { MILLISECONDS_PER_DAY } from "./time.js";

const WEEKLY_SCORE_TIME_ZONE_OFFSET_MINUTES = 9 * 60;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

export function getWeeklyScoreWeekStart(date: Date): Date {
  const shiftedTime =
    date.getTime() + WEEKLY_SCORE_TIME_ZONE_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;
  const shiftedDate = new Date(shiftedTime);
  const daysSinceMonday = (shiftedDate.getUTCDay() + 6) % 7;
  const weekStartTime =
    Date.UTC(shiftedDate.getUTCFullYear(), shiftedDate.getUTCMonth(), shiftedDate.getUTCDate()) -
    daysSinceMonday * MILLISECONDS_PER_DAY -
    WEEKLY_SCORE_TIME_ZONE_OFFSET_MINUTES * MILLISECONDS_PER_MINUTE;

  return new Date(weekStartTime);
}

export function isSameWeeklyScoreWeek(left: Date | null, right: Date): boolean {
  return left?.getTime() === right.getTime();
}
