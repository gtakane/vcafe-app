export interface ParsedDateRange {
  startAt: Date;
  endAt: Date;
}

function validDate(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function parseAnalyticsRange(start: string, end: string, maximumDays = 366): ParsedDateRange | null {
  if (!validDate(start) || !validDate(end)) return null;
  const startAt = new Date(`${start}T00:00:00+09:00`);
  const endAt = new Date(`${end}T23:59:59.999+09:00`);
  if (endAt < startAt || endAt.getTime() - startAt.getTime() > maximumDays * 24 * 60 * 60 * 1000) return null;
  return { startAt, endAt };
}
