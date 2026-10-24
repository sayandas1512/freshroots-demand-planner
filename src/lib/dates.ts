/** Today's calendar date in India (the business timezone), as YYYY-MM-DD. */
export function todayIst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const istFormat = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" });

/** A date and time in India time, the same on the server and in every browser (so the page hydrates cleanly). */
export function formatIst(value: string | number | Date): string {
  return istFormat.format(new Date(value));
}
