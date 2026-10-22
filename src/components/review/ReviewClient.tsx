"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Flag } from "@/engine/types";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { Flip, gsap, useGSAP } from "@/lib/gsap";
import type { DecisionStatus, ReviewData, ReviewException, ReviewRow, StepState } from "@/run/review-types";
import { ExceptionRow } from "./ExceptionRow";
import { Headline } from "./Headline";
import type { PanelMode } from "./InlinePanel";
import { RecRow, ROW_HEIGHT } from "./RecRow";
import { RunStrip, stripStates } from "./RunStrip";
import { DEFAULT_FILTERS, VIRTUALIZE_ABOVE, visibleRows, type Filters, type SortKey } from "./filters";
import { ACTION_LABEL, Chip, EXCEPTION_LABEL, IconException } from "./ui";
import { useRunEvents } from "./useRunEvents";

interface Props {
  data: ReviewData | null;
  today: string;
  mode: "shadow" | "live";
  killed: boolean;
  canDecide: boolean;
  canExport: boolean;
  canRun: boolean;
}

type Tab = "lines" | "exceptions";
type LiveSteps = Record<string, { status: StepState; detail?: string | null }>;

const SEEN_KEY = "fr-rows-run";

function wasSeen(runId: string): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === runId;
  } catch {
    return false;
  }
}

/** Scroll a windowed list just enough to bring row `index` into view. */
function keepRowVisible(el: HTMLElement, index: number): void {
  const top = index * ROW_HEIGHT;
  if (top < el.scrollTop) el.scrollTop = top;
  else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
}

