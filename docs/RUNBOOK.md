# Runbook: Demand Planning Pulse

For the IT team (SAP and ERP people, no AI team needed). Everything here can be done from the web app, the Vercel dashboard, Neon, or four npm commands.

## 0. Is it working? (30 seconds)

Open **Health**. The **System status** card shows: database reachable, last run and its status, newest sales week and stock date, and the LLM provider. **Check now, including the LLM** sends a tiny test call. The same data is at `GET /api/health` (sign in, or send `Authorization: Bearer $CRON_SECRET`). It returns 503 if the database is down, so an uptime monitor can alert on it.

| Overall | Meaning | What to do |
|---|---|---|
| ok | Fresh data, last run fine, not stopped | Nothing |
| degraded | Stock data is stale, or the last run failed or was degraded, or the LLM is unreachable | Section 3 |
| stopped | The kill switch is on | Section 6 |
| down | Database unreachable | Open the Neon console: the project may be paused or the connection string changed. Redeploy after fixing `DATABASE_URL` |

## 1. Reading a run

The **run strip** on Review has six boxes: Trigger, Data, Rules, Exceptions, Wording, Sheet.

- **Green tick:** done. **Amber "!" with dashed ring:** done but degraded (stale stock, or wording fell back to templates). **Grey dash:** skipped (no LLM key). **Red ×:** failed.
- A run is saved in steps (prepare, explain, headline, finalize), each a short piece of work. You can watch it advance; nothing is shown on Review until the sheet is saved.
- **Run log:** Health > Runs lists every run with status, lines, exceptions, LLM status, calls, cost and the rules version used. For detail, search the Vercel function logs for the run id. Logs are JSON, one line each: `{"t":..., "level":..., "msg":..., "runId":...}`. Secrets and prompts are never logged.

## 2. Run states

| Status | Meaning |
|---|---|
| running | In progress. If it has not moved for 10 minutes see "Stuck run" |
| completed | Done, nothing to flag |
| completed_degraded | Done and usable. The banner on Review says why (stale stock, or template wording). Numbers and actions are unaffected |
| failed | A step failed 3 times. The reason is the last note on the run and in the alert email |
| skipped_killed | Cron or Run-now was refused because the kill switch is on. Nothing else happened |

## 3. Failure states and fixes

**Stock data is stale (degraded).** The newest inventory snapshot is more than 7 days old (setting on Settings). Load a fresh `inventory.csv` on the **Data** page, then press **Run now**. Until then, treat cover numbers with care.

**Wording fell back to templates (degraded).** The LLM was down, slow or failed validation. The sheet is fully usable. Check `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, and the provider status page; use **Check now, including the LLM** on Health. Re-run if you want LLM wording.

**Run failed.** Read the last note on the run (Health > Runs, or the alert email). Typical causes: database unreachable (see section 0), a data problem (look at the Data page for rejected files). Fix it and press **Run now**: a failed run is never returned as the "existing" run, so it starts fresh.

**Stuck run (status running, no movement).** Runs chain themselves: each piece asks the app to do the next piece. A cron job `GET /api/cron/resume` (daily on the Hobby plan, every 10 minutes on Pro) resumes any run that nobody is working on. To resume by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/run/<run id>/advance
```

A run with no progress for 30 minutes is marked failed the next time anyone starts a run. Note: Vercel's Hobby plan limits cron frequency; on Hobby, change the resume schedule to daily and rely on the manual command above.

