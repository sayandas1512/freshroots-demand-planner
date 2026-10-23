import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginTokens, users } from "@/db/schema";

/**
 * Passwordless sign-in. A person asks for a link by email; the link carries a one-time token that is valid for
 * 15 minutes. Only a SHA-256 hash of the token is stored, so a database leak cannot be used to sign in.
 */
export const LOGIN_TOKEN_TTL_MS = 15 * 60_000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export interface IssuedLink {
  token: string;
  user: { id: string; name: string; email: string };
}

/** Create a token for an active user. Returns null for an unknown or deactivated email (the caller must not reveal which). */
export async function issueLoginToken(db: Db, email: string, now: Date = new Date()): Promise<IssuedLink | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!user || !user.active) return null;
  await db.delete(loginTokens).where(lt(loginTokens.expiresAt, new Date(now.getTime() - 24 * 3_600_000)));
  const token = randomBytes(32).toString("base64url");
  await db.insert(loginTokens).values({ userId: user.id, tokenHash: hash(token), expiresAt: new Date(now.getTime() + LOGIN_TOKEN_TTL_MS), createdAt: now });
  return { token, user: { id: user.id, name: user.name, email: user.email } };
}

/** Use a token once. Atomic, so a second use (or a race) fails. Returns the user to sign in, or null. */
export async function consumeLoginToken(db: Db, token: string, now: Date = new Date()): Promise<{ id: string; role: (typeof users.$inferSelect)["role"]; name: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const [used] = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(and(eq(loginTokens.tokenHash, hash(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now)))
    .returning({ userId: loginTokens.userId });
  if (!used) return null;
  const [user] = await db.select().from(users).where(eq(users.id, used.userId)).limit(1);
  return user && user.active ? { id: user.id, role: user.role, name: user.name } : null;
}

export function loginUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/login/verify?token=${encodeURIComponent(token)}`;
}

/** Links shown on screen instead of emailed: only for local development and tests, never on Vercel production. */
export function devLinksAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.VERCEL_ENV === "production") return false;
  return env.NODE_ENV !== "production" || env.AUTH_DEV_LINKS === "1";
}
