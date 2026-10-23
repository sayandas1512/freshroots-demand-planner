# Assumptions

Every default chosen where the brief was silent or ambiguous. Each has a reason and a place to change it.
Items marked **Needs confirmation** are decisions someone at Freshroots still has to make.

## Rules and definitions

| # | Assumption | Why | Where it lives |
|---|---|---|---|
| 1 | **The 4-week window is part of the 12-week window.** Both end at the last complete week; the 12 weeks are W31 to W42 on the sample and the 4 weeks are W39 to W42. | The golden table only reproduces this way. SKU001's ratio is 1.2145, just over the 1.20 trigger, so rule 1 depends on it. | `src/engine/evaluate.ts`, `rule_config` |
| 2 | **Festival uplift mode defaults to `cover_demand`.** Demand used for weeks of cover is multiplied by 1.25 in a festival month; the trend ratio uses raw actuals. `both_windows` and `baseline_only` are one click away. **Needs confirmation (Raghav).** | Narrowest reading of "before any threshold checks", and it reproduces the golden table. | Settings page, `festival_uplift_mode` |
| 3 | **Open POs are shown next to stock but not counted as stock** (`include_open_po_in_stock = false`). **Needs confirmation (Raghav).** | Brief default. An open PO is not on the shelf yet. | Settings page |
| 4 | **Stale-data limit is 7 days.** Inventory more than 7 days older than the run date marks the run `completed_degraded` and shows a banner. If there is no snapshot at all, the run is degraded too. | Brief. The "newest snapshot" is taken across all SKUs. | `stale_inventory_days` |
| 5 | **A week is complete once its Sunday is before the run date.** A Monday or Thursday run therefore uses weeks up to the previous ISO week. | Weekly sales rows are written after the week closes. | `src/engine/weeks.ts` |
| 6 | **The month that counts for the festival uplift is the month of the run's `as_of_date`.** | Brief. | `src/engine/evaluate.ts` |
| 7 | **Run date (`as_of_date`) is the date the run is made for**, not the stock snapshot date. The Review page lets you choose it (default: today in IST). The golden run uses 2026-10-19. | Lets Raghav rerun for a past date and keeps tests independent of the clock. | `POST /api/run` |
| 8 | **One exception per SKU, first match wins:** new_sku, short_history, missing_stock, zero_demand, anomalous_jump, then conflicting_signals. `unknown_sku` is raised for SKUs outside the master. | Keeps the exceptions tab one row per SKU. | `src/engine/evaluate.ts` |
| 9 | **`anomalous_jump` compares the latest week with the mean of the 4 weeks before it**, and flags a ratio above 2.0 or below 0.5. Exactly 2.0x is not flagged. If the previous mean is 0 and the latest week is above 0, it is a jump. | Brief says "previous 4-week mean ... default 2.0x up or down". | `anomaly_factor`, `anomaly_lookback_weeks` |
| 10 | **`short_history` means fewer than 12 weeks with a sales row inside the 12-week window**, so a gap counts as missing history. | A hole in the data should not be averaged over silently. | `src/engine/evaluate.ts` |
| 11 | **Added exception type `processing_error`** for a SKU the engine could not evaluate (one bad SKU never stops the run). | Brief requires the failure to become an exception; its list had no type for it. | `exception_type` enum |
| 12 | **Rule precedence:** overstock with high demand is a `conflicting_signals` exception; high demand wins over stockout (and marks the line urgent); then stockout; then overstock; otherwise hold. `rule_fired` for the urgent case is `high_demand+stockout_risk.general` (or `.perishable`). | Brief gives the order but only examples of the strings. | `src/engine/evaluate.ts` |
| 13 | **Ratio and cover comparisons use a 1e-9 tolerance.** A ratio of exactly 1.20 is not flagged and cover of exactly 6, 14, 3 or 4 weeks is inside the window, even with floating point noise. | Boundary tests in the brief. | `src/engine/num.ts` |
| 14 | **Stock is the sum of the newest snapshot per location** on or before the run date. | Brief has one location today; this stays correct with more. | `src/run/load.ts` |

## Data and ingestion

