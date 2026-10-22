# Freshroots Demand Planner

Runs Raghav Kulkarni's documented reorder rules twice a week (Monday and Thursday, 07:00 IST) on organised SAP and Zoho data, explains every flag in plain language, routes what the rules cannot judge to him, and lets him approve, edit or reject each line before anything goes to procurement.

**Non-negotiables, as built**

- Nothing is ordered or sent automatically. Only lines Raghav approves or edits appear in the purchase-order CSV.
- Actions, quantities and every number come from deterministic code in `src/engine`. The LLM never decides or computes anything.
- The LLM writes two things only: a reason per flagged SKU and a three-line headline. Its output is validated (every number must appear in the supplied facts, and it must not name a different action). On any failure the run still completes with template wording, and each explanation is marked `llm` or `template` in the data and the UI.
- Every edit and rejection needs a reason and is stored in the override log.
- One bad file, SKU or LLM call never stops a run. The recommendation sheet is saved before it is shown or exported.

Stack: Next.js 16 (App Router) and TypeScript on Vercel, Postgres on Neon with Drizzle, Zod, Vitest, Playwright, GSAP.

## Where each folder sits on the component map

| Map step | Box | Code |
|---|---|---|
| 01 | Raghav / Input: Settings page edits the rule config | `src/app/(app)/settings`, `src/run/config-store.ts`, `src/engine/config.ts` |
| 02 | Timer / Trigger: cron Mon and Thu 07:00 IST, plus "Run now" | `vercel.json`, `src/app/api/cron/run`, `src/app/api/run` |
| 03 | Data / Context: CSV drops, rule config, SKU master, festival calendar, history | `src/ingest` (the file-to-column mapping is in `src/ingest/mapping.ts`), `src/db`, `src/app/(app)/data`, `fixtures/` |
| 04 | Engine / Processing: validate, join, apply rules in order, route exceptions | `src/engine` (pure TypeScript), `src/run/load.ts`, `src/run/execute.ts` |
| 05 | Engine / AI: reasons for flags, run headline | `src/ai` (one provider interface, prompts, templates, guardrails) |
| 06 | Engine / Output: draft recommendation sheet, saved before it is shown | `src/run/execute.ts` (single transaction), `recommendations` table |
| 07 | Raghav / Output: approve, edit or reject each line | `src/app/(app)/page.tsx`, `src/components/review`, `src/run/decisions.ts` |
| 08 | Procurement / Output: approved lines as a PO CSV | `src/export` (column mapping in `src/export/mapping.ts`), `src/app/api/export/approved` |
| 09 | Deepa / Output: health, override log, baseline | `src/app/(app)/health`, `src/run/health.ts`, `src/components/health` |
| 10 | Deepa / Processing: backtest before launch | `src/backtest`, `src/app/(app)/backtest`, `scripts/backtest.ts` |

Supporting: `src/auth` and `src/proxy.ts` (shared-password session, cron secret), `src/lib` (rate limit, dates, motion tokens), `tests/` (Vitest), `e2e/` (Playwright), `drizzle/` (migrations).

## Run it locally

```bash
npm install
cp .env.example .env.local      # set APP_PASSWORD and CRON_SECRET at least
npm run seed                     # loads /fixtures through the normal ingestion layer
npm run dev                      # http://localhost:3000
```

With `DATABASE_URL` empty the app uses an embedded Postgres (PGlite) in `.data/`, so no database setup is needed. Sign in with `APP_PASSWORD`, set the run date to `2026-10-19` (the date the sample data is built for) and press **Run now**.

From the command line:

