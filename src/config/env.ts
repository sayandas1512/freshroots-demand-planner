import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().optional(),
  /** Folder for the embedded dev database used when DATABASE_URL is empty. */
  PGLITE_DIR: z.string().default(".data/pglite"),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Which provider writes the wording. Default: Gemini when GEMINI_API_KEY is set, else Anthropic when ANTHROPIC_API_KEY is set. */
  LLM_PROVIDER: z.enum(["gemini", "anthropic"]).optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** Defaults per provider (see src/ai/index.ts). */
  LLM_MODEL: z.string().min(1).optional(),
  LLM_PRICE_IN_PER_MTOK: z.coerce.number().nonnegative().default(1),
  LLM_PRICE_OUT_PER_MTOK: z.coerce.number().nonnegative().default(5),
  CRON_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL: z.string().optional(),
  ALERT_FROM: z.string().optional(),
  /** Public address of the app, used in sign-in links. Falls back to the request address. */
  APP_URL: z.string().url().optional(),
  /** Keys the signed session cookie. Rotate it to sign everyone out. */
  SESSION_SECRET: z.string().min(16).optional(),
  /** JSON array of { email, name, role } used only by `npm run seed:users`. */
  SEED_USERS: z.string().optional(),
  TZ: z.string().default("Asia/Kolkata"),
});

export type Env = z.infer<typeof schema>;

function blankToUndefined(raw: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v === "" ? undefined : v;
  return out;
}

/** Server-side only. Never import from a client component. */
export function getEnv(): Env {
  return schema.parse(blankToUndefined(process.env));
}
