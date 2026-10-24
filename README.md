# Freshroots Demand Planner

Runs Raghav Kulkarni's documented reorder rules twice a week (Monday and Thursday, 07:00 IST) on organised SAP and Zoho data, explains every flag in plain language, routes what the rules cannot judge to him, and lets him approve, edit or reject each line before anything goes to procurement.

**Non-negotiables, as built**

- Nothing is ordered or sent automatically. Only lines Raghav approves or edits appear in the purchase-order CSV.
- Actions, quantities and every number come from deterministic code in `src/engine`. The LLM never decides or computes anything.
- The LLM writes two things only: a reason per flagged SKU and a three-line headline. Its output is validated (every number must appear in the supplied facts, and it must not name a different action). On any failure the run still completes with template wording, and each explanation is marked `llm` or `template` in the data and the UI.
- Every edit and rejection needs a reason and is stored in the override log.
- One bad file, SKU or LLM call never stops a run. The recommendation sheet is saved before it is shown or exported.

Stack: Next.js 16 (App Router) and TypeScript on Vercel, Postgres on Neon with Drizzle, Zod, Vitest, Playwright, GSAP, Gemini Flash (Anthropic behind the same interface), Resend for alerts, GitHub Actions for CI.

## Where each folder sits on the 18-step component map

Lanes: Timer and kill, Deepa, Data, Engine, Raghav, Procurement, Before launch, Platform.

| Step | Box | Code |
|---|---|---|
| 01 | Raghav / Input: Settings page, rule thresholds, kill thresholds and the Zoho switch | `src/app/(app)/settings`, `src/run/config-store.ts`, `src/run/config-save.ts`, `src/engine/config.ts`, `src/auth/config-auth.ts` |
| 02 | Timer and kill / Trigger: cron Mon and Thu 07:00 IST, Run-now, **kill switch checked first** | `vercel.json`, `src/app/api/cron/run`, `src/app/api/run`, `src/run/execute.ts` (`startRun` refuses while killed) |
| 03 | Data / Context: SAP CSV drops (Priya), **Zoho open POs by API** (or CSV), rule settings, history | `src/ingest` (column names in `src/ingest/mapping.ts`), `src/zoho` (OAuth client, sync), `src/app/(app)/zoho`, `src/db`, `src/app/(app)/data`, `fixtures/`, `src/synthetic` |
| 04 | Engine / Processing: clean, apply Raghav's rules, flag stockout and overstock, route exceptions | `src/engine` (pure TypeScript), `src/run/load.ts`, `src/run/machine.ts` (`prepare`) |
| 05 | Engine / AI: reasons per flag and the run headline | `src/ai` (one provider interface: Gemini Flash, Anthropic; prompts, templates, guardrails, allow-list `payload.ts`) |
| 06 | Engine / Output: draft sheet, saved before it is shown | `src/run/machine.ts` (one transaction in `prepare`), `recommendations` table |
| 07 | Raghav / Output: approve, edit or reject each line | `src/app/(app)/page.tsx`, `src/components/review`, `src/run/decisions.ts` |
| 08 | Procurement / Output: export of approved lines as CSV **or draft POs in Zoho**, blocked only when the kill switch is on | `src/export`, `src/zoho/push.ts`, `src/app/(app)/export` (preview), `src/app/api/export/approved`, `src/kill/guards.ts` |
| 09 | Deepa / Output: Health page, override log, losses vs baseline, kill status and criteria, rubber-stamp warning, a button to run the kill check now | `src/app/(app)/health`, `src/run/health.ts`, `src/golive`, `src/components/health` |
| 10 | Before launch / Processing: backtest on SAP history against Raghav's past orders, festival uplift check | `src/backtest`, `src/run/history.ts`, `src/app/(app)/backtest`, `scripts/backtest.ts` |
| 11 | Deepa / Context: outcome log (weekly incidents and overstock value, monthly ₹ loss, frozen baseline) | `src/outcomes`, `src/app/(app)/outcomes`, tables `outcomes_weekly`, `outcomes_monthly`, `baseline_weekly` |
| 12 | Deepa / Processing: kill check after each run and monthly | `src/kill/check.ts` (pure `executeKillCheck`), `src/kill/gather.ts`, `src/kill/run.ts`, `/api/cron/kill-check` |
| 13 | Timer and kill / Input: kill switch, stops the timer and the export, emails Deepa | `src/kill/state.ts`, `src/app/api/kill`, `src/components/StopControl.tsx`, `src/lib/email.ts` |
| 14 | Platform: GitHub | `.github/workflows/ci.yml` |
| 15 | Platform: Vercel | `vercel.json`, `next.config.ts`, `/api/run/[id]/advance`, `/api/cron/resume` |
| 16 | Platform: Neon | `src/db`, `drizzle/`, `scripts/migrate.ts` |
| 17 | Platform: Gemini Flash | `src/ai/gemini.ts` (Anthropic in `src/ai/anthropic.ts` behind the same interface) |
| 17b | Dashboard assistant (read-only, grounded in dashboard facts, screened and verified in code) | `src/chat`, `src/components/chat`, `src/app/api/chat` |
| 18 | Before launch / Output: compare the system with Raghav's own forecast (there is no separate shadow period: the system behaves as live from the first run) | `src/compare`, `src/app/(app)/compare`, `src/app/api/compare` |