**The scheduled run did not happen.** Vercel > Project > Settings > Cron Jobs: check the three jobs exist (`/api/cron/run`, `/api/cron/kill-check`, `/api/cron/resume`) and that `CRON_SECRET` is set. Trigger by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/run`.

**Two people pressed Run now.** Safe. Only one run can be active (database lock), and the same date within 10 minutes returns the existing run.

**Zoho sync failing.** Health > System status shows the Zoho line; the Zoho page shows the error. The run still completes using the last synced open POs and says so. See `docs/ZOHO.md` ("If something is wrong"). To refresh by hand press **Sync now** on the Zoho page. A draft PO marked **unconfirmed** needs a person to look in Zoho before anything is retried.

## 4. Re-running and restoring settings

- **Re-run:** Review > Run date > Run now. Choose the date the data is for (default today in IST).
- **Restore a previous rules version:** Settings keeps every version with its note and a diff. Re-enter the old values and save as a new version with a note such as "Restore v3". Each run records the version it used. Rules need the planner or admin role; the mode and kill thresholds need the sponsor or admin.
- **Undo a decision:** Undo on the line. Undo is logged.

## 5. When SAP files are late

1. Do not wait silently: the run still happens on Monday and Thursday and will show the stale-data banner.
2. Ask the data analyst (Priya) to upload what is available on **Data** (sales, stock, SKU master, distributors). Each file validates on its own; rejected rows are listed with reasons and the good rows still load. Uploading the same file twice is safe.
3. If stock is the late file, Raghav decides whether to wait for a rerun or to review with the banner on. Nothing is exported without his approval.
4. Tell the sponsor if two runs in a row are degraded for this reason.

## 6. The kill switch

**What it does when on:** scheduled and manual runs record `skipped_killed` and do nothing; the purchase-order export returns 423; Review is read-only; every page shows a red banner; an email goes to `ALERT_EMAIL`. Raghav's existing manual process is unaffected.

**Trip by hand (anyone signed in):** the red **Stop** button in the top bar. A reason is required.

**Trips by itself:** after every completed run and on the 1st of each month. Three kill tests (listed with current values and thresholds on Health, thresholds on Settings) and one warning:
1. A full live quarter's loss (stockout loss + write-offs) above the baseline high (₹34 lakh). A month above a third of it only warns.
2. The 4-week average of stockout incidents, or of overstock value, more than 20% worse than the frozen 8-week baseline at 2 consecutive checks (warns at 10%).
3. Override rate above 50% across 4 consecutive completed live runs (edited + rejected over decided lines; exceptions do not count).
4. Rubber-stamp warning (override rate below 2% and median decision time under 5 s across 4 runs). Warns only.

All thresholds are starting proposals that the sponsor must confirm. Tests 2 and 3 need data: weekly outcomes and a frozen baseline (Outcomes page), and decided lines. Until then they show "no data" and cannot trip.

**Clear it:** Health > Kill switch and criteria. Only the sponsor or an admin can clear it, with a written note. The history (who, when, why) is kept.

**Kill drill:** (1) press Stop, give a reason, check the banner, check Run now is refused and the export returns 423; (2) clear it with a note; (3) trip it by a simulated breach: upload `fixtures/outcomes_breach.csv`, press **Run the kill check now** on Health (a warning), upload `fixtures/outcomes_breach_next_week.csv`, run it again (it stops); (4) clear it again.

## 7. Measurement start and the baseline

There is no go-live gate: results are judged from the measurement start date, shown on Health and Outcomes. It is set automatically the first time the system is used. When real data replaces sample data, load the real weekly outcomes (Outcomes page) and have the sponsor or an admin **Restart measurement** from the date real use began: the 8 weekly outcomes before it become the new frozen baseline.

## 8. Users and secrets

**Open access.** If `OPEN_ACCESS=1` is set, nobody needs to sign in and everyone with the link is a guest administrator (see `ASSUMPTIONS.md` 82 to 85). Check this first if actions appear under the name "Guest". To require sign-in again, remove `OPEN_ACCESS` (or set it to `0`) in Vercel and redeploy.

- **Sign-in:** there are no passwords. A person enters their email and gets a one-time link (valid 15 minutes, works once; opening it shows a Sign in button). Links need `RESEND_API_KEY`, `ALERT_FROM` and `APP_URL`. **If email is down or a link does not arrive:** check the Resend dashboard and the function logs for "sign-in link could not be emailed", or IT can print a one-time link: `DATABASE_URL=... npm run login-link -- --email raghav@freshroots.example --url https://<app>`.
- **Add or change a user:** put them in `SEED_USERS` (JSON, see `.env.example`) and run `npm run seed:users` against the production database (`DATABASE_URL=... npm run seed:users`). Re-running with the same email updates name and role. Roles: planner (Raghav), sponsor (Deepa), data (Priya), admin (IT).
- **Remove a user:** in the Neon SQL editor, `update users set active = false where email = '...';`.
- **Rotate secrets:** change in Vercel and redeploy. `SESSION_SECRET` signs everyone out. A person who leaves is deactivated (below), which also voids any link already sent. `CRON_SECRET` must match what Vercel Cron sends (Vercel uses the env var automatically). API keys (`GEMINI_API_KEY`, `RESEND_API_KEY`) take effect on the next run.
- Never paste secrets into tickets or chat. They are not logged by the app.

## 9. Data and hosting

Commercial data (sales, stock, SKU names, decisions) is stored in Neon Postgres and processed on Vercel. Only computed numbers, SKU names and categories are sent to the LLM provider: never user notes, distributor names or raw tables (enforced in code and tested). IT and the CEO must sign off this hosting before go-live. Choose the Neon region nearest India when creating the project (Singapore, `aws-ap-southeast-1`). Neon keeps point-in-time history: to recover from a bad change, restore a branch from a time before it in the Neon console.
