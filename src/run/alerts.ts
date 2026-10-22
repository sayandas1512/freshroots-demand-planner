/**
 * Hook for run alerts (email, chat, pager). Called when a run fails or completes degraded.
 * Email is deferred (see README): wire a sender in `sendAlert` without touching the pipeline.
 */
export interface RunAlert {
  runId: string;
  asOf: string;
  status: "failed" | "completed_degraded";
  reasons: string[];
}

async function sendAlert(alert: RunAlert): Promise<void> {
  // One line, no secrets, no prompts. Replace or extend this to send email.
  console.warn(`[run-alert] run ${alert.runId} (${alert.asOf}) ${alert.status}: ${alert.reasons.join(" | ") || "no detail"}`);
}

/** Never throws: an alert problem must not change the outcome of a run. */
export async function notifyRunProblem(alert: RunAlert): Promise<void> {
  try {
    await sendAlert(alert);
  } catch {
    /* alerting is best effort */
  }
}