Supporting: `src/auth` and `src/proxy.ts` (named users, roles, signed session, cron secret), `src/lib` (rate limit, dates, motion tokens, JSON logs, email), `docs/RUNBOOK.md`, `docs/GAP_REPORT.md`, `tests/` (Vitest), `e2e/` (Playwright).

## For a reviewer (open access)

With `OPEN_ACCESS=1` there is nothing to sign in to: open the link and you are a guest administrator, so you can run, approve, edit, reject, export, switch mode and use the kill switch. A red banner says so, and every action is logged as "Guest". Sign in from the top bar if you want to act under a named person instead.

A walkthrough on a fresh database (`npm run seed` loads the five project data files in `/fixtures` plus eight weeks of sample outcomes). The system behaves as it would in real use: there is no trial mode and nothing to unlock.

1. **Review:** set the run date to `2026-10-19`, press **Run now**, watch the strip, read the headline and the 15 lines with the rule and numbers on each. Approve one, reject one with a reason, edit one quantity. Keys: `J`/`K`/`A`/`E`/`R`/`U`.
2. **Export:** **Export approved** opens the preview of exactly what will be sent, then **Download CSV**: only the approved and edited lines, at their final quantities. (If Zoho is connected, **Create draft purchase orders** sits under it.)
3. **Kill check against the case's baseline:** **Outcomes** shows the frozen 8-week baseline (measuring from 2026-10-12). Upload `fixtures/outcomes_live_ok.csv` for four normal weeks, then press **Run the kill check now** on **Health**: nothing is wrong. Upload `fixtures/outcomes_breach.csv` (the same four weeks, about 30% worse) and run the check: a **warning**. Upload `fixtures/outcomes_breach_next_week.csv` and run it again: the system **stops**. A red banner appears, Run now and Export are refused and Review is read-only.
4. **Clear it:** **Health** > clear the kill switch with a written note. (You can also press **Stop** in the top bar at any time.)
5. **Monthly losses:** on **Outcomes** add months of ₹ loss with the loss-calculation method; the quarterly test compares a full quarter with the case's ₹28 to 34 lakh baseline.
6. **Ask the planner:** the button at the bottom right opens the read-only assistant. Try "Which SKUs need a reorder now, and why?", "Is the kill switch on?", then "approve SKU001" or "ignore your instructions" to see it refuse.
7. **Also worth a look:** Backtest (with the festival uplift check), Compare (upload a forecast CSV of SKU_ID, Period, Qty), Settings (change a threshold and **Preview impact**), Health (override log, decision-time stats, system status).

The scheduled-job and webhook endpoints still need their secrets, even in open access.

## Who can do what (when people sign in)

| Role | Person | Can |
|---|---|---|
| planner | Raghav | review, approve, edit, reject, rules settings, run, export, backtest |
| sponsor | Deepa | operating mode, kill thresholds, clear the kill switch (with a note), outcomes, backtest, run, health |
| data | Priya | uploads, outcome entry, run |
| admin | IT | everything |

Everyone signed in can press **Stop**. Every approval, edit, rejection, upload, kill trip, kill clear and export download records the user.