| # | Assumption | Why |
|---|---|---|
| 15 | **The sample files were not supplied, so `/fixtures` is synthesised** to reproduce the section 7 golden table exactly (`npm run fixtures:build`). Names, standard quantities and distributors are invented. Replace them with the real extracts. | The golden table is the only ground truth available. |
| 16 | **The golden table rounds half to even** (209.25 shows as 209.2). The tests use the same rule. | The table's figures cannot be produced with round-half-up. |
| 17 | **Re-uploading sales upserts by (SKU, week).** Rows in the file replace matching rows; rows not in the file are left alone. Nothing is deleted. | "Re-uploading a week replaces it" read as row-level replacement; safer than deleting. |
| 18 | **Rows for a SKU not in the master are accepted with a warning** and later become `unknown_sku` exceptions. | Brief says ingestion reports them and the engine routes them; files may arrive before the master. |
| 19 | **Duplicate rows inside one file:** the first is kept, later ones are rejected with the row number of the first. | Never silently drop or silently pick. |
| 20 | **Open POs file columns are `SKU_ID, Open_PO_Qty, Expected_Date`** and each upload replaces the whole list (empty is valid). | The brief names Zoho open POs but gives no layout. **Needs confirmation (IT).** |
| 21 | **Limits:** 4 MB and 100,000 rows per file, 300 characters per field. | Stays under the 4.5 MB Vercel request body limit. |
| 22 | **Extra tables and columns:** `ingest_reports` (last report per file, for the Data page); `baseline.*_high` columns (the brief gives ranges); `backtest_results.system_qty` and `ordered_qty`. | Needed to meet the brief's UI requirements; nothing derived is stored beyond the audit snapshot. |

## Export

| # | Assumption | Why |
|---|---|---|
| 23 | **Export columns are `SKU_ID, SKU_Name, Quantity, Unit, Distributor_ID, Run_ID, Approved_At`,** with `Quantity` = `final_qty`. **Needs confirmation:** the real Zoho PO import template. Change `src/export/mapping.ts` once it is known. | Brief. |
| 24 | **Only approved or edited lines with a positive quantity are exported.** Approving a PAUSE or HOLD line records the decision but has no quantity, so it is not a purchase-order line. | A purchase order needs a quantity. |
| 25 | **Cells starting with `=`, `+`, `-`, `@`, tab or CR get a leading apostrophe** in every CSV we write. | Spreadsheet formula injection. |

## LLM

| # | Assumption | Why |
|---|---|---|
| 26 | **The LLM provider is Gemini Flash by default (v2), with Anthropic available behind the same interface.** Defaults are `gemini-2.5-flash` and `claude-haiku-4-5-20251001`; neither id could be verified against the live API from the build environment and neither call path has been tried with a real key. Set `LLM_PROVIDER` and `LLM_MODEL` and use **Check now, including the LLM** on Health. A wrong id only sends runs to templates. | Brief v2 names Gemini Flash. Failure is safe by design. |
| 27 | **The LLM only writes reasons for flagged lines.** Lines with no flag (hold) use the template wording, and the template-fallback rate on Health counts flagged lines only. | Brief: "a reason per flagged SKU". |
| 28 | **Guardrail details:** at most 3 sentences and 420 characters; numbers are matched after rounding to 0, 1 or 2 decimals (and as whole percentages derived from the ratio); digits in the SKU name or code are ignored; reorder, pause and "no action" wording must match the computed action. | Keeps the check strict but workable. |
| 29 | **`llm_status = skipped` (no API key) completes the run normally.** Only `partial` or `failed` degrade it. Health shows the template rate. | A deliberate no-LLM setup is not a fault. |
| 30 | **Cost is estimated from logged tokens** using `LLM_PRICE_IN_PER_MTOK` and `LLM_PRICE_OUT_PER_MTOK` (defaults 1 and 5 USD per million). Check them against the provider's current price list. | Prices were not available to verify. |
| 31 | **Each call has a 10 s timeout and one retry.** `llm_calls` counts attempts, including the retry. | Brief. |

## Operations

