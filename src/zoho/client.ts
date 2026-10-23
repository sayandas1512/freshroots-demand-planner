import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { appState } from "@/db/schema";
import { log } from "@/lib/log";
import type { ZohoConfig } from "./config";

/** Where the short-lived access token is kept so every serverless instance shares one instead of each refreshing its own. */
export interface TokenStore {
  load(): Promise<{ token: string; expiresAt: number } | null>;
  save(value: { token: string; expiresAt: number }): Promise<void>;
}

export function dbTokenStore(db: Db): TokenStore {
  return {
    async load() {
      const [row] = await db.select().from(appState).where(eq(appState.key, "zoho_access_token")).limit(1);
      const v = row?.value;
      return v && typeof v.token === "string" && typeof v.expiresAt === "number" ? { token: v.token, expiresAt: v.expiresAt } : null;
    },
    async save(value) {
      await db.insert(appState).values({ key: "zoho_access_token", value }).onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
    },
  };
}

export function memoryTokenStore(): TokenStore {
  let held: { token: string; expiresAt: number } | null = null;
  return { load: async () => held, save: async (v) => void (held = v) };
}

export class ZohoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
  }
}

const tokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().optional(), error: z.string().optional() });
const envelope = z.object({ code: z.number().optional(), message: z.string().optional() }).passthrough();

/** Refresh the access token this many ms before it expires. */
const EXPIRY_MARGIN_MS = 5 * 60_000;
/** Zoho allows 100 requests a minute per organisation; stay under it. */
const PER_MINUTE = 90;
const MAX_ATTEMPTS = 3;

export interface ZohoClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Zoho Inventory API client. OAuth 2.0: a long-lived refresh token (env) is exchanged for an access token that lasts
 * about an hour. The access token is cached in the database and refreshed shortly before it expires or when Zoho answers
 * 401. Requests are paced under Zoho's per-minute limit, retried on 429 and 5xx, and counted so a daily budget can be kept.
 */
export class ZohoClient {
  calls = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private window: number[] = [];

  constructor(
    readonly cfg: ZohoConfig,
    private readonly store: TokenStore,
    opts: ZohoClientOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  get apiBase(): string {
    return this.cfg.apiBase ?? `https://www.zohoapis.${this.cfg.dc}/inventory/v1`;
  }

  get accountsBase(): string {
    return this.cfg.accountsBase ?? `https://accounts.zoho.${this.cfg.dc}`;
  }

  async accessToken(forceRefresh = false): Promise<string> {
    const cached = forceRefresh ? null : await this.store.load();
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) return cached.token;

    const body = new URLSearchParams({ refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: "refresh_token" });
    const res = await this.fetchImpl(`${this.accountsBase}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    const json = tokenResponse.safeParse(await res.json().catch(() => ({})));
    if (!res.ok || !json.success || json.data.error) {
      // A still-valid cached token is better than failing: Zoho limits how often tokens can be minted.
      if (cached && cached.expiresAt > this.now()) return cached.token;
      log("error", "zoho token refresh failed", { status: res.status, error: json.success ? json.data.error : "unreadable response" });
      throw new ZohoError(`Zoho token refresh failed${json.success && json.data.error ? `: ${json.data.error}` : ""}. Check the refresh token and data centre.`, res.status || 502);
    }
    const expiresAt = this.now() + (json.data.expires_in ?? 3600) * 1000;
    await this.store.save({ token: json.data.access_token, expiresAt });
    return json.data.access_token;
  }

  private async pace(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.window = this.window.filter((x) => t - x < 60_000);
      if (this.window.length < PER_MINUTE) {
        this.window.push(t);
        return;
      }
      await this.sleep(Math.max(250, 60_000 - (t - (this.window[0] as number))));
    }
  }

  /** One API call. Returns the parsed JSON body; throws ZohoError for HTTP errors and for `code !== 0` answers. */
  async request(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<Record<string, unknown>> {
    let refreshed = false;
    for (let attempt = 1; ; attempt += 1) {
      await this.pace();
      const token = await this.accessToken();
      const url = new URL(`${this.apiBase}${path}`);
      url.searchParams.set("organization_id", this.cfg.orgId);
      for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
      this.calls += 1;
      const res = await this.fetchImpl(url, {
        method,
        headers: { authorization: `Zoho-oauthtoken ${token}`, ...(opts.body === undefined ? {} : { "content-type": "application/json" }) },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
        await this.sleep(Math.min(wait, 30_000));
        continue;
      }
      const json = envelope.safeParse(await res.json().catch(() => ({})));
      const body = (json.success ? json.data : {}) as Record<string, unknown>;
      if (!res.ok || (typeof body.code === "number" && body.code !== 0)) {
        throw new ZohoError(`Zoho ${method} ${path} failed: ${String(body.message ?? res.status)}`, res.status, typeof body.code === "number" ? body.code : undefined);
      }
      return body;
    }
  }

  /** Every page of a list endpoint. `key` is the array name in the response (items, contacts, purchaseorders). */
  async paginate(path: string, key: string, query: Record<string, string | number> = {}, maxPages = 25): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const body = await this.request("GET", path, { query: { ...query, page, per_page: 200 } });
      const rows = body[key];
      if (Array.isArray(rows)) out.push(...(rows as Record<string, unknown>[]));
      const ctx = body.page_context as { has_more_page?: boolean } | undefined;
      if (!ctx?.has_more_page) break;
    }
    return out;
  }
}
