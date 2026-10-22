import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { exceptions, overrides, recommendations } from "@/db/schema";

const reason = z.string().trim().min(3, "Give a reason of at least 3 characters").max(500);

export const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("edit"), qty: z.number().int().min(1).max(10_000_000), reason }),
  z.object({ action: z.literal("reject"), reason }),
  z.object({ action: z.literal("undo") }),
]);
export type DecisionInput = z.infer<typeof decisionSchema>;

export const handleExceptionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("handle"), note: reason }),
  z.object({ action: z.literal("reopen") }),
]);

export class NotFoundError extends Error {}

const describe = (action: string, qty: number | null): string => (qty === null ? action : `${action} ${qty}`);

/**
 * Record Raghav's decision on one line. Edits and rejections require a reason and are written to the
 * override log, which is how his undocumented 15 to 20% becomes documented over time.
 */
export async function applyDecision(db: Db, recommendationId: string, input: DecisionInput, now: Date = new Date()) {
  return db.transaction(async (tx) => {
    const [rec] = await tx.select().from(recommendations).where(eq(recommendations.id, recommendationId)).limit(1);
    if (!rec) throw new NotFoundError("Recommendation not found");

    const proposed = describe(rec.action, rec.qty);
    switch (input.action) {
      case "approve":
        await tx.update(recommendations).set({ status: "approved", finalQty: rec.qty, decidedAt: now, decidedNote: null }).where(eq(recommendations.id, rec.id));
        break;
      case "edit":
        await tx.update(recommendations).set({ status: "edited", finalQty: input.qty, decidedAt: now, decidedNote: input.reason }).where(eq(recommendations.id, rec.id));
        await tx.insert(overrides).values({ recommendationId: rec.id, field: "qty", fromValue: rec.qty === null ? `${rec.action} (no quantity)` : String(rec.qty), toValue: String(input.qty), reason: input.reason, at: now });
        break;
      case "reject":
        await tx.update(recommendations).set({ status: "rejected", finalQty: null, decidedAt: now, decidedNote: input.reason }).where(eq(recommendations.id, rec.id));
        await tx.insert(overrides).values({ recommendationId: rec.id, field: "status", fromValue: proposed, toValue: "rejected", reason: input.reason, at: now });
        break;
      case "undo":
        await tx.update(recommendations).set({ status: "pending", finalQty: null, decidedAt: null, decidedNote: null }).where(eq(recommendations.id, rec.id));
        await tx.insert(overrides).values({ recommendationId: rec.id, field: "status", fromValue: rec.status, toValue: "pending", reason: "Decision undone by reviewer", at: now });
        break;
    }
    const [updated] = await tx.select().from(recommendations).where(eq(recommendations.id, rec.id)).limit(1);
    return updated!;
  });
}

export async function applyExceptionAction(db: Db, exceptionId: string, input: z.infer<typeof handleExceptionSchema>, now: Date = new Date()) {
  const [row] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId)).limit(1);
  if (!row) throw new NotFoundError("Exception not found");
  const patch = input.action === "handle" ? { status: "handled" as const, handledNote: input.note, handledAt: now } : { status: "open" as const, handledNote: null, handledAt: null };
  await db.update(exceptions).set(patch).where(eq(exceptions.id, exceptionId));
  const [updated] = await db.select().from(exceptions).where(eq(exceptions.id, exceptionId)).limit(1);
  return updated!;
}
