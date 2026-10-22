# Gap report: v1 build vs the v2 revision prompt

Audit only. No code was changed to produce this report. Status key: **Done** (already does it), **Partial**, **Missing**.

Repo state at audit: Next.js 16 + TypeScript, Drizzle on Postgres (Neon in production, embedded PGlite in dev and tests), 178 Vitest tests and 7 Playwright tests passing at the last run. The folder was copied into this location without `.git` and `node_modules`, so version history from v1 is not here. The first step of the apply phase is `git init`, a baseline commit, and `npm ci`.

## "What did not change" check

| Item | Status | Notes |
|---|---|---|
| Next.js, Vercel, Neon, Drizzle, Zod, GSAP | Done | |
| Five rules, precedence, exception types, golden table, template fallbacks, saved-before-shown sheet, override log | Done | `src/engine/*`, `tests/golden.test.ts`, `src/ai/templates.ts`, `src/run/execute.ts` |
| LLM behind one interface | Partial | Interface exists (`src/ai/types.ts`) but the only implementation is Anthropic (`src/ai/anthropic.ts`). v2 says Gemini Flash. Plan: add a Gemini implementation behind the same interface, select with env `LLM_PROVIDER`; keep Anthropic as an option. Needs a `GEMINI_API_KEY`; cannot be tested against the real API here. |
| Resend for alerts | Partial | Only a console hook, `src/run/alerts.ts`. Plan: add a Resend sender (fetch to the Resend REST API, no SDK) used when `RESEND_API_KEY` and `ALERT_EMAIL` are set. |
| GitHub Actions | Missing | No `.github/workflows`. Plan: add a CI workflow (lint, typecheck, test, build). |

## Change by change

