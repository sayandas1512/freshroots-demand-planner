import { sendAlertEmail } from "@/lib/email";
import { log } from "@/lib/log";

/**
 * Run alerts. Called when a run fails or completes degraded: a JSON log line, plus an email through Resend when
 * RESEND_API_KEY and ALERT_EMAIL are set. Best effort, never changes the outcome of a run.
 */
export interface RunAlert {
  runId: string;
  asOf: string;
  status: "failed" | "completed_degraded";
  reasons: string[];
}

async function sendAlert(alert: RunAlert): Promise<void> {
  log("warn", "run alert", { runId: alert.runId, asOf: alert.asOf, status: alert.status, reasons: alert.reasons });
  await sendAlertEmail({
    subject: `Freshroots planner: run ${alert.status === "failed" ? "failed" : "completed with warnings"} (${alert.asOf})`,
    text: `Run ${alert.runId} for ${alert.asOf} ${alert.status === "failed" ? "failed" : "completed degraded"}.\n\n${alert.reasons.join("\n") || "No detail."}\n\nSee the Health page and docs/RUNBOOK.md.`,
  });
}

/** Never throws: an alert problem must not change the outcome of a run. */
export async function notifyRunProblem(alert: RunAlert): Promise<void> {
  try {
    await sendAlert(alert);
  } catch {
    /* alerting is best effort */
  }
}
