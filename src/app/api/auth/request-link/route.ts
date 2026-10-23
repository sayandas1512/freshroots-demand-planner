import { NextResponse } from "next/server";
import { z } from "zod";
import { devLinksAllowed, issueLoginToken, loginUrl } from "@/auth/magic";
import { getDb } from "@/db/client";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { clientKey, rateLimit } from "@/lib/ratelimit";

const body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
const GENERIC = { ok: true, message: "If that email belongs to a Freshroots account, a sign-in link is on its way. It works once and expires in 15 minutes." };

/**
 * Ask for a sign-in link. The answer is the same whether or not the email is registered, so the form cannot be used to
 * find out who has an account. Rate limited per address and per email.
 */
export async function POST(request: Request) {
  const ip = rateLimit(`link:ip:${clientKey(request.headers)}`, 20, 60_000);
  if (!ip.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": String(ip.retryAfterSeconds) } });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const dev = devLinksAllowed();
  const perEmail = rateLimit(`link:email:${parsed.data.email}`, dev ? 200 : 5, 10 * 60_000);
  if (!perEmail.ok) return NextResponse.json(GENERIC); // quietly stop: no new email, no signal

  const issued = await issueLoginToken(await getDb(), parsed.data.email);
  if (!issued) return NextResponse.json(GENERIC);

  const origin = process.env.APP_URL ?? new URL(request.url).origin;
  const link = loginUrl(origin, issued.token);
  if (dev) return NextResponse.json({ ...GENERIC, devLink: link });

  const sent = await sendEmail([issued.user.email], {
    subject: "Your Freshroots sign-in link",
    text: `Hello ${issued.user.name},\n\nUse this link to sign in to the Freshroots demand planner:\n\n${link}\n\nIt works once and expires in 15 minutes. If you did not ask for it, ignore this email: nothing happens unless the link is opened.\n`,
  });
  if (!sent) log("error", "sign-in link could not be emailed", { userId: issued.user.id });
  return NextResponse.json(GENERIC);
}
