import type { Role } from "@/auth/roles";

/** The go-live checklist. Each item is ticked by a named user; some are only for the sponsor (or an admin). */
export interface GoLiveItem {
  key: string;
  label: string;
  help: string;
  roles: readonly Role[];
}

export const GO_LIVE_ITEMS: readonly GoLiveItem[] = [
  { key: "backtest_reviewed", label: "Backtest agreement reviewed", help: "Run the backtest on real history and read the agreement with Raghav's past orders.", roles: ["planner", "sponsor", "admin"] },
  { key: "shadow_reviewed", label: "Shadow comparison reviewed", help: "About 8 shadow runs compared with Raghav's own forecast; open defects triaged.", roles: ["planner", "sponsor", "admin"] },
  { key: "kill_thresholds_confirmed", label: "Kill thresholds confirmed by the sponsor", help: "The values on Settings are starting proposals until the sponsor confirms them.", roles: ["sponsor", "admin"] },
  { key: "loss_method_recorded", label: "Loss-calculation method recorded", help: "The method note on the monthly outcome entries says how stockout loss and write-offs are worked out.", roles: ["sponsor", "data", "admin"] },
  { key: "baseline_weekly_ready", label: "Weekly baseline figures entered", help: "At least 8 weeks of outcomes before go-live. They are frozen when the mode changes to live.", roles: ["data", "sponsor", "admin"] },
  { key: "kill_drill_done", label: "Kill drill done", help: "Trip by hand, trip by a simulated breach, clear with a note.", roles: ["sponsor", "admin"] },
  { key: "procurement_agreed", label: "Procurement agreed to act on approved lines", help: "Including ordering twice a week.", roles: ["planner", "sponsor", "admin"] },
  { key: "hosting_signed_off", label: "IT and CEO signed off hosting", help: "Commercial data is hosted on Neon and Vercel.", roles: ["sponsor", "admin"] },
] as const;

export const WEEKS_NEEDED_FOR_BASELINE = 8;
