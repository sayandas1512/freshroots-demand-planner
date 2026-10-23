import { z } from "zod";

export const ZOHO_DATA_CENTRES = ["in", "com", "eu", "com.au", "jp", "ca", "sa", "com.cn"] as const;

export interface ZohoConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
  /** Data centre suffix: `in` for India (zohoapis.in, accounts.zoho.in). */
  dc: (typeof ZOHO_DATA_CENTRES)[number];
  /** Statuses that count as an open PO (lowercase). */
  openStatuses: string[];
  /** Calls the sync may spend in 24 hours. Zoho allows 1,000 (Free) to 10,000 (Premium+) a day; default is the lowest. */
  dailyBudget: number;
  webhookSecret: string | null;
  /** Overrides for tests and sandboxes. Must be https, or http on localhost. */
  apiBase: string | null;
  accountsBase: string | null;
}

const envSchema = z.object({
  ZOHO_CLIENT_ID: z.string().min(1),
  ZOHO_CLIENT_SECRET: z.string().min(1),
  ZOHO_REFRESH_TOKEN: z.string().min(1),
  ZOHO_ORG_ID: z.string().min(1),
  ZOHO_DC: z.enum(ZOHO_DATA_CENTRES).default("in"),
  ZOHO_OPEN_PO_STATUSES: z.string().default("issued,partially_received,open"),
  ZOHO_DAILY_CALL_BUDGET: z.coerce.number().int().min(100).max(100_000).default(1000),
  ZOHO_WEBHOOK_SECRET: z.string().min(16).optional(),
  ZOHO_API_BASE_URL: z.string().url().optional(),
  ZOHO_ACCOUNTS_BASE_URL: z.string().url().optional(),
});

const safeBase = (v: string | undefined): string | null => {
  if (!v) return null;
  const u = new URL(v);
  return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) ? v.replace(/\/$/, "") : null;
};

/** Null when the connector is not configured: the app then keeps using the open-PO CSV upload and the PO CSV export. */
export function zohoConfig(env: NodeJS.ProcessEnv = process.env): ZohoConfig | null {
  const clean: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) clean[k] = v === "" ? undefined : v;
  const parsed = envSchema.safeParse(clean);
  if (!parsed.success) return null;
  const e = parsed.data;
  return {
    clientId: e.ZOHO_CLIENT_ID,
    clientSecret: e.ZOHO_CLIENT_SECRET,
    refreshToken: e.ZOHO_REFRESH_TOKEN,
    orgId: e.ZOHO_ORG_ID,
    dc: e.ZOHO_DC,
    openStatuses: e.ZOHO_OPEN_PO_STATUSES.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    dailyBudget: e.ZOHO_DAILY_CALL_BUDGET,
    webhookSecret: e.ZOHO_WEBHOOK_SECRET ?? null,
    apiBase: safeBase(e.ZOHO_API_BASE_URL),
    accountsBase: safeBase(e.ZOHO_ACCOUNTS_BASE_URL),
  };
}
