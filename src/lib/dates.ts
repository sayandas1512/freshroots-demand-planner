/** Today's calendar date in India (the business timezone), as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const istParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/**
 * A date and time in India time as "DD/MM/YYYY, HH:MM:SS", built from parts so Node and every browser produce the
 * same characters (their locale strings differ in small ways, which breaks hydration).
 */
export function formatIst(value: string | number | Date): string {
  const p = Object.fromEntries(istParts.formatToParts(new Date(value)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}, ${p.hour}:${p.minute}:${p.second}`;
}