| ID | Change | Status | What exists, and where | Plan |
|---|---|---|---|---|
| CH-01 | Named users and roles | **Missing** | Single shared password (`src/app/api/auth/login/route.ts`), cookie keyed by `APP_PASSWORD` (`src/auth/session.ts`), checked in `src/proxy.ts`. No users table, no roles, no actor ids on decisions (`src/run/decisions.ts`), uploads (`src/ingest/ingest.ts`) or baseline entry. | `users` table (scrypt hashes, node:crypto), `npm run seed:users` from `SEED_USERS` env, session carries user id and role, role guard helper used by every mutating route, actor columns on recommendations, ingest reports, overrides, outcomes, kill state, export log. Cron and bearer routes stay secret-based. |
| CH-02 | Shadow and live mode | **Missing** | `rule_config` is versioned (`src/run/config-store.ts`) with no `mode`. Export (`src/app/api/export/approved/route.ts`) has no gate. Backtest comparison code is reusable (`src/backtest/compare.ts`). | `mode` in config (default `shadow`), role-gated change with note, 423 on export in shadow, SHADOW label on Review and Health, shadow comparison page reusing `compareLines`, with the system's reason shown for disagreements. |
| CH-03 | Kill criteria rebuilt, pure `executeKillCheck()` | **Missing** | No kill concept anywhere. Health has a baseline panel only (`src/app/(app)/health/page.tsx`, `src/run/baseline.ts`). | Pure function and tests first, then `kill_state` table, config thresholds, Settings and Health display, second cron entry, evaluation after each run. |
| CH-04 | Outcome log redesign | **Partial** | `baseline` table with quarterly low/high and a manual quarterly entry form (`src/app/api/baseline/route.ts`, `BaselineForm.tsx`). No weekly or monthly outcome tables, no frozen weekly baseline, no method note. | `outcomes_weekly`, `outcomes_monthly`, `baseline_weekly` (frozen on shadow to live), weekly CSV upload, method-note mismatch warning. Keep `baseline` as is. |
| CH-05 | Decision-time capture and rubber-stamp warning | **Partial** | `decided_at` exists on recommendations. No `first_viewed_at`, no timing metrics. Override rate per run exists in `src/run/health.ts`. | Add `first_viewed_at` (set by a one-second in-view observer via a small API), median seconds per decision, 4-run rule, configurable thresholds, warning only. |
| CH-06 | Distributor-level data | **Missing** | Sales contract has no distributor column (`src/ingest/mapping.ts`, `schemas.ts`). Distributors table exists but is not used by the engine. | Optional `Distributor_ID` on sales, `weekly_sales_by_distributor`, aggregate derivation and reconcile, `distributor_shift` exception behind a config flag, default off. |
| CH-07 | Scale and resumable runs | **Partial** | Table is virtualised above 100 rows and tested with 415 lines in e2e. `executeRun()` is a single invocation run via `after()` with up to 300 s (`src/run/execute.ts`). Steps are recorded in `runs.counts.steps` but there is no persisted step, cursor or attempts, and no resume. LLM batches of 25 exist (`src/ai/generate.ts`). No synthetic generator. | Add `step`, `cursor`, `attempts` columns, split the run into bounded step functions driven by `advanceRun()`, chain invocations (self-call with the secret, and a cron safety net that resumes stuck runs), idempotent inserts, `npm run gen:synthetic` (400 SKUs, 156 weeks, 1,200 distributors), forced-failure resume test. |
| CH-08 | Backtest on real history and festival uplift check | **Partial** | Backtest works from the DB and loads all sales rows per replayed week (`src/run/load.ts`), fine for the sample but will be slow at 3 years x 400 SKUs x up to 26 weeks. No festival uplift check. | Load history once per backtest and slice in memory, add category-level festival uplift check (informational) on the Backtest page. |
| CH-09 | Optional lead time and MOQ | **Missing** | SKU master has neither field. | Nullable columns, ingestion, display next to cover, informational flags `lead_time_breach` and MOQ flag, config switch default off. |
| CH-10 | Procurement export realism | **Partial** | Single mapping file `src/export/mapping.ts`, CSV neutralisation, `Distributor_ID` assumption not recorded as unconfirmed beyond a mention. No `export_id_label`, no preview screen, no download log. | Config field, preview page, `export_log` table with user and time, assumptions entry. |
| CH-11 | Operability | **Partial** | README has a short runbook. Alert hook exists. No `docs/RUNBOOK.md`, no `/api/health`, logs are plain `console.warn`. | Runbook doc, `/api/health`, small JSON logger with run ids and a redaction test, Health page panel. |
| CH-12 | Data handling | **Partial** | LLM facts are built in `src/ai/facts.ts` and `src/ai/anthropic.ts` (`wireFacts`): computed numbers, SKU name, category only. Verified by a test of the key list in `tests/anthropic.test.ts` but there is no allow-list enforced in code, and no assumptions entry about hosting or region. | Enforce an allow-list in the payload builder, add test, add assumptions entry. The Neon region cannot be chosen from here: record the target (Singapore, `aws-ap-southeast-1`, nearest to India) as a decision for IT. |
| CH-13 | Region warning on distributors | **Missing** | Distributors ingest has no region check (`src/ingest/schemas.ts`). | Config list of expected regions, warning (not error) in the ingest report. Do not change the sample. |
| CH-14 | Map and docs alignment | **Missing** | README maps 10 steps. | After the above: 18-step table, Settings, Data and Health pages, assumptions. |

## Other v1 facts the revision depends on

- Config is validated by a strict Zod schema (`src/engine/config.ts`), so every new setting must be added there with a default so old config versions keep parsing (use `.default()` through a preprocess step for versions saved before v2).
- `recommendations` has a unique index on (run, SKU), which already protects against duplicate inserts when a run resumes.
- Runs are protected by an advisory lock and a 10-minute idempotency window (`startRun`). Resumable runs must keep the one-active-run rule.
- Tests use in-memory PGlite and an additional wire-protocol test for the `pg` driver (`tests/pg-driver.test.ts`).

## Ordered plan

Each group ends green on `npm run lint`, `npm run typecheck`, `npm test`, then a commit. Playwright and the production build run at the end of groups C, F and I.

