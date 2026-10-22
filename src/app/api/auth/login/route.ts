import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { dummyVerify, verifyPassword } from "@/auth/password";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionValue } from "@/auth/session";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { clientKey, rateLimit } from "@/lib/ratelimit";

const body = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const limit = rateLimit(`login:${clientKey(request.headers)}`, 10, 60_000);
  if (!limit.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } });

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: "SESSION_SECRET is not configured" }, { status: 500 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

  const [user] = await (await getDb()).select().from(users).where(eq(users.email, parsed.data.email)).limit(1);
  const ok = user && user.active ? await verifyPassword(parsed.data.password, user.passwordHash) : (await dummyVerify(parsed.data.password), false);
  if (!user || !ok) return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });

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