```bash
npm run run:now -- --as-of=2026-10-19                                   # run the engine, print every line
npm run backtest -- --from 2026-W39 --to 2026-W42 [--orders orders.csv] # replay past weeks
npm test                                                                  # unit and integration tests
npm run test:e2e                                                          # Playwright (builds, seeds, starts a server on :3200)
npm run build                                                             # production build
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string. Empty means the embedded dev database. |
| `ANTHROPIC_API_KEY` | Enables LLM wording. Empty means template wording only (`llm_status = skipped`). |
| `LLM_MODEL` | Model for reasons and headline. Default `claude-haiku-4-5-20251001`. |
| `LLM_PRICE_IN_PER_MTOK`, `LLM_PRICE_OUT_PER_MTOK` | USD per million tokens, used only to log run cost. |
| `CRON_SECRET` | Vercel sends it as `Authorization: Bearer <CRON_SECRET>` on cron calls. Also accepted by API routes for scripts. |
| `APP_PASSWORD` | The single shared password. Also keys the signed session cookie. |
| `TZ` | `Asia/Kolkata`. |
| `PGLITE_DIR` | Optional folder for the embedded database (default `.data/pglite`). |

Secrets are read on the server only. Nothing is prefixed `NEXT_PUBLIC_`.

## Deploy to Vercel

1. Create a Neon database (Vercel Marketplace, or neon.tech) and copy its connection string.
2. Import the repo in Vercel and set `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, `CRON_SECRET`, `APP_PASSWORD` and `TZ=Asia/Kolkata` for Production.
3. Deploy. The `vercel-build` script applies migrations (`tsx scripts/migrate.ts`) and then builds, so the first deploy creates the schema, the active rule config (v1) and the brief's baseline range.
4. Load data: either use the **Data** page, or from a laptop run `DATABASE_URL=... npm run seed` to load the sample.
5. Vercel Cron reads `vercel.json` (`30 1 * * 1,4` = 01:30 UTC = 07:00 IST, Monday and Thursday) and calls `GET /api/cron/run` with the bearer secret. Check the first run on the **Health** page.

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

**A run failed.** Health shows it in red with the reason. Check, in order: (1) is `DATABASE_URL` reachable (Neon may be paused: open the Neon console); (2) was a file rejected wholesale, see the **Data** page; (3) the Vercel function logs for the run id. Fix the cause and press **Run now** (a failed run is never returned as the "existing" run, so it retries immediately). A run stuck in `running` for 30 minutes is marked failed automatically the next time anyone starts a run.

**A run is "completed with warnings".** Two causes, both shown in the banner. *Stock data is stale:* load a fresh inventory file, then rerun. *Wording fell back to templates:* the LLM was down, slow or failed validation. Actions, quantities and numbers are unaffected and the sheet is fully usable. If it persists check `ANTHROPIC_API_KEY`, `LLM_MODEL` and the provider's status.

**The cron did not run.** In Vercel check Settings > Cron Jobs, and that `CRON_SECRET` is set. You can trigger it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/run`.

**Two runs clicked at once.** Safe: a database advisory lock lets only one run at a time, and the same date within 10 minutes returns the existing run.

**A bad rule change.** Settings keeps every version. Reopen the previous values and save them as a new version with a note; each run records the version it used.

**A decision was made by mistake.** Press Undo on the line. The undo is logged.

**Rotate the password.** Change `APP_PASSWORD` and redeploy. All sessions end.

## Security notes

- Single shared password, constant-time comparison, signed `httpOnly` `SameSite=Lax` cookie (`Secure` in production). The proxy (`src/proxy.ts`) protects every page and API route; cron and scripts use the bearer `CRON_SECRET`.
- All external input is validated with Zod: every CSV row, every request body, every route parameter (UUIDs), and the `next` redirect on login.
- CSV content is untrusted: size, row and field limits; formula characters rejected in identifiers; every CSV we write neutralises cells starting with `=`, `+`, `-` or `@`. CSV text is only ever rendered by React (escaped).
- No API key or full prompt is logged. The LLM receives computed facts only, never raw tables.
- Rate limits on login, upload, run and backtest routes (per instance; see `ASSUMPTIONS.md` 35). Security headers are set in `next.config.ts`.

## Deferred

SAP automated export, Zoho API integration (the PO export is a CSV for now), email alerts (the hook is `src/run/alerts.ts`), and the Distributor Service and Ops Intelligence modules.
