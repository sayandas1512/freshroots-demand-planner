import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, bearerMatches, verifySessionValue } from "@/auth/session";

// The Zoho webhook cannot sign in; it is protected by a shared secret checked inside the route.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/zoho/webhook"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  if (bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.next();

  const secret = process.env.SESSION_SECRET;
  const session = secret ? await verifySessionValue(secret, request.cookies.get(SESSION_COOKIE)?.value) : null;
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
