import { and, asc, eq, inArray, isNotNull, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { recommendations, skus } from "@/db/schema";
import type { ExportLine } from "./mapping";

/** Only approved and edited lines with a positive quantity can become purchase-order lines. */
export async function approvedExportLines(db: Db, runId: string): Promise<ExportLine[]> {
  const rows = await db
    .select({
      skuId: recommendations.skuId,
      name: skus.name,
      qty: recommendations.finalQty,
      unit: skus.unit,
      distributorId: skus.distributorId,
      at: recommendations.decidedAt,
    })
    .from(recommendations)
    .innerJoin(skus, eq(skus.skuId, recommendations.skuId))
    .where(and(eq(recommendations.runId, runId), inArray(recommendations.status, ["approved", "edited"]), isNotNull(recommendations.finalQty), gt(recommendations.finalQty, 0)))
    .orderBy(asc(recommendations.skuId));
  return rows.map((r) => ({ skuId: r.skuId, skuName: r.name, quantity: r.qty ?? 0, unit: r.unit, distributorId: r.distributorId, runId, approvedAt: r.at ?? new Date(0) }));
}
