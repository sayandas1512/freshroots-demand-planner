import { log } from "./log";

export interface Email {
  subject: string;
  text: string;
}

/**
 * Alert email through Resend's REST API. Best effort: when keys are missing or the call fails it logs and returns
 * false, so the caller keeps its on-screen banner and nothing else changes.
 */
export async function sendAlertEmail(email: Email, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) {
    log("warn", "alert email not sent: RESEND_API_KEY or ALERT_EMAIL is not set", { subject: email.subject });
    return false;
  }
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM ?? "Freshroots Planner <onboarding@resend.dev>", to: to.split(",").map((s) => s.trim()), subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      log("error", "alert email failed", { status: res.status, subject: email.subject });
      return false;
    }
    return true;
  } catch (err) {
    log("error", "alert email failed", { error: err instanceof Error ? err.message : "unknown", subject: email.subject });
    return false;
  }
}
