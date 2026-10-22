import { isRole, type Role } from "./roles";

/**
 * Signed session cookie. Uses Web Crypto so it runs in the proxy and in route handlers.
 * Value: `<userId>.<role>.<expiryEpochSeconds>.<hex hmac-sha256 of the first three parts, keyed by SESSION_SECRET>`.
 * Rotating SESSION_SECRET signs everyone out.
 */
export const SESSION_COOKIE = "fr_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

export interface SessionPayload {
  userId: string;
  role: Role;
}

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i += 1) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function createSessionValue(secret: string, payload: SessionPayload, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const body = `${payload.userId}.${payload.role}.${nowSeconds + SESSION_TTL_SECONDS}`;
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifySessionValue(secret: string, value: string | undefined, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<SessionPayload | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [userId, role, expiry, sig] = parts as [string, string, string, string];
  if (!/^[0-9a-f-]{36}$/.test(userId) || !isRole(role) || !/^\d+$/.test(expiry) || Number(expiry) < nowSeconds) return null;
  return timingSafeEqual(sig, await hmacHex(secret, `${userId}.${role}.${expiry}`)) ? { userId, role } : null;
}

export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] !== undefined && timingSafeEqual(match[1], secret);
}
