import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, requirePermission } from "@/auth/actor";
import { getDb } from "@/db/client";
import { zohoItemMap, zohoVendorMap } from "@/db/schema";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("vendor"), key: z.string().min(1).max(60), value: z.string().min(1).max(60).nullable() }),
  z.object({ type: z.literal("item"), key: z.string().min(1).max(60), value: z.string().min(1).max(60).nullable() }),
]);

/** Map a Distributor_ID to a Zoho vendor, or a SKU to a Zoho item. A null value removes the mapping. */
export async function POST(request: Request) {
  const actor = await requirePermission(request, "upload");
  if (isResponse(actor)) return actor;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid mapping" }, { status: 400 });
  const { type, key, value } = parsed.data;
  const db = await getDb();
  if (type === "vendor") {
    if (value === null) await db.delete(zohoVendorMap).where(eq(zohoVendorMap.distributorId, key));
    else await db.insert(zohoVendorMap).values({ distributorId: key, vendorId: value, setBy: actor.userId }).onConflictDoUpdate({ target: zohoVendorMap.distributorId, set: { vendorId: value, setBy: actor.userId, at: new Date() } });
  } else if (value === null) await db.delete(zohoItemMap).where(eq(zohoItemMap.skuId, key));
  else await db.insert(zohoItemMap).values({ skuId: key, itemId: value, setBy: actor.userId }).onConflictDoUpdate({ target: zohoItemMap.skuId, set: { itemId: value, setBy: actor.userId, at: new Date() } });
  return NextResponse.json({ ok: true });
}
