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
| 26 | **Default `LLM_MODEL` is `claude-haiku-4-5-20251001`, not `claude-haiku-5-5`.** | The brief's ID could not be verified as a real model; a wrong ID would silently send every run to templates. Set `LLM_MODEL` to change it. |
| 27 | **The LLM only writes reasons for flagged lines.** Lines with no flag (hold) use the template wording, and the template-fallback rate on Health counts flagged lines only. | Brief: "a reason per flagged SKU". |
| 28 | **Guardrail details:** at most 3 sentences and 420 characters; numbers are matched after rounding to 0, 1 or 2 decimals (and as whole percentages derived from the ratio); digits in the SKU name or code are ignored; reorder, pause and "no action" wording must match the computed action. | Keeps the check strict but workable. |
| 29 | **`llm_status = skipped` (no API key) completes the run normally.** Only `partial` or `failed` degrade it. Health shows the template rate. | A deliberate no-LLM setup is not a fault. |
| 30 | **Cost is estimated from logged tokens** using `LLM_PRICE_IN_PER_MTOK` and `LLM_PRICE_OUT_PER_MTOK` (defaults 1 and 5 USD per million). Check them against the provider's current price list. | Prices were not available to verify. |
| 31 | **Each call has a 10 s timeout and one retry.** `llm_calls` counts attempts, including the retry. | Brief. |

## Operations

| # | Assumption | Why |
|---|---|---|
| 32 | **A manual run for the same date within 10 minutes returns the existing run.** A run still marked `running` after 30 minutes is marked failed so it cannot block the next one. | Brief idempotency, plus a way out of a crashed run. |
| 33 | **Progress is stored on the run row** (`counts.steps`) and the SSE route polls it every 350 ms. | Works across serverless instances without a message broker. |
| 34 | **Runs execute after the response** using Next's `after()` (Vercel `waitUntil`), up to the function's 300 s limit. | The Review page streams real progress while the run works. |
| 35 | **Rate limits are in memory per server instance** (login 10/min, uploads 30/min, runs 6/min, backtests 10/min). | Brief asks for rate limits; a shared store is overkill for a 200-person company. Use Vercel Firewall for a global limit. |
| 36 | **Local dev and tests use an embedded Postgres (PGlite)** when `DATABASE_URL` is empty. Production must set `DATABASE_URL`. | Lets a new developer run everything with no setup. |
| 37 | **Session cookie lasts 12 hours and is keyed by `APP_PASSWORD`,** so changing the password signs everyone out. | Brief asks for a single shared password and a signed cookie. |
| 38 | **Migrations run at deploy** (`vercel-build` runs `tsx scripts/migrate.ts` before `next build`), so the build needs `DATABASE_URL`. | One deploy target, no separate migration job. |
| 39 | **Undo is itself logged** in the override log ("Decision undone by reviewer"). The override rate on Health is computed from current line status, so an undone edit no longer counts. | Keeps the audit trail complete without inflating the rate. |

## Backtest

| # | Assumption | Why |
|---|---|---|
| 40 | **Week w is replayed as the planner would have run it once w ended:** run date is the Monday after w; sales through w; the newest stock snapshot dated on or before that Monday; no open POs (their history is not kept). Orders labelled week w are the ones compared. | "Using only data up to w". The sample's single snapshot (2026-10-19) is the Monday after W42, so W42 reproduces the golden run. |
| 41 | **Comparison is order or not order,** not quantity. A SKU missing from the orders file counts as not ordered if the file has any rows for that week; a week with no rows is not compared. Exceptions are not compared. | Quantities depend on judgment the rules do not make. |
| 42 | **With one stock snapshot only the last replayed week is meaningful;** earlier weeks show `missing_stock` exceptions and a note. The page says so. | Past stock cannot be reconstructed from sales alone. |