- **A. Repo hygiene.** `git init`, baseline commit of the audited state, `npm ci`, confirm tests pass in this folder. Add CI workflow.
- **B. CH-01 users and roles.** Schema and migration, hashing, session, role guards on every mutating route, actor columns, seed script, tests per role, update Playwright login.
- **C. CH-02 and CH-03 mode and kill.** Config additions with defaults; pure `executeKillCheck()` with exhaustive tests; `kill_state`; mode gating on export and Review; manual stop, role-gated clear with note; second cron entry; alert email via Resend (best effort); banners.
- **D. CH-04 and CH-05 outcomes and decision timing.** Outcome tables, CSV upload, baseline freeze, method-note warning, `first_viewed_at`, rubber-stamp warning.
- **E. CH-06, CH-09, CH-13 optional data.** Distributor sales, `distributor_shift`, lead time and MOQ, region warning.
- **F. CH-07 resumable runs and synthetic data.** State machine, resume tests, generator, full-size run test.
- **G. CH-08 and CH-02 comparison views.** Backtest at scale, festival uplift check, shadow comparison page.
- **H. CH-10, CH-11, CH-12.** Export preview and log, `/api/health`, JSON logs, runbook, LLM allow-list, provider interface with Gemini.
- **I. CH-14 and the go-live page.** Go-live checklist under Health with named-user ticks, README 18-step map, `ASSUMPTIONS.md`, Playwright additions (shadow export blocked, go-live walk-through, manual stop, clear with note), final change log.

## Items that will be blocked on a human regardless of code

Kill thresholds and loss method (sponsor), festival uplift scope (Raghav), SAP export date and hosting sign-off (IT, CEO), whether `Distributor_ID` is the supplier or the selling distributor, procurement agreement to act on approved lines, and a Gemini API key and Resend key for live testing.

---

## Status after applying the plan

All items are closed in code with tests, except where a human decision or a live credential is needed. Commits are one per group (see `git log`).

| ID | Result | Where | Left open |
|---|---|---|---|
| Gemini behind the interface | Done, mocked-API tests only | `src/ai/gemini.ts`, `src/ai/index.ts` | Real `GEMINI_API_KEY` and a verified model id |
| Resend alerts | Done, mocked-API tests only | `src/lib/email.ts`, `src/run/alerts.ts`, `src/kill/state.ts` | Real `RESEND_API_KEY` and a verified sender |
| GitHub Actions | Done | `.github/workflows/ci.yml` | First run on GitHub |
| CH-01 users and roles | Done | `src/auth`, `users` table, `npm run seed:users`, role guards on every mutating route | Real users and passwords |
| CH-02 shadow and live | Done | `mode` in config, `src/run/mode.ts`, export guard, `src/shadow`, `/shadow` | |
| CH-03 kill criteria | Done, exhaustive tests | `src/kill/check.ts`, `kill_state`, `kill_checks`, Health, Settings | Sponsor confirms thresholds |
| CH-04 outcome log | Done | `outcomes_weekly`, `outcomes_monthly`, `baseline_weekly`, `/outcomes` | Sponsor and finance confirm the loss method |
| CH-05 decision timing | Done | `first_viewed_at`, `/api/recommendations/viewed`, Health | |
| CH-06 distributor data | Done, off by default | `weekly_sales_by_distributor`, `src/engine/distributors.ts` | Real distributor-level extract |
| CH-07 scale and resume | Done | `src/run/machine.ts`, `src/synthetic`, `tests/machine.test.ts` (400 SKUs, 156 weeks, 1,200 distributors, forced crash and resume) | Re-test on Neon at real size |
| CH-08 backtest and uplift check | Done | `src/run/history.ts`, `src/backtest/festival.ts` | Real 3-year history |
| CH-09 lead time and MOQ | Done, off by default | SKU master optional columns, `infoFlags` | |
| CH-10 export realism | Done | `export_id_label`, `/export` preview, `export_log` | Confirm the meaning of `Distributor_ID` and the Zoho template |
| CH-11 operability | Done | `docs/RUNBOOK.md`, `/api/health`, `src/lib/log.ts` | |
| CH-12 data handling | Done | `src/ai/payload.ts` allow-list with tests | IT and CEO hosting sign-off; Neon region chosen when the project is created |
| CH-13 region warning | Done | ingestion warning, `expected_regions` | |
| CH-14 map and docs | Done | README (18 steps), `ASSUMPTIONS.md` rows 43 to 67 | |

Deliberately not changed: the five rules, their precedence, the golden table, the template fallbacks, the draft-sheet-before-display rule, the override log, and the sample distributors.
