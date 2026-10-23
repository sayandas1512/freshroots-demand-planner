import type { Actor } from "@/auth/actor";
import { firstMissingPermission } from "@/auth/config-auth";
import type { RuleConfig } from "@/engine/config";
import { diffConfig } from "@/engine/config";
import { createConfigVersion, getActiveConfig } from "./config-store";

export class ForbiddenError extends Error {}

/** Save a new config version for an actor. What you may change depends on your role: rules for the planner, kill thresholds and switches for the sponsor. */
export async function saveConfigChange(db: Parameters<typeof getActiveConfig>[0], input: { config: RuleConfig; note: string; actor: Actor }) {
  const active = await getActiveConfig(db);
  const changed = diffConfig(active.config, input.config).map((c) => c.key);
  if (firstMissingPermission(input.actor.role, changed)) throw new ForbiddenError(`Your role (${input.actor.role}) cannot change these settings.`);
  return createConfigVersion(db, input.config, input.note, input.actor.userId);
}
