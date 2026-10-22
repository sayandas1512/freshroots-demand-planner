import type { Action, ExceptionType, Flag, LineMetrics } from "@/engine/types";

/** Serializable shapes passed from server components to the Review client. */
export type RunStatus = "running" | "completed" | "completed_degraded" | "failed" | "skipped_killed";
export type DecisionStatus = "pending" | "approved" | "edited" | "rejected";
export type StepState = "pending" | "running" | "done" | "degraded" | "failed" | "skipped";

export interface ReviewRun {
  id: string;
  status: RunStatus;
  trigger: "cron" | "manual" | "backtest";
  asOf: string;
  startedAt: string;
  finishedAt: string | null;
  llmStatus: "ok" | "partial" | "failed" | "skipped";
  configVersion: number | null;
  festivalMode: string | null;
  notes: string[];
  steps: Record<string, { status: StepState; detail?: string }>;
}

export interface ReviewRow {
  id: string;
  skuId: string;
  name: string;
  category: string;
  unit: string;
  distributorId: string;
  action: Action;
  flags: Flag[];
  ruleFired: string;
  qty: number | null;
  metrics: LineMetrics;
  explanation: string;
  source: "llm" | "template";
  status: DecisionStatus;
  finalQty: number | null;
  decidedNote: string | null;
}

export interface ReviewException {
  id: string;
  skuId: string;
  name: string | null;
  type: ExceptionType;
  detail: string;
  status: "open" | "handled";
  handledNote: string | null;
}

export interface ReviewData {
  run: ReviewRun;
  headline: { lines: string[]; source: "llm" | "template" } | null;
  rows: ReviewRow[];
  exceptions: ReviewException[];
}