export function ReviewClient({ data, today, mode, killed, canDecide, canExport, canRun }: Props) {
  const locked = killed || !canDecide;
  const router = useRouter();
  const [rows, setRows] = useState<ReviewRow[]>(data?.rows ?? []);
  const [exceptions, setExceptions] = useState<ReviewException[]>(data?.exceptions ?? []);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortKey>("priority");
  const [tab, setTab] = useState<Tab>("lines");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<{ id: string; mode: PanelMode } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [asOf, setAsOf] = useState(today);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [liveRunId, setLiveRunId] = useState<string | null>(data?.run.status === "running" ? data.run.id : null);
  const [liveSteps, setLiveSteps] = useState<LiveSteps>(data?.run.status === "running" ? (data.run.steps as LiveSteps) : {});

  const listRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportH, setViewportH] = useState(640);
  const flipState = useRef<ReturnType<typeof Flip.getState> | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const run = data?.run ?? null;
  const shown = useMemo(() => visibleRows(rows, filters, sort), [rows, filters, sort]);
  const virtual = shown.length > VIRTUALIZE_ABOVE;
  const viewKey = `${tab}|${sort}|${JSON.stringify(filters)}`;
  const ids = useMemo(() => (tab === "lines" ? shown.map((r) => r.id) : exceptions.map((e) => e.id)), [tab, shown, exceptions]);

  // ---- run progress (real SSE events only)
  useRunEvents(liveRunId, {
    onStep: (e) => {
      setLiveSteps((s) => ({ ...s, [e.step]: { status: e.status, detail: e.detail } }));
      setAnnounce(`${e.step.replaceAll("_", " ")}: ${e.status}`);
    },
    onDone: (e) => {
      setAnnounce(`Run finished: ${e.status.replaceAll("_", " ")}`);
      setLiveRunId(null);
      router.refresh();
    },
    onError: () => {
      setLiveRunId(null);
      setMessage("Lost the live connection to the run. Refreshing to show where it got to.");
      router.refresh();
    },
  });

  async function startRun() {
    setStarting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asOf }) });
      const json = (await res.json()) as { runId?: string; reason?: string; error?: string };
      if (!res.ok || !json.runId) {
        setMessage(json.error ?? "Could not start the run.");
        return;
      }
      if (json.reason === "existing") {
        setMessage("A run for this date was already made in the last 10 minutes. Showing it.");
        router.refresh();
      } else {
        if (json.reason === "in_progress") setMessage("Another run is already in progress. Following it.");
        setLiveSteps({});
        setLiveRunId(json.runId);
      }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  // ---- decision timing: batch "first viewed" marks to the server
  const viewQueue = useRef(new Set<string>());
  const viewSent = useRef(new Set<string>());
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markViewed = useCallback((id: string) => {
    if (viewSent.current.has(id)) return;
    viewSent.current.add(id);
    viewQueue.current.add(id);
    viewTimer.current ??= setTimeout(() => {
      viewTimer.current = null;
      const ids = [...viewQueue.current].slice(0, 100);
      viewQueue.current = new Set([...viewQueue.current].slice(100));
      if (ids.length > 0) void fetch("/api/recommendations/viewed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }), keepalive: true }).catch(() => undefined);
    }, 1500);
  }, []);

  // ---- decisions
  const patchRow = useCallback((id: string, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))), []);

  async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return { ok: true };
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error ?? "The server rejected that change." };
    } catch {
      return { ok: false, error: "Could not reach the server. Nothing was saved." };
    }
  }

  const approve = useCallback(async (row: ReviewRow) => {
    const before = { status: row.status, finalQty: row.finalQty, decidedNote: row.decidedNote };
    patchRow(row.id, { status: "approved", finalQty: row.qty, decidedNote: null });
    setAnnounce(`${row.name} approved`);
    const r = await post(`/api/recommendations/${row.id}/decision`, { action: "approve" });
    if (!r.ok) {
      patchRow(row.id, before);
      setMessage(r.error ?? "Could not approve.");
      setAnnounce(`Could not approve ${row.name}`);
    }
  }, [patchRow]);

  const undo = useCallback(async (row: ReviewRow) => {
    const before = { status: row.status, finalQty: row.finalQty, decidedNote: row.decidedNote };
    patchRow(row.id, { status: "pending", finalQty: null, decidedNote: null });
    setAnnounce(`${row.name} decision undone`);
    const r = await post(`/api/recommendations/${row.id}/decision`, { action: "undo" });
    if (!r.ok) {
      patchRow(row.id, before);
      setMessage(r.error ?? "Could not undo.");
    }
  }, [patchRow]);

  async function submitPanel(row: ReviewRow, mode: PanelMode, value: { qty?: number; reason: string }) {
    setBusyId(row.id);
    setPanelError(null);
    const body = mode === "edit" ? { action: "edit", qty: value.qty, reason: value.reason } : { action: "reject", reason: value.reason };
    const r = await post(`/api/recommendations/${row.id}/decision`, body);
    setBusyId(null);
    if (!r.ok) {
      setPanelError(r.error ?? "Could not save.");
      return;
    }
    if (mode === "edit") {
      patchRow(row.id, { status: "edited", finalQty: value.qty ?? null, decidedNote: value.reason });
      setAnnounce(`${row.name} quantity changed to ${value.qty}`);
    } else {
      patchRow(row.id, { status: "rejected", finalQty: null, decidedNote: value.reason });
      setAnnounce(`${row.name} rejected`);
    }
    setPanel(null);
  }

  async function handleException(item: ReviewException, note: string) {
    setBusyId(item.id);
    setPanelError(null);
    const r = await post(`/api/exceptions/${item.id}/handle`, { action: "handle", note });
    setBusyId(null);
    if (!r.ok) {
      setPanelError(r.error ?? "Could not save.");
      return;
    }
    setExceptions((xs) => xs.map((x) => (x.id === item.id ? { ...x, status: "handled", handledNote: note } : x)));
    setAnnounce(`${item.skuId} marked handled`);
    setPanel(null);
  }

  async function reopenException(item: ReviewException) {
    setBusyId(item.id);
    const r = await post(`/api/exceptions/${item.id}/handle`, { action: "reopen" });
    setBusyId(null);
    if (r.ok) setExceptions((xs) => xs.map((x) => (x.id === item.id ? { ...x, status: "open", handledNote: null } : x)));
    else setMessage(r.error ?? "Could not reopen.");
  }

  // ---- filtering and sorting glide rows with Flip
  const changeView = useCallback(
    (update: () => void) => {
      if (!virtual && listRef.current) flipState.current = Flip.getState(listRef.current.querySelectorAll("[data-flip-id]"));
      update();
    },
    [virtual],
  );

  useGSAP(
    () => {
      const state = flipState.current;
      if (!state) return;
      flipState.current = null;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        Flip.from(state, { duration: t.base, ease: t.easeOut, onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: t.base }) });
      });
    },
    { scope: listRef, dependencies: [viewKey] },
  );

  // new rows from a fresh run stagger in, once
  useGSAP(
    () => {
      if (!run || wasSeen(run.id) || rows.length === 0) return;
      const runId = run.id;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const els = [...(listRef.current?.querySelectorAll(".row") ?? [])].slice(0, 30);
        gsap.from(els, {
          opacity: 0,
          y: 12,
          duration: t.base,
          ease: t.easeOut,
          stagger: 0.025,
          clearProps: "opacity,transform",
          onComplete: () => {
            try {
              sessionStorage.setItem(SEEN_KEY, runId);
            } catch {
              /* storage unavailable: the entrance may replay on reload */
            }
          },
        });
      });
    },
    { scope: listRef, dependencies: [run?.id] },
  );

  useEffect(() => {
    if (!scroller) return;
    const measure = () => setViewportH(scroller.clientHeight || 640);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  // ---- keyboard: J/K move, A approve, E edit, R reject, U undo, H handle exception
  const selectedRow = tab === "lines" ? rows.find((r) => r.id === selectedId) : undefined;
  const selectedException = tab === "exceptions" ? exceptions.find((e) => e.id === selectedId) : undefined;

  const move = useCallback(
    (delta: number) => {
      if (ids.length === 0) return;
      const index = selectedId ? ids.indexOf(selectedId) : -1;
      const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
      if (!next) return;
      setSelectedId(next);
      const at = ids.indexOf(next);
      if (virtual && scroller) keepRowVisible(scroller, at);
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-flip-id="${next}"]`);
        el?.focus({ preventScroll: virtual });
        if (!virtual) el?.scrollIntoView({ block: "nearest" });
      });
    },
    [ids, selectedId, virtual, scroller],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "j") move(1);
      else if (key === "k") move(-1);
      else if (locked) return;
      else if (key === "a" && selectedRow && selectedRow.status === "pending") void approve(selectedRow);
      else if (key === "e" && selectedRow && selectedRow.status === "pending") setPanel({ id: selectedRow.id, mode: "edit" });
      else if (key === "r" && selectedRow && selectedRow.status === "pending") setPanel({ id: selectedRow.id, mode: "reject" });
      else if (key === "u" && selectedRow && selectedRow.status !== "pending") void undo(selectedRow);
      else if (key === "h" && selectedException && selectedException.status === "open") setPanel({ id: selectedException.id, mode: "handle" });
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, selectedRow, selectedException, approve, undo, locked]);

  // ---- derived display state
  const live = liveRunId !== null;
  const steps = (live ? liveSteps : (run?.steps ?? {})) as LiveSteps;
  const strip = stripStates(steps, live || run !== null);
  const decided = rows.filter((r) => r.status !== "pending").length;
  const exportable = rows.filter((r) => (r.status === "approved" || r.status === "edited") && (r.finalQty ?? 0) > 0).length;
  const openExceptions = exceptions.filter((e) => e.status === "open").length;
  const countBy = (s: DecisionStatus) => rows.filter((r) => r.status === s).length;
  const actionCounts = (a: Action) => rows.filter((r) => r.action === a).length;

  const range = (() => {
    if (!virtual) return { start: 0, end: shown.length };
    return { start: Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 3), end: Math.min(shown.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + 3) };
  })();

  const rowProps = (row: ReviewRow) => ({
    row,
    runId: run?.id ?? "",
    selected: selectedId === row.id,
    virtual,
    locked,
    onViewed: markViewed,
    scroller,
    panel: panel?.id === row.id ? panel.mode : null,
    busy: busyId === row.id,
    error: panel?.id === row.id ? panelError : null,
    onSelect: setSelectedId,
    onApprove: approve,
    onUndo: undo,
    onOpenPanel: (id: string, mode: PanelMode) => {
      setPanelError(null);
      setPanel({ id, mode });
      setSelectedId(id);
    },
    onClosePanel: () => setPanel(null),
    onSubmitPanel: submitPanel,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Review {mode === "shadow" ? <span className="chip chip-demand shadow-title">SHADOW</span> : null}</h1>
          {run ? (
            <p>
              Run for <strong className="num">{run.asOf}</strong> · rules v{run.configVersion ?? "?"} · festival uplift mode <code>{run.festivalMode ?? "cover_demand"}</code> · {run.trigger === "cron" ? "scheduled" : "started manually"}
            </p>
          ) : (
            <p>Nothing has been run yet.</p>
          )}
        </div>
        <form
          className="run-controls"
          onSubmit={(e) => {
            e.preventDefault();
            void startRun();
          }}
        >
          <label className="field">
            <span className="small muted">Run date</span>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required aria-label="Run date" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={starting || live || !canRun || killed} data-testid="run-now" title={killed ? "The kill switch is on" : undefined}>
            {live ? <><span className="spinner" aria-hidden="true" /> Running…</> : "Run now"}
          </button>
        </form>
      </div>

      <div className="sr-only" role="status" aria-live="polite" data-testid="live-region">{announce}</div>

      {locked && !killed ? <div className="banner banner-info" role="note"><span>You have read-only access to Review. Only a planner or admin can approve, edit or reject lines.</span></div> : null}
      {mode === "shadow" ? <div className="banner banner-warn" role="note" data-testid="shadow-banner"><span><strong>Shadow mode.</strong> Runs, sheets and reviews work and your overrides are logged, but the purchase-order export is blocked until go-live.</span></div> : null}
      {message ? <div className="banner banner-info" role="status"><span>{message}</span></div> : null}
      {run?.status === "failed" ? <div className="banner banner-bad" role="alert"><span><strong>This run failed.</strong> {run.notes.at(-1) ?? "See the runbook in the README."}</span></div> : null}
      {run?.status === "completed_degraded" ? (
        <div className="banner banner-warn" role="status" data-testid="degraded-banner">
          <span>
            <strong>This run completed with warnings.</strong>{" "}
            {run.notes.length > 0 ? run.notes.join(" ") : run.llmStatus === "failed" || run.llmStatus === "partial" ? "Some wording fell back to templates because the language model was unavailable or failed validation. The numbers and actions are unaffected." : ""}
          </span>
        </div>
      ) : null}

      <RunStrip states={strip} triggerLabel={run?.trigger === "cron" ? "Scheduled" : "Run now"} live={live} />

      {!run ? (
        <div className="card empty">
          <h3>No runs yet</h3>
          <p>Load the SAP extracts on the Data page, then press Run now. Runs also happen on their own every Monday and Thursday at 07:00 IST.</p>
        </div>
      ) : run.status === "running" || live ? (
        <div className="card empty" aria-busy="true">
          <h3>Building the recommendation sheet</h3>
          <p>The sheet appears here once it is saved. Nothing is shown or exported before then.</p>
        </div>
      ) : (
        <>
          {data?.headline ? <Headline runId={run.id} lines={data.headline.lines} source={data.headline.source} /> : null}

          <details className="help">
            <summary>How the action is chosen</summary>
            <ol>
              <li><strong>Overstock and high demand together:</strong> no recommendation. The line goes to Exceptions as conflicting signals.</li>
              <li><strong>High demand</strong> (last {rows[0]?.metrics.recentWeeks ?? 4} weeks above the baseline by more than the ratio): reorder 1.5× the standard quantity. With a stockout risk too, the line is also marked urgent.</li>
              <li><strong>Stockout risk</strong> (cover below the minimum): reorder the standard quantity now.</li>
              <li><strong>Overstock risk</strong> (cover above the maximum): pause the next order.</li>
              <li>Otherwise: hold. Perishable SKUs use their own tighter cover window. Nothing reaches procurement until a line is approved.</li>
            </ol>
          </details>

          <div className="tabs" role="tablist" aria-label="Review sections">
            <button role="tab" type="button" aria-selected={tab === "lines"} className="tab" onClick={() => { setTab("lines"); setSelectedId(null); setPanel(null); }}>
              Recommendations <span className="count num">{rows.length}</span>
            </button>
            <button role="tab" type="button" aria-selected={tab === "exceptions"} className="tab" onClick={() => { setTab("exceptions"); setSelectedId(null); setPanel(null); }} data-testid="tab-exceptions">
              Exceptions <span className={`count num ${openExceptions > 0 ? "count-exc" : ""}`}>{openExceptions}</span>
            </button>
            <span className="shell-spacer" />
            <span className="summary small muted num">
              {actionCounts("REORDER_NOW") + actionCounts("REORDER_1_5X")} reorder · {actionCounts("PAUSE")} pause · {actionCounts("HOLD")} hold
            </span>
          </div>

          {tab === "lines" ? (
            <>
              <div className="filters" role="group" aria-label="Filters">
                <label className="field"><span className="small muted">Action</span>
                  <select aria-label="Filter by action" value={filters.action} onChange={(e) => changeView(() => setFilters({ ...filters, action: e.target.value as Filters["action"] }))}>
                    <option value="all">All actions</option>
                    {(Object.keys(ACTION_LABEL) as Action[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                  </select>
                </label>
                <label className="field"><span className="small muted">Flag</span>
                  <select aria-label="Filter by flag" value={filters.flag} onChange={(e) => changeView(() => setFilters({ ...filters, flag: e.target.value as Flag | "HOLD" | "all" }))}>
                    <option value="all">All flags</option>
                    <option value="STOCKOUT_RISK">Stockout risk</option>
                    <option value="HIGH_DEMAND">High demand</option>
                    <option value="OVERSTOCK_RISK">Overstock risk</option>
                    <option value="HOLD">No flag</option>
                  </select>
                </label>
                <label className="field"><span className="small muted">Perishable</span>
                  <select aria-label="Filter by perishability" value={filters.perishable} onChange={(e) => changeView(() => setFilters({ ...filters, perishable: e.target.value as Filters["perishable"] }))}>
                    <option value="all">Any</option><option value="yes">Perishable</option><option value="no">Not perishable</option>
                  </select>
                </label>
                <label className="field"><span className="small muted">Status</span>
                  <select aria-label="Filter by status" value={filters.status} onChange={(e) => changeView(() => setFilters({ ...filters, status: e.target.value as Filters["status"] }))}>
                    <option value="all">Any</option><option value="pending">Pending ({countBy("pending")})</option><option value="approved">Approved ({countBy("approved")})</option><option value="edited">Edited ({countBy("edited")})</option><option value="rejected">Rejected ({countBy("rejected")})</option>
                  </select>
                </label>
                <label className="field"><span className="small muted">Sort</span>
                  <select aria-label="Sort lines" value={sort} onChange={(e) => changeView(() => setSort(e.target.value as SortKey))}>
                    <option value="priority">Priority</option><option value="cover">Lowest cover</option><option value="sku">SKU</option><option value="status">Status</option>
                  </select>
                </label>
                <span className="shell-spacer" />
                <span className="small muted kbd-help">Keys: <kbd>J</kbd>/<kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>E</kbd> edit · <kbd>R</kbd> reject · <kbd>U</kbd> undo</span>
              </div>

              <div className="table" role="table" aria-label="Recommendations" aria-rowcount={shown.length + 1}>
                <div role="row" className="row row-head">
                  <div role="columnheader">SKU</div><div role="columnheader">Action</div><div role="columnheader">Flags</div><div role="columnheader">Cover vs thresholds (weeks)</div><div role="columnheader">Reason and numbers</div><div role="columnheader">Source</div><div role="columnheader">Status</div>
                </div>
                {shown.length === 0 ? (
                  <div className="empty"><h3>No lines match these filters</h3><p>Clear a filter to see more.</p></div>
                ) : virtual ? (
                  <div className="virtual-scroller" ref={setScroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} data-testid="virtual-scroller">
                    <div className="virtual-inner" ref={listRef} style={{ height: shown.length * ROW_HEIGHT }}>
                      {shown.slice(range.start, range.end).map((row, i) => (
                        <RecRow key={row.id} {...rowProps(row)} style={{ position: "absolute", left: 0, right: 0, top: 0, height: ROW_HEIGHT, transform: `translateY(${(range.start + i) * ROW_HEIGHT}px)` }} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div ref={listRef} role="rowgroup">
                    {shown.map((row) => <RecRow key={row.id} {...rowProps(row)} />)}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="table" role="table" aria-label="Exceptions">
              {exceptions.length === 0 ? (
                <div className="empty"><h3>No exceptions</h3><p>Every SKU had enough clean data for the rules to judge.</p></div>
              ) : (
                <div ref={listRef} role="rowgroup">
                  {exceptions.map((item) => (
                    <ExceptionRow
                      key={item.id}
                      item={item}
                      selected={selectedId === item.id}
                      panelOpen={panel?.id === item.id}
                      busy={busyId === item.id}
                      locked={locked}
                      error={panel?.id === item.id ? panelError : null}
                      onSelect={setSelectedId}
                      onOpenPanel={(id) => { setPanelError(null); setPanel({ id, mode: "handle" }); setSelectedId(id); }}
                      onClosePanel={() => setPanel(null)}
                      onSubmit={handleException}
                      onReopen={reopenException}
                    />
                  ))}
                </div>
              )}
              <p className="small muted legend"><Chip className="chip-exception" Icon={IconException}>Exceptions</Chip> are lines the rules cannot judge: {Object.values(EXCEPTION_LABEL).join(", ").toLowerCase()}.</p>
            </div>
          )}

          <div className="footer-bar" role="region" aria-label="Decision progress">
            <div className="progress" aria-hidden="true"><span style={{ transform: `scaleX(${rows.length === 0 ? 0 : decided / rows.length})` }} /></div>
            <span className="num" data-testid="decided-count"><strong>{decided}</strong> of <strong>{rows.length}</strong> decided</span>
            <span className="small muted num">{countBy("approved")} approved · {countBy("edited")} edited · {countBy("rejected")} rejected{exceptions.length > 0 ? ` · ${openExceptions} exceptions open` : ""}</span>
            <span className="shell-spacer" />
            {mode === "shadow" ? (
              <button type="button" className="btn btn-primary" disabled data-testid="export-link" title="Shadow mode: runs and reviews work, but nothing goes to procurement">Export blocked: shadow mode</button>
            ) : killed ? (
              <button type="button" className="btn btn-primary" disabled data-testid="export-link">Export stopped: kill switch</button>
            ) : !canExport ? (
              <button type="button" className="btn btn-primary" disabled data-testid="export-link" title="Only a planner or admin can export">Export (planner only)</button>
            ) : exportable > 0 ? (
              <a className="btn btn-primary" href={`/export?run=${run.id}`} data-testid="export-link">Export approved ({exportable})</a>
            ) : (
              <button type="button" className="btn btn-primary" disabled data-testid="export-link" title="Approve or edit a line with a quantity first">Export approved (0)</button>
            )}
          </div>
        </>
      )}
    </>
  );
}
