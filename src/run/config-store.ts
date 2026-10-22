import { desc, eq, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ruleConfig } from "@/db/schema";
import { DEFAULT_RULE_CONFIG, ruleConfigSchema, type RuleConfig } from "@/engine/config";

export interface StoredConfig {
  version: number;
  config: RuleConfig;
  note: string;
  createdAt: Date;
  isActive: boolean;
}

function toStored(row: typeof ruleConfig.$inferSelect): StoredConfig {
  return { version: row.version, config: ruleConfigSchema.parse(row.config), note: row.note, createdAt: row.createdAt, isActive: row.isActive };
}

export async function getActiveConfig(db: Db): Promise<StoredConfig> {
  const [row] = await db.select().from(ruleConfig).where(eq(ruleConfig.isActive, true)).limit(1);
  if (row) return toStored(row);
  return createConfigVersion(db, DEFAULT_RULE_CONFIG, "Defaults from the brief");
}

export async function getConfigVersion(db: Db, version: number): Promise<StoredConfig | null> {
  const [row] = await db.select().from(ruleConfig).where(eq(ruleConfig.version, version)).limit(1);
  return row ? toStored(row) : null;
}

export async function listConfigVersions(db: Db, limit = 20): Promise<StoredConfig[]> {
  const rows = await db.select().from(ruleConfig).orderBy(desc(ruleConfig.version)).limit(limit);
  return rows.map(toStored);
}

/** Append a new version and make it the only active one. Versions are never edited in place. */
export async function createConfigVersion(db: Db, config: RuleConfig, note: string, createdBy: string | null = null): Promise<StoredConfig> {
  const valid = ruleConfigSchema.parse(config);
  return db.transaction(async (tx) => {
    const [top] = await tx.select({ v: max(ruleConfig.version) }).from(ruleConfig);
    await tx.update(ruleConfig).set({ isActive: false }).where(eq(ruleConfig.isActive, true));
    const [row] = await tx
      .insert(ruleConfig)
      .values({ version: (top?.v ?? 0) + 1, config: { ...valid }, isActive: true, note, createdBy })
      .returning();
    if (!row) throw new Error("Could not create config version");
    return toStored(row);
  });
}
