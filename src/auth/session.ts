/**
 * Signed session cookie. Uses Web Crypto so it runs in the proxy (middleware) and in route handlers.
 * Cookie value: `<expiryEpochSeconds>.<hex hmac-sha256(expiry, APP_PASSWORD)>`.
 * Changing APP_PASSWORD invalidates every session.
 */
export const SESSION_COOKIE = "fr_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12;

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

export async function createSessionValue(secret: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const expiry = String(nowSeconds + SESSION_TTL_SECONDS);
  return `${expiry}.${await hmacHex(secret, expiry)}`;
}

export async function verifySessionValue(
  secret: string,
  value: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!value) return false;
  const [expiry, sig, ...rest] = value.split(".");
  if (!expiry || !sig || rest.length > 0 || !/^\d+$/.test(expiry)) return false;
  if (Number(expiry) < nowSeconds) return false;
  return timingSafeEqual(sig, await hmacHex(secret, expiry));
}

export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] !== undefined && timingSafeEqual(match[1], secret);
}
