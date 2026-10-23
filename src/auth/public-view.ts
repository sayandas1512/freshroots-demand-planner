/**
 * Public view: with PUBLIC_VIEW=1, anyone with the link can open the pages and watch a run, read-only.
 * Everything that changes data still needs a signed-in user: every mutating route checks the session itself, and this
 * allow-list is the only thing the proxy lets through without one.
 */
export function publicViewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUBLIC_VIEW === "1";
}

const RUN_EVENTS = /^\/api\/run\/[0-9a-f-]{36}\/events$/;

/** True when an unauthenticated request may pass: a GET of a page, the run progress stream, or the health check. */
export function isPublicViewRequest(method: string, pathname: string, enabled: boolean): boolean {
  if (!enabled || (method !== "GET" && method !== "HEAD")) return false;
  if (!pathname.startsWith("/api/")) return true;
  return RUN_EVENTS.test(pathname) || pathname === "/api/health";
}
