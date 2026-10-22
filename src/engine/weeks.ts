/** ISO-8601 week helpers. Dates are 'YYYY-MM-DD' strings handled in UTC so the server timezone never matters. */
const DAY_MS = 86_400_000;

export function parseDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (formatDate(d) !== date) throw new Error(`Invalid date: ${date}`);
  return d;
}

export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return formatDate(new Date(parseDate(date).getTime() + days * DAY_MS));
}

export function isoWeekOf(date: string): string {
  const d = parseDate(date);
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(d.getTime() + (3 - dayFromMonday) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayWeekDay = (firstThursday.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(firstThursday.getTime() + (3 - firstThursdayWeekDay) * DAY_MS);
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export const WEEK_PATTERN = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** Monday of the ISO week. */
export function weekStart(week: string): string {
  const m = WEEK_PATTERN.exec(week);
  if (!m) throw new Error(`Invalid ISO week: ${week}`);
  const year = Number(m[1]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4WeekDay = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = jan4.getTime() - jan4WeekDay * DAY_MS;
  return formatDate(new Date(week1Monday + (Number(m[2]) - 1) * 7 * DAY_MS));
}

/** A week is complete once its Sunday is strictly before the run date. */
export function lastCompleteWeek(asOf: string): string {
  return isoWeekOf(addDays(asOf, -7));
}

/** The last `count` complete weeks as of `asOf`, oldest first. */
export function lastCompleteWeeks(asOf: string, count: number): string[] {
  const newest = weekStart(lastCompleteWeek(asOf));
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) out.push(isoWeekOf(addDays(newest, -7 * i)));
  return out;
}

export function yearMonthOf(date: string): string {
  parseDate(date);
  return date.slice(0, 7);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY_MS);
}