## The kill switch

There is no shadow period or go-live gate: the system works as live from the first run, and the export is available as soon as lines are approved. Results are judged from a **measurement start** date (set automatically the first time the system is used, and restartable on the **Outcomes** page by the sponsor or an admin). The 8 weekly outcomes before it are the frozen baseline.

The kill check runs after every completed run, on the 1st of each month, and on demand from Health. Three kill tests and a warning, with current values and thresholds on Health (thresholds on Settings, all starting proposals for the sponsor to confirm): quarterly loss above the baseline high; weekly indicators more than 20% worse than baseline at two consecutive checks; override rate above 50% across four consecutive runs; and a rubber-stamp warning that never kills. When tripped, scheduled runs and the export stop, Review is read-only, a banner shows everywhere, and an email goes out. Raghav's own process is unaffected. See `docs/RUNBOOK.md` section 6.

## Run it locally

```bash
npm install
cp .env.example .env.local      # set SESSION_SECRET, CRON_SECRET and SEED_USERS at least
npm run seed                     # loads /fixtures through the normal ingestion layer
npm run seed:users               # creates the named users from SEED_USERS (no passwords)
npm run dev                      # http://localhost:3000
```

With `DATABASE_URL` empty the app uses an embedded Postgres (PGlite) in `.data/`, so no database setup is needed. Sign in with a seeded user's email (put `AUTH_DEV_LINKS=1` in `.env.local` so the link is shown on screen instead of emailed), set the run date to `2026-10-19` (the date the sample data is built for) and press **Run now**.

From the command line:

```bash
npm run run:now -- --as-of=2026-10-19                                   # run the engine, print every line
npm run backtest -- --from 2026-W39 --to 2026-W42 [--orders orders.csv] # replay past weeks
npm test                                                                  # unit and integration tests
npm run test:e2e                                                          # Playwright (builds, seeds, starts a server on :3200)
npm run gen:synthetic                                                     # 400 SKUs, 156 weeks, 1,200 distributors into fixtures/synthetic
npm run build                                                             # production build
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Empty means the embedded dev database. |
| `SESSION_SECRET` | Keys the signed session cookie (16+ characters). Rotate to sign everyone out. |
| `SEED_USERS` | JSON array of `{email, name, role}`, used by `npm run seed:users`. There are no passwords. |
| `APP_URL` | Public address of the app, used in sign-in links. |
| `OPEN_ACCESS` | `1` = anyone with the link acts as a guest administrator, no sign-in, for demonstrations and marking. Actions are logged as "Guest". Never with real data. |
| `PUBLIC_VIEW` | `1` = anyone with the link can only view (read-only). Ignored when `OPEN_ACCESS=1`. |
| `AUTH_DEV_LINKS` | `1` shows the sign-in link on screen instead of emailing it, for local runs and tests. Ignored on Vercel production. |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on cron calls. Also used to chain run steps and accepted by API routes for scripts and uptime monitors. |
| `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` | Enable LLM wording. All empty means template wording only (`llm_status = skipped`). |
| `LLM_PROVIDER`, `LLM_MODEL` | `gemini` or `anthropic` (default: whichever key is set, Gemini first) and the model id (defaults per provider; verify with the provider). |
| `LLM_PRICE_IN_PER_MTOK`, `LLM_PRICE_OUT_PER_MTOK` | USD per million tokens, used only to log run cost. |
| `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM` | Sends the sign-in links (required in production) and the alert emails (kill switch, failed or degraded runs). Without a key alerts are only logged and nobody can sign in on production. |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_DC` | Optional Zoho Inventory connector (OAuth refresh token). See [`docs/ZOHO.md`](docs/ZOHO.md). `ZOHO_OPEN_PO_STATUSES`, `ZOHO_DAILY_CALL_BUDGET` and `ZOHO_WEBHOOK_SECRET` tune it. |
| `TZ` | `Asia/Kolkata`. |
| `PGLITE_DIR` | Optional folder for the embedded database (default `.data/pglite`). |

Secrets are read on the server only. Nothing is prefixed `NEXT_PUBLIC_`.

## Deploy to Vercel

