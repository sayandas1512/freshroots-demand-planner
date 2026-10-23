import { log } from "./log";

export interface Email {
  subject: string;
  text: string;
}

/**
 * Send through Resend's REST API. Best effort: when keys are missing or the call fails it logs and returns false, so the
 * caller can fall back (alerts keep their on-screen banner). Recipients are never logged.
 */
export async function sendEmail(to: string[], email: Email, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || to.length === 0) {
    log("warn", "email not sent: RESEND_API_KEY or recipient missing", { subject: email.subject });
    return false;
  }
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM ?? "Freshroots Planner <onboarding@resend.dev>", to, subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log("error", "email failed", { status: res.status, subject: email.subject });
      return false;
    }
    return true;
  } catch (err) {
    log("error", "email failed", { error: err instanceof Error ? err.message : "unknown", subject: email.subject });
    return false;
  }
}

/** Alert email to ALERT_EMAIL (comma separated). */
export function sendAlertEmail(email: Email, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const to = (process.env.ALERT_EMAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return sendEmail(to, email, fetchImpl);
}
