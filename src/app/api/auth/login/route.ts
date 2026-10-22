import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionValue, timingSafeEqual } from "@/auth/session";
import { clientKey, rateLimit } from "@/lib/ratelimit";

const body = z.object({ password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const limit = rateLimit(`login:${clientKey(request.headers)}`, 10, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const expected = process.env.APP_PASSWORD;
  if (!expected) return NextResponse.json({ error: "APP_PASSWORD is not configured" }, { status: 500 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !timingSafeEqual(parsed.data.password, expected)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionValue(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