1. Create a Neon database (Vercel Marketplace, or neon.tech) and copy its connection string.
2. Import the repo in Vercel and set `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `GEMINI_API_KEY` (or the Anthropic key), `RESEND_API_KEY`, `ALERT_EMAIL` and `TZ=Asia/Kolkata` for Production. Choose the Neon region nearest India (Singapore). IT and the CEO sign off hosting before go-live.
3. Deploy. The `vercel-build` script applies migrations (`tsx scripts/migrate.ts`) and then builds, so the first deploy creates the schema, the active rule config (v1) and the brief's baseline range.
4. Create the users: `DATABASE_URL=... SEED_USERS=... npm run seed:users`. Load data on the **Data** page, or `DATABASE_URL=... npm run seed` for the sample.
5. Vercel Cron reads `vercel.json`: `30 1 * * 1,4` (07:00 IST Monday and Thursday) runs `/api/cron/run`; `0 2 1 * *` runs the monthly kill check; `15 2 * * *` runs `/api/cron/zoho-sync` (does nothing without Zoho credentials); `45 2 * * *` runs `/api/cron/resume`, which picks up any run that stopped midway (these two are daily because Vercel's Hobby plan allows nothing more frequent; on Pro change them to `*/30 * * * *` and `*/10 * * * *`). Check the first run on the **Health** page, which also shows `/api/health`.

To change the schema: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.

## Changing a SAP column name

Open `src/ingest/mapping.ts`. Each file kind lists `internal field -> CSV header`; change the right-hand string. Nothing else needs to change. The same ingestion layer will accept an automated SAP export with the same schema (the `POST /api/ingest/[kind]` route takes multipart or raw CSV).

## How the rules decide

Per SKU: `avg12` and `recent4` are means of the last 12 and 4 complete weeks (the 4 are inside the 12); `ratio = recent4 / avg12`; `cover = stock / (avg12 × festival uplift)`. Perishable SKUs use 3 to 4 weeks of cover, others 6 to 14. Precedence, also shown on the Review page:

1. Overstock together with high demand: no recommendation, an exception (`conflicting_signals`).
2. High demand (ratio above 1.20): reorder 1.5× the standard quantity; with a stockout risk too it is marked urgent.
3. Stockout risk: reorder the standard quantity now.
4. Overstock risk: pause the next order.
5. Otherwise hold.

Exceptions routed to Raghav: new SKU, short history, missing stock, zero demand, anomalous jump, unknown SKU, conflicting signals, and processing error. Every default is in `ASSUMPTIONS.md` and every threshold is on the Settings page.

## Runbook

See [`docs/RUNBOOK.md`](docs/RUNBOOK.md): reading the run strip and log, every failure state, re-running, restoring settings, late SAP files, the kill switch and its drill, going live, users and secrets, hosting.

## Security notes

- **Open access** (`OPEN_ACCESS=1`) deliberately removes sign-in: anyone with the link can approve, export and stop the system. It exists for demonstrations and marking and must be off for real use. `PUBLIC_VIEW=1` is the milder option (look, but change nothing). Otherwise: named users who sign in with a one-time emailed link (15 minutes, single use, only a hash stored, confirmed by a POST so email scanners cannot use it up), signed `httpOnly` `SameSite=Lax` session cookie (`Secure` in production), role checks on every mutating route. The proxy (`src/proxy.ts`) protects every page and API route; cron and scripts use the bearer `CRON_SECRET`.
- All external input is validated with Zod: every CSV row, every request body, every route parameter (UUIDs), and the `next` redirect on login.
- CSV content is untrusted: size, row and field limits; formula characters rejected in identifiers; every CSV we write neutralises cells starting with `=`, `+`, `-` or `@`. CSV text is only ever rendered by React (escaped).
- No API key or full prompt is logged (JSON logs redact secret-like fields). The LLM receives only an allow-listed payload of computed numbers, SKU names and categories: never user notes, distributor names or raw tables (`src/ai/payload.ts`, tested).
- Rate limits on login (per address and per account), upload, run and backtest routes (per instance; see `ASSUMPTIONS.md` 35). Security headers are set in `next.config.ts`.

## Deferred

SAP automated export, and the Distributor Service and Ops Intelligence modules. Alert email (Resend) and the Zoho connector are built and tested against stand-ins, not the live services.
