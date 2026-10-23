import { createServer } from "node:http";
import { FakeZoho } from "../tests/fake-zoho";

/** A stand-in Zoho for the end-to-end run, on the same HTTP shape the connector uses. GET /__state shows what it holds. */
const zoho = new FakeZoho();
zoho.items = ["SKU001", "SKU002", "SKU003", "SKU004", "SKU005"].map((sku, i) => ({ item_id: `item-${sku}`, name: `Zoho ${sku}`, sku, purchase_rate: 40 + i }));
zoho.vendors = [{ contact_id: "vendor-A", contact_name: "Sahyadri Supplies" }, { contact_id: "vendor-B", contact_name: "Deccan Wholesale" }];
zoho.pos = [{ purchaseorder_id: "po-open-1", purchaseorder_number: "PO-0001", status: "issued", vendor_id: "vendor-A", total: 1200, delivery_date: "2026-10-25", line_items: [{ item_id: "item-SKU001", quantity: 300, quantity_received: 0 }] }];

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:4010");
  if (url.pathname === "/__state") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ pos: zoho.pos, calls: zoho.calls.map((c) => `${c.method} ${c.path}`) }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
  const out = await zoho.fetch(url.toString(), { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks).toString() : undefined });
  res.statusCode = out.status;
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(await out.text());
}).listen(4010, () => console.log("fake zoho on 4010"));
