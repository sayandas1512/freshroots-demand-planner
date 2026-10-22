import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { can, type Permission, type Role } from "./roles";
import { SESSION_COOKIE, bearerMatches, verifySessionValue } from "./session";

/** Who is doing something. `userId` is null for the secret-based system caller (cron, scripts). */
export interface Actor {
  userId: string | null;
  role: Role;
  system: boolean;
}

const SYSTEM: Actor = { userId: null, role: "admin", system: true };

export async function actorFromHeaders(authorization: string | null, cookieValue: string | undefined): Promise<Actor | null> {
  if (bearerMatches(authorization, process.env.CRON_SECRET)) return SYSTEM;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const session = await verifySessionValue(secret, cookieValue);
  return session ? { userId: session.userId, role: session.role, system: false } : null;
}

export function actorFromRequest(request: Request): Promise<Actor | null> {
  const cookie = /(?:^|;\s*)fr_session=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  return actorFromHeaders(request.headers.get("authorization"), cookie ? decodeURIComponent(cookie) : undefined);
}

/** For server components. */
export async function currentActor(): Promise<Actor | null> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return actorFromHeaders(h.get("authorization"), c.get(SESSION_COOKIE)?.value);
}

/** Route guard: returns the actor, or a 401/403 response to return as is. */
export async function requirePermission(request: Request, permission: Permission): Promise<Actor | NextResponse> {
  const actor = await actorFromRequest(request);
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(actor.role, permission)) return NextResponse.json({ error: `Your role (${actor.role}) cannot do this.` }, { status: 403 });
  return actor;
}

export function isResponse(value: Actor | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
