import type { RuleConfig } from "@/engine/config";
import { can, type Permission, type Role } from "./roles";

const MODE_KEYS: (keyof RuleConfig)[] = ["mode", "zoho_push_enabled"];
const KILL_KEYS: (keyof RuleConfig)[] = [
  "indicator_kill_pct",
  "indicator_warn_pct",
  "indicator_consecutive_checks",
  "override_kill_rate",
  "override_kill_runs",
  "rubber_override_rate",
  "rubber_median_seconds",
  "rubber_runs",
];

/** Which permission each changed setting needs: the mode and kill thresholds belong to the sponsor, rules to the planner. */
export function permissionsFor(changed: readonly (keyof RuleConfig)[]): Permission[] {
  const need = new Set<Permission>();
  for (const key of changed) {
    if (MODE_KEYS.includes(key)) need.add("setMode");
    else if (KILL_KEYS.includes(key)) need.add("editKill");
    else need.add("editRules");
  }
  return [...need];
}

/** Returns the first permission the role lacks, or null when the whole change is allowed. */
export function firstMissingPermission(role: Role, changed: readonly (keyof RuleConfig)[]): Permission | null {
  return permissionsFor(changed).find((p) => !can(role, p)) ?? null;
}
