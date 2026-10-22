import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, bearerMatches, verifySessionValue } from "@/auth/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const bearerOk = bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (bearerOk) return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  const sessionOk = password ? await verifySessionValue(password, request.cookies.get(SESSION_COOKIE)?.value) : false;
  if (sessionOk) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
