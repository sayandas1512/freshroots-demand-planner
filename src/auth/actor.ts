import { cookies, headers } from "next/headers";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { getGuestUser, openAccessEnabled } from "./guest";
import { NextResponse } from "next/server";
import { can, type Permission, type Role } from "./roles";
import { SESSION_COOKIE, bearerMatches, verifySessionValue } from "./session";

/** Who is doing something. `userId` is null for the secret-based system caller (cron, scripts). */
export interface Actor {
  userId: string | null;
  role: Role;
  system: boolean;
  /** True for an open-access visitor who did not sign in. */
  guest?: boolean;
}

const SYSTEM: Actor = { userId: null, role: "admin", system: true };

export interface ActorDeps {
  env?: NodeJS.ProcessEnv;
  db?: Db;
}

/** Order: the cron secret, then a signed-in session, then (only when OPEN_ACCESS=1) a guest administrator. */
export async function actorFromHeaders(authorization: string | null, cookieValue: string | undefined, deps: ActorDeps = {}): Promise<Actor | null> {
  const env = deps.env ?? process.env;
  if (bearerMatches(authorization, env.CRON_SECRET)) return SYSTEM;
  const secret = env.SESSION_SECRET;
  const session = secret ? await verifySessionValue(secret, cookieValue) : null;
  if (session) return { userId: session.userId, role: session.role, system: false };
  if (openAccessEnabled(env)) {
    const guest = await getGuestUser(deps.db ?? (await getDb()));
    return { userId: guest.id, role: "admin", system: false, guest: true };
  }
  return null;
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
