import "./env";
import { issueLoginToken, loginUrl } from "../src/auth/magic";
import { getDb } from "../src/db/client";

/**
 * Emergency sign-in when email is down: prints a one-time link (valid 15 minutes) for a registered user.
 * Needs database access, so only IT can run it.  npm run login-link -- --email raghav@freshroots.example --url https://<app>
 */
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = arg("email");
const origin = arg("url") ?? process.env.APP_URL ?? "http://localhost:3000";
if (!email) {
  console.error("Usage: npm run login-link -- --email <registered email> [--url https://app.example.com]");
  process.exit(1);
}
const issued = await issueLoginToken(await getDb(), email);
if (!issued) {
  console.error("No active user with that email.");
  process.exit(1);
}
console.log(`One-time link for ${issued.user.name} (works once, expires in 15 minutes):\n${loginUrl(origin, issued.token)}`);
process.exit(0);
