/** An in-memory Zoho: OAuth token endpoint plus the Inventory endpoints the connector uses, with fault injection. */
export interface FakeItem { item_id: string; name: string; sku?: string; purchase_rate?: number; vendor_id?: string; status?: string }
export interface FakePo { purchaseorder_id: string; purchaseorder_number: string; status: string; vendor_id: string; total: number; delivery_date?: string; line_items: { item_id: string; quantity: number; quantity_received: number }[] }

export class FakeZoho {
  items: FakeItem[] = [];
  vendors: { contact_id: string; contact_name: string }[] = [];
  pos: FakePo[] = [];
  pageSize = 200;
  tokenCount = 0;
  validTokens = new Set<string>();
  tokenExpiresIn = 3600;
  tokenFails = false;
  failNext: { status: number; times: number; headers?: Record<string, string> } | null = null;
  networkErrorOnCreate = false;
  createDelayMs = 0;
  calls: { method: string; path: string; query: URLSearchParams; body: unknown; auth: string | null }[] = [];
  tokenCalls: { body: URLSearchParams; url: string }[] = [];
  private nextId = 9000;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.pathname.startsWith("/oauth/v2/token")) return this.token(url, init);

    const path = url.pathname.replace("/inventory/v1", "");
    const auth = new Headers(init?.headers).get("authorization");
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    this.calls.push({ method, path, query: url.searchParams, body, auth });

    if (!auth || !this.validTokens.has(auth.replace("Zoho-oauthtoken ", ""))) return json(401, { code: 57, message: "You are not authorized to perform this operation" });
    if (this.failNext && this.failNext.times > 0) {
      this.failNext.times -= 1;
      return new Response(JSON.stringify({ code: 1, message: "injected" }), { status: this.failNext.status, headers: { "content-type": "application/json", ...(this.failNext.headers ?? {}) } });
    }
    if (!url.searchParams.get("organization_id")) return json(400, { code: 6, message: "organization_id is required" });

    if (method === "GET" && path === "/items") return this.page(url, "items", this.items);
    if (method === "GET" && path === "/contacts") return this.page(url, "contacts", this.vendors);
    if (method === "GET" && path === "/purchaseorders") return this.page(url, "purchaseorders", this.pos.map((p) => ({ purchaseorder_id: p.purchaseorder_id, purchaseorder_number: p.purchaseorder_number, status: p.status, vendor_id: p.vendor_id, total: p.total })));
    const detail = /^\/purchaseorders\/(.+)$/.exec(path);
    if (method === "GET" && detail) {
      const po = this.pos.find((p) => p.purchaseorder_id === detail[1]);
      return po ? json(200, { code: 0, message: "success", purchaseorder: po }) : json(404, { code: 1002, message: "does not exist" });
    }
    if (method === "POST" && path === "/purchaseorders") {
      if (this.createDelayMs) await new Promise((r) => setTimeout(r, this.createDelayMs));
      if (this.networkErrorOnCreate) throw new TypeError("fetch failed");
      const b = body as { purchaseorder_number: string; vendor_id: string; line_items: { item_id: string; quantity: number; purchase_rate: number }[] };
      if (!b.vendor_id || !b.line_items?.length) return json(400, { code: 4, message: "vendor_id and line_items are required" });
      this.nextId += 1;
      const po: FakePo = { purchaseorder_id: String(this.nextId), purchaseorder_number: b.purchaseorder_number, status: "draft", vendor_id: b.vendor_id, total: b.line_items.reduce((a, l) => a + l.quantity * l.purchase_rate, 0), line_items: b.line_items.map((l) => ({ item_id: l.item_id, quantity: l.quantity, quantity_received: 0 })) };
      this.pos.push(po);
      return json(201, { code: 0, message: "The purchase order has been created.", purchaseorder: { purchaseorder_id: po.purchaseorder_id, purchaseorder_number: po.purchaseorder_number, status: "draft" } });
    }
    return json(404, { code: 5, message: `no such endpoint ${method} ${path}` });
  };

  private token(url: URL, init: RequestInit | undefined): Response {
    const body = new URLSearchParams(String(init?.body ?? ""));
    this.tokenCalls.push({ body, url: url.toString() });
    if (this.tokenFails || body.get("grant_type") !== "refresh_token" || body.get("refresh_token") !== "refresh-123") return json(400, { error: "invalid_code" });
    this.tokenCount += 1;
    const token = `tok-${this.tokenCount}`;
    this.validTokens.add(token);
    return json(200, { access_token: token, expires_in: this.tokenExpiresIn, api_domain: "https://www.zohoapis.in", token_type: "Bearer" });
  }

  private page(url: URL, key: string, all: unknown[]): Response {
    const page = Number(url.searchParams.get("page") ?? 1);
    const rows = all.slice((page - 1) * this.pageSize, page * this.pageSize);
    return json(200, { code: 0, message: "success", [key]: rows, page_context: { page, per_page: this.pageSize, has_more_page: page * this.pageSize < all.length } });
  }

  expireAllTokens(): void {
    this.validTokens.clear();
  }
  count(method: string, pathPrefix: string): number {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathPrefix)).length;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
