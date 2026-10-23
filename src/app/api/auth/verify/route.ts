import { NextResponse } from "next/server";
import { z } from "zod";
import { consumeLoginToken } from "@/auth/magic";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionValue } from "@/auth/session";
import { getDb } from "@/db/client";
import { log } from "@/lib/log";
import { clientKey, rateLimit } from "@/lib/ratelimit";

const body = z.object({ token: z.string().min(20).max(80) });

/**
 * Exchange a sign-in token for a session. This is a POST from the verify page, never a GET, so an email scanner that
 * "clicks" the link cannot use it up.
 */
export async function POST(request: Request) {
  const limit = rateLimit(`verify:ip:${clientKey(request.headers)}`, 30, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });
  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET is not configured" }, { status: 500 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  const user = parsed.success ? await consumeLoginToken(await getDb(), parsed.data.token) : null;
  if (!user) return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 401 });

  log("info", "signed in", { userId: user.id, role: user.role });
  const res = NextResponse.json({ ok: true, name: user.name, role: user.role });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(secret, { userId: user.id, role: user.role }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
