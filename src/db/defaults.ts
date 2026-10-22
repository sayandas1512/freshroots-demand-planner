import { eq } from "drizzle-orm";
import { DEFAULT_RULE_CONFIG } from "@/engine/config";
import type { Db } from "./client";
import { baseline, ruleConfig } from "./schema";

/** Rows the app needs to function: the documented rule config (v1) and the brief's baseline ranges. */
export async function ensureDefaults(db: Db): Promise<void> {
  const existing = await db.select({ id: ruleConfig.id }).from(ruleConfig).limit(1);
  if (existing.length === 0) {
    await db
      .insert(ruleConfig)
      .values({ version: 1, config: { ...DEFAULT_RULE_CONFIG }, isActive: true, note: "Raghav's documented rules (defaults from the brief)" })
      .onConflictDoNothing();
  }
  const seeded = await db.select({ period: baseline.period }).from(baseline).where(eq(baseline.period, "brief-quarterly-range")).limit(1);
  if (seeded.length === 0) {
    await db.insert(baseline).values({
      period: "brief-quarterly-range",
      stockoutLossInr: 1_800_000,
      stockoutLossInrHigh: 2_200_000,
      writeoffInr: 1_000_000,
      writeoffInrHigh: 1_200_000,
      source: "Project brief: ₹18 to 22 lakh stockout loss and ₹10 to 12 lakh write-offs per quarter (a range, not a point)",
    });
  }
}
