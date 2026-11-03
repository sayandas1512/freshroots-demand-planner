/**
 * The address a run should call to hand itself on to its next step. Vercel's cron calls the deployment's own address,
 * which sits behind Vercel Authentication, so a run started by cron that chained to that address was refused and only
 * moved one step a day (when the resume cron ran). APP_URL is the public address; fall back to the request's own
 * origin where it is not set (local development, the end-to-end servers).
 */
export function publicOrigin(request: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // a malformed APP_URL is ignored rather than breaking every run
    }
  }
  return new URL(request.url).origin;
}
