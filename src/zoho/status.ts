import { desc } from "drizzle-orm";
import type { Db } from "@/db/client";
import { distributors, openPos, skus, zohoItemMap, zohoItems, zohoPurchaseOrders, zohoPushLog, zohoVendorMap, zohoVendors } from "@/db/schema";
import { zohoConfig } from "./config";
import { callsSpentToday, lastSync, skuForItems } from "./sync";

export interface ZohoStatus {
  configured: boolean;
  dc: string | null;
  orgId: string | null;
  lastSync: { at: string; ok: boolean; error: string | null; trigger: string; calls: number } | null;
  callsToday: number;
  budget: number | null;
  counts: { items: number; vendors: number; openPos: number; openPoRows: number };
  distributors: { id: string; name: string; region: string; vendorId: string | null }[];
  vendors: { id: string; name: string }[];
  items: { id: string; name: string; sku: string | null }[];
  unmappedItems: { itemId: string; name: string; openQty: number }[];
  skusWithoutItem: { skuId: string; name: string }[];
  overrides: { skuId: string; itemId: string }[];
  pushLog: { at: string; reference: string; vendorId: string; status: string; zohoPoNumber: string | null; error: string | null; lineCount: number }[];
}

export async function zohoStatus(db: Db): Promise<ZohoStatus> {
  const cfg = zohoConfig();
  const [last, items, vendors, dists, pos, rows, map, master, overrides, pushes, spent] = await Promise.all([
    lastSync(db),
    db.select().from(zohoItems),
    db.select().from(zohoVendors),
    db.select().from(distributors).orderBy(distributors.distributorId),
    db.select().from(zohoPurchaseOrders),
    db.select().from(openPos),
    db.select().from(zohoVendorMap),
    db.select().from(skus).orderBy(skus.skuId),
    db.select().from(zohoItemMap),
    db.select().from(zohoPushLog).orderBy(desc(zohoPushLog.at)).limit(20),
    callsSpentToday(db),
  ]);
  const vendorOf = new Map(map.map((m) => [m.distributorId, m.vendorId]));
  const itemToSku = await skuForItems(db);
  const open = new Set(cfg?.openStatuses ?? ["issued", "partially_received", "open"]);
  const names = new Map(items.map((i) => [i.itemId, i.name]));
  const unmapped = new Map<string, { name: string; qty: number }>();
  for (const po of pos.filter((p) => open.has(p.status))) {
    for (const l of po.lines ?? []) {
      const qty = Math.round(l.quantity - l.received);
      if (qty > 0 && !itemToSku.has(l.itemId)) unmapped.set(l.itemId, { name: names.get(l.itemId) ?? "", qty: (unmapped.get(l.itemId)?.qty ?? 0) + qty });
    }
  }
  const matched = new Set(itemToSku.values());
  return {
    configured: cfg !== null,
    dc: cfg?.dc ?? null,
    orgId: cfg?.orgId ?? null,
    lastSync: last ? { at: last.at.toISOString(), ok: last.ok, error: last.error, trigger: last.trigger, calls: last.calls } : null,
    callsToday: spent,
    budget: cfg?.dailyBudget ?? null,
    counts: { items: items.length, vendors: vendors.length, openPos: pos.filter((p) => open.has(p.status)).length, openPoRows: rows.filter((r) => r.source === "zoho").length },
    distributors: dists.map((d) => ({ id: d.distributorId, name: d.name, region: d.region, vendorId: vendorOf.get(d.distributorId) ?? null })),
    vendors: vendors.map((v) => ({ id: v.vendorId, name: v.name })).sort((a, b) => a.name.localeCompare(b.name)),
    items: items.map((i) => ({ id: i.itemId, name: i.name, sku: i.sku })).sort((a, b) => a.name.localeCompare(b.name)),
    unmappedItems: [...unmapped].map(([itemId, v]) => ({ itemId, name: v.name, openQty: v.qty })),
    skusWithoutItem: master.filter((s) => !matched.has(s.skuId)).map((s) => ({ skuId: s.skuId, name: s.name })),
    overrides: overrides.map((o) => ({ skuId: o.skuId, itemId: o.itemId })),
    pushLog: pushes.map((p) => ({ at: p.at.toISOString(), reference: p.reference, vendorId: p.vendorId, status: p.status, zohoPoNumber: p.zohoPoNumber, error: p.error, lineCount: p.lines.length })),
  };
}
