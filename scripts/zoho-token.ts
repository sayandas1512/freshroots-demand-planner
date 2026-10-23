import "./env";

/**
 * One-time setup: turn a Zoho "self client" grant code into the long-lived refresh token.
 *
 *   1. In https://api-console.zoho.in (use your data centre's console) create a Self Client.
 *   2. Generate a code with the scopes below (it expires in a few minutes).
 *   3. ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_DC=in npm run zoho:token -- --code <the code>
 *   4. Put the printed refresh token in ZOHO_REFRESH_TOKEN (Vercel env). Never commit it.
 *
 * Scopes: ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.purchaseorders.READ,ZohoInventory.purchaseorders.CREATE
 */
const i = process.argv.indexOf("--code");
const code = i >= 0 ? process.argv[i + 1] : undefined;
const dc = process.env.ZOHO_DC ?? "in";
const clientId = process.env.ZOHO_CLIENT_ID;
const clientSecret = process.env.ZOHO_CLIENT_SECRET;
if (!code || !clientId || !clientSecret) {
  console.error("Usage: ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... [ZOHO_DC=in] npm run zoho:token -- --code <grant code>");
  process.exit(1);
}

const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code }),
});
const body = (await res.json()) as { refresh_token?: string; error?: string };
if (!res.ok || !body.refresh_token) {
  console.error(`Zoho refused the code${body.error ? `: ${body.error}` : ""}. Codes expire quickly and work once: generate a new one.`);
  process.exit(1);
}
console.log("Refresh token (store it as ZOHO_REFRESH_TOKEN, do not share it):");
console.log(body.refresh_token);
process.exit(0);