| # | Assumption | Why |
|---|---|---|
| 32 | **A manual run for the same date within 10 minutes returns the existing run** (a `skipped_killed` or failed run is never returned). A run with no progress for 30 minutes and no lease is marked failed the next time anyone starts a run. | Brief idempotency, plus a way out of a crashed run. |
| 33 | **Progress is stored on the run row** (`counts.steps`, plus `step`, `cursor`, `attempts`, lease) and the SSE route polls it every 350 ms. | Works across serverless instances without a message broker. |
| 34 | **A run is a resumable state machine** (prepare, explain, headline, finalize). Each invocation does one bounded piece (explain: 75 flagged lines, 3 LLM batches of 25), saves where it got to, and calls `POST /api/run/<id>/advance` for the next piece, which answers 202 and works after responding. A cron safety net (`/api/cron/resume`, every 10 minutes) resumes runs nobody is working on. The 10-minute schedule needs a Vercel plan that allows it; on Hobby use a daily schedule and the manual `curl` in the runbook. | Brief v2 (CH-07). |
| 35 | **Rate limits are in memory per server instance** (login 30/min per address and 8/min per account, uploads 30/min, runs 6/min, backtests 10/min). | A shared store is overkill for a 200-person company. Use Vercel Firewall for a global limit. |
| 36 | **Local dev and tests use an embedded Postgres (PGlite)** when `DATABASE_URL` is empty. Production must set `DATABASE_URL`. | Lets a new developer run everything with no setup. |
| 37 | **Named users, passwordless (v2).** There are no passwords: a person asks for a link by email and the link signs them in once. The signed session cookie carries user id and role, lasts 12 hours and is keyed by `SESSION_SECRET`; rotating it signs everyone out. A role change or deactivation takes effect at the next sign-in or within 12 hours; the user record is read on every page for the name shown. There is no sign-up page: users come from `npm run seed:users`. | CH-01. |
| 38 | **Migrations run at deploy** (`vercel-build` runs `tsx scripts/migrate.ts` before `next build`), so the build needs `DATABASE_URL`. | One deploy target, no separate migration job. |
| 39 | **Undo is itself logged** in the override log ("Decision undone by reviewer"). The override rate on Health is computed from current line status, so an undone edit no longer counts. | Keeps the audit trail complete without inflating the rate. |

## Backtest

| # | Assumption | Why |
|---|---|---|
| 40 | **Week w is replayed as the planner would have run it once w ended:** run date is the Monday after w; sales through w; the newest stock snapshot dated on or before that Monday; no open POs (their history is not kept). Orders labelled week w are the ones compared. | "Using only data up to w". The sample's single snapshot (2026-10-19) is the Monday after W42, so W42 reproduces the golden run. |
| 41 | **Comparison is order or not order,** not quantity. A SKU missing from the orders file counts as not ordered if the file has any rows for that week; a week with no rows is not compared. Exceptions are not compared. | Quantities depend on judgment the rules do not make. |
| 42 | **With one stock snapshot only the last replayed week is meaningful;** earlier weeks show `missing_stock` exceptions and a note. The page says so. | Past stock cannot be reconstructed from sales alone. |

## Version 2: roles, shadow mode, kill switch, outcomes

**Needs confirmation** items are the decisions that a person must make before go-live. Everything else is a default that can be changed.

### Needs confirmation

| # | What | Current default | Who |
|---|---|---|---|
| 43 | **Kill thresholds.** Quarterly loss above the baseline high (₹34 lakh = ₹22 lakh stockout + ₹12 lakh write-off highs); month warning above one third of it; weekly indicators more than 20% worse (warn 10%) than the frozen 8-week baseline at 2 consecutive checks; override rate above 50% across 4 consecutive live runs; rubber-stamp warning below 2% overrides and under 5 s median across 4 runs. All are in `rule_config` and on Settings. | As listed | Sponsor |
| 44 | **Loss-calculation method** for stockout loss and write-offs. It is recorded as a note with every monthly entry; the app warns if it differs from the previous month and never changes it silently. | None set | Sponsor and finance |
| 45 | **Meaning of `Distributor_ID` on the SKU master.** It may be the supplier we order from or the selling distributor. The export column label is configurable (`export_id_label`, default `Distributor_ID`). | Unconfirmed | Procurement, IT |
| 46 | **Expected distributor regions** (a warning on upload, not an error): `Maharashtra`, `Goa`, matched case-insensitively as equal to or contained in the region text. City names such as "Pune" therefore also warn unless they are added to the list. | Maharashtra, Goa | IT, planner |
| 47 | **Hosting.** Commercial data lives on Neon and Vercel and only computed numbers, SKU names and categories go to the LLM provider. IT and the CEO must sign off. Target Neon region: Singapore (`aws-ap-southeast-1`), the nearest available to India. The region could not be chosen from the build environment and must be set when the Neon project is created. | Not signed off | IT, CEO |
| 48 | The v1 items that remain open: **4-week window inside the 12-week window**, **festival uplift mode** (`cover_demand`), **open POs excluded from stock**, the Zoho import template and open-PO file layout. | See rows 1 to 3, 20, 23 | Planner, IT |

### Defaults chosen in v2

