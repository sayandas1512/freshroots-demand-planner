/**
 * Structured JSON logs, one object per line. Fields whose names look like secrets or prompts are redacted,
 * so a stray `log("x", { apiKey })` cannot leak. Always pass `runId` when there is one.
 */
const SENSITIVE = /key|secret|password|token|authorization|cookie|prompt/i;

export type LogLevel = "info" | "warn" | "error";

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k)) out[k] = "[redacted]";
    else if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}

export function logLine(level: LogLevel, msg: string, fields: Record<string, unknown> = {}, now: Date = new Date()): string {
  return JSON.stringify({ t: now.toISOString(), level, msg, ...redact(fields) });
}

export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const line = logLine(level, msg, fields);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
