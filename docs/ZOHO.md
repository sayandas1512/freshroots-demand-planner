# Zoho Inventory connector

Two jobs, both optional. Without the environment variables below the app behaves exactly as before: open POs come from the CSV upload and approved lines export as a CSV.

1. **Read:** open purchase orders are pulled from Zoho so the open PO quantity beside stock is always current.
2. **Write:** approved lines can be created in Zoho as **draft** purchase orders, one per vendor.

Nothing here can place an order. The connector never calls Zoho's issue, approve or submit endpoints (a test checks every call it makes), so a human still reviews and issues each draft in Zoho.

## How OAuth keeps it connected

Zoho uses OAuth 2.0 with a long-lived **refresh token** and a short-lived **access token** (valid about one hour). The app stores only the refresh token (in env). It exchanges that for an access token when it needs one, caches the access token in the database so every serverless invocation shares it, refreshes it five minutes before it expires, and refreshes once and retries if Zoho answers 401. If Zoho refuses a refresh while a cached token is still valid, the cached token is used. Nobody has to log in again unless the refresh token is revoked.

## Keeping the site up to date

Zoho allows about 100 calls a minute per organisation and 1,000 to 10,000 calls a day depending on the plan, so the data is **polled, not streamed**, and the sync is incremental:

- every 30 minutes (`/api/cron/zoho-sync`),
- at the start of every run if the last good sync is older than 30 minutes (a failed sync never stops a run: it adds a note and uses the last synced POs),
- on demand (**Sync now** and **Full re-read** on the Zoho page),
- optionally when Zoho tells us something changed (a webhook, below).

Zoho's list of purchase orders has no line items, so quantities need one call per open PO. Items and vendors are re-read at most every 6 hours, and an open PO's detail only when it is new, its status or total changed, it is 6 hours old, or a re-read is forced. A daily call budget (`ZOHO_DAILY_CALL_BUDGET`, default 1,000, the lowest plan) is enforced: when it runs short the sync keeps the last known quantities and says so.

## Set up (once)

1. In Zoho's API console for your data centre (India: `api-console.zoho.in`) create a **Self Client**.
2. Generate a grant code with these scopes (it expires within minutes):
   `ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.purchaseorders.READ,ZohoInventory.purchaseorders.CREATE`
   Leave out the CREATE scope if you only want the read side.
3. Exchange it for the refresh token:
   `ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_DC=in npm run zoho:token -- --code <the code>`
4. Set these in Vercel (Production), then redeploy:

| Variable | Value |
|---|---|
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | From the self client |
| `ZOHO_REFRESH_TOKEN` | Printed by the script. Treat it like a password |
| `ZOHO_ORG_ID` | The Zoho Inventory organisation id (Settings > Organization profile) |
| `ZOHO_DC` | `in` for India (default). Others: `com`, `eu`, `com.au`, `jp`, `ca`, `sa`, `com.cn` |
| `ZOHO_OPEN_PO_STATUSES` | Default `issued,partially_received,open`. Statuses that count as an open PO |
| `ZOHO_DAILY_CALL_BUDGET` | Default 1000 |
| `ZOHO_WEBHOOK_SECRET` | Optional, 16+ characters, enables the webhook |

5. Open **Zoho** in the app, press **Sync now**, then:
   - **Vendor mapping:** choose the Zoho vendor for each `Distributor_ID`. This is where it gets settled whether that ID is the supplier or the selling distributor.
   - **Item matching:** a Zoho item matches a SKU when its Zoho SKU equals our `SKU_ID`. Match any leftovers by hand. Unmatched items on open POs are listed and their quantity is not counted.
6. To create drafts, the **sponsor or an admin** turns on "Allow creating draft purchase orders in Zoho" in Settings.

When the connector is on, the open-PO CSV upload is switched off (the Data page says so) so the two sources cannot double count. Zoho rows and CSV rows are kept separate.

## Creating draft POs

From **Export preview**, the planner (or admin) sees one planned draft per vendor with Zoho's purchase rate for each item, and anything that cannot be sent with the reason (no vendor mapping, no Zoho item, no purchase rate). A vendor with any blocked line is held back whole, never split. The gates are the same as the CSV export: the system must be live, the kill switch off, the sponsor's switch on, and the planner or admin role. Every creation is logged with the user.

**Never twice:** each draft has a reference `FR-<run>-<vendor>` recorded in a ledger before the call. Repeating the push skips what is created. If a request is lost mid-flight the draft is marked **unconfirmed**: the app looks for the reference in Zoho before doing anything else, and if it cannot tell it stops and asks a person to check Zoho and confirm a retry on the Zoho page.

## Optional webhook

In Zoho (Settings > Automation > Workflow rules) a rule on purchase orders can call a webhook: `POST https://<app>/api/zoho/webhook` with header `x-zoho-webhook-secret: <ZOHO_WEBHOOK_SECRET>`. It only triggers a normal full sync (at most once a minute). The payload is ignored.

## If something is wrong

| Symptom | What to do |
|---|---|
| Health shows Zoho "last sync failed" | Open the Zoho page: the error is shown. "Token refresh failed": the refresh token was revoked or the data centre is wrong, re-run the setup. "Daily call budget used": wait, or raise the budget if the plan allows |
| Open PO quantity looks low | Zoho page > Item matching: unmatched items are not counted |
| A draft is "unconfirmed" | Look for the `FR-...` number in Zoho. If it is there, press Push again (it is found and recorded). If not, press "Not in Zoho: allow retry" |
| Calls fail with 429 | The client backs off and retries. Persistent 429s mean the day's quota is used |

## What is not verified

Built from Zoho's published API documentation and tested against a stand-in Zoho that follows it, not against a live Zoho organisation. Confirm in a **sandbox organisation** before go-live: the exact open statuses in your account (`ZOHO_OPEN_PO_STATUSES`), that a JSON request body is accepted when creating a purchase order, how a custom `purchaseorder_number` behaves if the organisation uses automatic numbering (the app also sets `reference_number`, and finds an earlier draft by number only), and the call quotas on your plan.
