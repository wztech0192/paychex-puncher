const observedHolidayNames = [
  "New Year's Eve",
  "Memorial Day",
  "Independence Day",
  "Labor Day",
  "Thanksgiving",
  "Christmas Day",
] as const;

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): string {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
  return toDateKey(year, month, day);
}

function lastWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  const day = lastDay - ((lastWeekday - weekday + 7) % 7);
  return toDateKey(year, month, day);
}

function getHolidaysForYear(year: number): Record<string, string> {
  return {
    [toDateKey(year, 12, 31)]: "New Year's Eve",
    [lastWeekdayOfMonth(year, 5, 1)]: "Memorial Day",
    [toDateKey(year, 7, 4)]: "Independence Day",
    [nthWeekdayOfMonth(year, 9, 1, 1)]: "Labor Day",
    [nthWeekdayOfMonth(year, 11, 4, 4)]: "Thanksgiving",
    [toDateKey(year, 12, 25)]: "Christmas Day",
  };
}

/** Returns the holiday name for an Eastern `YYYY-MM-DD` date, or null. */
export function getHolidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));

  if (!Number.isInteger(year)) {
    return null;
  }

  return getHolidaysForYear(year)[date] ?? null;
}

export function listHolidayNames(): string {
  return observedHolidayNames.join(", ");
}