| # | Assumption | Why |
|---|---|---|
| 49 | **Mode defaults to `shadow`.** Shadow blocks the export (423) and shows SHADOW on every page; runs, sheets, review and overrides all work. Changing mode needs the sponsor or an admin and a note, and creates a config version. Config versions saved before v2 parse with `mode = shadow` and the new settings at their defaults. | CH-02. |
| 50 | **Going live is gated.** The save is refused until every go-live checklist item is ticked by a named user and 8 weeks of weekly outcomes exist (or the baseline is already frozen). | "Mode changes to live only with sponsor approval" plus the checklist. |
| 51 | **The weekly baseline is frozen once**, on the first shadow to live change: the 8 newest weekly outcome weeks before the go-live week are copied to `baseline_weekly` and never edited. A later return to shadow and back keeps the frozen figures. | "Frozen when mode changes." |
| 52 | **Quarters are calendar quarters** (Jan to Mar, Apr to Jun, Jul to Sep, Oct to Dec), which are also the Indian financial-year quarters. A quarter counts for the kill test only if it starts on or after the go-live date and all three months are entered. The month test uses the newest month starting on or after go-live. | Definition of "a full quarter in live mode". |
| 53 | **A zero weekly baseline counts as 100% worse when the 4-week average is above zero,** and 0% otherwise. | Avoids dividing by zero without ignoring a real change. |
| 54 | **Two consecutive indicator checks are checks on different latest outcome weeks.** A check on the same data as the previous one does not count twice. | Otherwise two runs on the same Monday could kill. |
| 55 | **Runs where nothing has been decided yet are left out of the override and rubber-stamp tests.** A run is evaluated when it finishes, before anyone has reviewed it, so the tests look at runs with decisions. The kill check also runs after each completed run and monthly, so overrides are picked up by the next run's check. | A fresh run says nothing about overrides. |
| 56 | **Rubber-stamp warning is evaluated in shadow mode too;** the other criteria are not. Decision time is the gap between a row first being 60% in view for one second and the decision; rows decided without a recorded view (for example by keyboard before scrolling) are left out of the median. | CH-05. |
| 57 | **Roles.** planner: decide, rules, run, export, backtest. sponsor: mode, kill thresholds, clear kill, outcomes, backtest, run. data: uploads, outcomes, run. admin: everything. Any signed-in user may stop the system. Mode and kill thresholds are separate from rules in the config save, so a planner and a sponsor can each change only their own settings. | CH-01. |
| 58 | **The kill switch stops runs, export and Review decisions; uploads and outcome entry still work** so data keeps flowing while it is investigated. A tripped switch sends one alert email (best effort via Resend: `RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM`); repeats do not email again. | CH-03 and section 5. |
| 59 | **Outcome tables:** `outcomes_weekly` (Week, Stockout_Incidents, Overstock_Value_INR, from Priya's report, CSV or manual), `outcomes_monthly` (month, stockout loss, write-offs, method note). The older quarterly `baseline` range table is kept as is. | CH-04. |
| 60 | **Distributor-level sales are optional** (`Distributor_ID` column on sales). Distributor rows are the source of truth for a SKU and week; the aggregate is derived. An aggregate upload that differs from the derived sum is not applied and is reported as a warning. `distributor_shift` flags a distributor whose share over the last 4 weeks is more than 30% (relative) below its 12-week share, ignoring distributors below a 5% baseline share, and needs two or more distributors. It is off by default and never produces a recommendation. | CH-06. |
| 61 | **Lead time and MOQ are optional SKU master columns** (`Lead_Time_Weeks`, `MOQ`). They are shown when present. The informational chips `Lead time (info)` and `Below MOQ (info)` appear only when switched on, never change an action or quantity, and are not sent to the LLM. A file without these columns does not clear stored values. | CH-09. |
| 62 | **LLM usage is logged for committed work only.** If a step crashes after the LLM answered but before it saved, those calls are made again on resume and the first set is not counted in `llm_calls` or cost. | Atomic steps. |
| 63 | **Shadow comparison** treats the system as "ordering" a SKU for a month if any completed run that month recommended a reorder (largest quantity), otherwise it uses the latest run's line or exception; a SKU missing from Raghav's file counts as not ordered when the file has rows for that month. | CH-02, reusing the backtest comparison. |
| 64 | **Festival uplift check:** a week belongs to the month of its Thursday; the baseline is the 12 weeks before the first festival week of the month; a month is skipped with a reason when the data is not there. October then November will show November understated because its baseline includes October, and the page says so. | CH-08. |
| 65 | **Export:** a preview page shows exactly what will be sent and every preview and download is logged with user, time, line count and total quantity. Export needs the planner or admin role. | CH-10. |
| 66 | **Synthetic data** (`npm run gen:synthetic`): 400 SKUs, 156 weeks, 1,200 distributors, seasonality, the three festival months and awkward cases, deterministic, written to `fixtures/synthetic` (not committed). The scale test generates it in memory. | CH-07. |
| 67 | **Logs are structured JSON** with a `runId` where there is one; any field whose name contains key, secret, password, token, authorization, cookie or prompt is redacted. | CH-11. |

### Zoho Inventory connector

| # | Assumption | Why |
|---|---|---|
| 68 | **Zoho is optional.** With no credentials the CSV open-PO upload and CSV export work as before. With them, the open-PO CSV upload is switched off (409) so the two sources cannot double count; Zoho rows and CSV rows are stored separately (`open_pos.source`). | Avoids double counting. |
| 69 | **OAuth: a refresh token in env, the access token cached in the database** (`app_state`, about an hour, refreshed 5 minutes early or on 401). Zoho's token endpoint is `accounts.zoho.<dc>`; India is the default. | Zoho docs. A 1-hour token cannot be held per instance on serverless. |
| 70 | **Data is polled, not streamed.** Every 30 minutes, before each run when older than 30 minutes, on demand, and optionally on a webhook (at most once a minute). A failed sync never stops a run. | Zoho allows about 100 calls a minute and 1,000 to 10,000 a day by plan. |
| 71 | **Daily call budget defaults to 1,000** (the lowest plan). Open PO detail is read only when new, changed, 6 hours old or forced; items and vendors every 6 hours. When the budget runs short the last known quantities are kept and a warning is shown. | Zoho's PO list has no line items. |
| 72 | **Open statuses default to `issued`, `partially_received`, `open`** (`ZOHO_OPEN_PO_STATUSES`). Open quantity is ordered minus received, per line. **Needs confirmation against your Zoho account** (sandbox). | The documented statuses; account may differ. |
| 73 | **A Zoho item matches a SKU when the Zoho item's SKU equals our SKU_ID,** with a manual override table. Unmatched items on open POs are listed and not counted. | Simplest rule that works with a clean master. |
| 74 | **Vendors are mapped per `Distributor_ID`** (`zoho_vendor_map`). This is the one place to settle whether that ID is the supplier or the selling distributor (row 45). | Unconfirmed meaning. |
| 75 | **Draft purchase orders only.** One per vendor, with `purchase_rate` from the Zoho item, `reference_number` and `purchaseorder_number` set to `FR-<run>-<vendor>`, and a note saying to review before issuing. The code never calls Zoho's issue, approve or submit endpoints. A vendor with any line that cannot be sent is held back whole. | Brief: the system never places an order. |
| 76 | **Gates for drafts:** live mode, kill switch off, planner or admin role, the Zoho connector configured, and a separate switch `zoho_push_enabled` (default off, sponsor or admin) in Settings. | Same gates as the CSV export plus an explicit opt-in. |
| 77 | **Never twice.** The reference is written to a unique ledger before the call. A lost request is `unconfirmed`: the app looks for the number in Zoho's latest 200 purchase orders, and if it cannot tell, stops and asks a person to confirm a retry. A 4xx answer is a definite failure and may be retried. | Duplicate POs are expensive. |
| 78 | **Not verified against a live Zoho organisation.** Built from the published API documentation (endpoints, `organization_id` parameter, scopes, `page_context.has_more_page`, status values) and tested against a stand-in. To confirm in a sandbox: open statuses, JSON create body, custom PO numbers under automatic numbering, plan quotas. | No Zoho credentials were available. |

### Passwordless sign-in

| # | Assumption | Why |
|---|---|---|
| 79 | **Email magic link instead of a password.** The link is valid 15 minutes and works once; only a SHA-256 hash of the token is stored; opening it shows a confirm button and only the POST signs in, so email security scanners that "click" links cannot use it up. The form gives the same answer for any email, so it cannot reveal who has an account. Limits: 20 requests a minute per address, 5 links per 10 minutes per email. | Removes the password without making the app open to anyone with the web address, which would let anyone act as Raghav or approve as the sponsor. |
| 80 | **Production sign-in depends on email.** It needs `RESEND_API_KEY`, a verified `ALERT_FROM` sender and `APP_URL`. If email is down, IT can print a one-time link with `npm run login-link`. Anyone who controls a user's mailbox can sign in as them, so mailbox security (for example two-step verification on company email) is now the login security. | Trade-off of passwordless. |
| 81 | **The link works from any device** (it is not tied to the browser that asked for it), so it can be opened on a phone and used on a laptop only if copied; it is still single use. On-screen links exist only for local development and tests (`AUTH_DEV_LINKS=1`) and are refused on Vercel production. | Convenience without a production back door. |
