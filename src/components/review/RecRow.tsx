"use client";

import { memo, useRef } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { gsap, useGSAP } from "@/lib/gsap";
import type { ReviewRow } from "@/run/review-types";
import { CoverGauge } from "./CoverGauge";
import { InlinePanel, type PanelMode } from "./InlinePanel";
import { ACTION_LABEL, Chip, FLAG_META, IconHold, IconPerishable, IconUrgent, SourceChip } from "./ui";

export const ROW_HEIGHT = 124;

interface Props {
  row: ReviewRow;
  runId: string;
  selected: boolean;
  virtual: boolean;
  locked: boolean;
  scroller: HTMLElement | null;
  panel: PanelMode | null;
  busy: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onApprove: (row: ReviewRow) => void;
  onUndo: (row: ReviewRow) => void;
  onOpenPanel: (id: string, mode: PanelMode) => void;
  onClosePanel: () => void;
  onSubmitPanel: (row: ReviewRow, mode: PanelMode, value: { qty?: number; reason: string }) => void;
  style?: React.CSSProperties;
}

const num = (v: number, dp = 1) => v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const int = (v: number) => v.toLocaleString("en-IN");

function stripeFor(row: ReviewRow): string {
  if (row.flags.includes("STOCKOUT_RISK")) return "stockout";
  if (row.flags.includes("HIGH_DEMAND")) return "demand";
  if (row.flags.includes("OVERSTOCK_RISK")) return "overstock";
  return "hold";
}

const STATUS_TEXT: Record<ReviewRow["status"], string> = { pending: "Pending", approved: "Approved", edited: "Edited", rejected: "Rejected" };

function RecRowImpl(props: Props) {
  const { row, selected, panel, busy, error, virtual } = props;
  const m = row.metrics;
  const rowRef = useRef<HTMLDivElement>(null);
  const prevStatus = useRef(row.status);
  const decided = row.status !== "pending";

  useGSAP(
    () => {
      if (prevStatus.current !== "approved" && row.status === "approved") {
        const mm = gsap.matchMedia();
        mm.add(FULL_MOTION_QUERY, () => {
          const t = motionTokens();
          gsap.fromTo(rowRef.current?.querySelector("[data-check]") ?? null, { drawSVG: "0%" }, { drawSVG: "100%", duration: t.base, ease: t.easeOut });
        });
      }
      prevStatus.current = row.status;
    },
    { scope: rowRef, dependencies: [row.status] },
  );

  const stripe = stripeFor(row);
  const qtyShown = row.status === "edited" && row.finalQty !== null ? row.finalQty : row.qty;

  return (
    <div
      ref={rowRef}
      role="row"
      className="row"
      data-flip-id={row.id}
      data-stripe={stripe}
      data-urgent={m.urgent ? "true" : "false"}
      data-decided={decided ? "true" : "false"}
      data-status={row.status}
      data-testid={`row-${row.skuId}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => props.onSelect(row.id)}
      style={props.style}
    >
      <div role="cell" className="cell cell-sku">
        <strong className="sku-name">{row.name}</strong>
        <span className="sku-meta mono">{row.skuId} · {row.category}</span>
        {m.perishable ? <Chip className="chip-perish" Icon={IconPerishable}>Perishable</Chip> : null}
      </div>

      <div role="cell" className="cell cell-action">
        <span className="action-label" data-action={row.action}>{ACTION_LABEL[row.action]}</span>
        {qtyShown !== null ? (
          <span className="action-qty num">{int(qtyShown)} <span className="faint">{row.unit}</span>{row.status === "edited" ? <span className="edited-from"> was {int(row.qty ?? 0)}</span> : null}</span>
        ) : (
          <span className="action-qty faint">no order</span>
        )}
        {m.urgent ? <Chip className="chip-stockout" Icon={IconUrgent}>Urgent</Chip> : null}
      </div>

      <div role="cell" className="cell cell-flags">
        {row.flags.length === 0 ? <Chip className="chip-hold" Icon={IconHold}>Hold</Chip> : row.flags.map((f) => <Chip key={f} className={FLAG_META[f].chip} Icon={FLAG_META[f].Icon}>{FLAG_META[f].label}</Chip>)}
      </div>

      <div role="cell" className="cell cell-cover">
        <CoverGauge cover={m.coverWeeks} min={m.coverMin} max={m.coverMax} perishable={m.perishable} animateKey={`${props.runId}:${row.id}`} mountAnimate={virtual} scroller={props.scroller} />
        <span className="cover-sub num">
          stock {int(m.stockOnHand)} · open PO {int(m.openPoQty)}{m.openPoQty > 0 ? (m.includeOpenPoInStock ? " (counted)" : " (not counted)") : ""}
        </span>
      </div>

      <div role="cell" className="cell cell-reason">
        <p className="reason" title={row.explanation}>{row.explanation}</p>
        <p className="facts num">
          <code className="rule">{row.ruleFired}</code> · avg{m.baselineWeeks} {num(m.avgBaseline)} · recent{m.recentWeeks} {num(m.avgRecent)} · ratio {num(m.ratio, 2)}/{num(m.ratioThreshold, 2)} · cover {num(m.coverWeeks)} vs {m.coverMin}–{m.coverMax}
          {m.festival ? ` · festival +${Math.round(m.upliftApplied * 100)}% (${m.upliftMode})` : ""}
        </p>
      </div>

      <div role="cell" className="cell cell-source"><SourceChip source={row.source} /></div>

      <div role="cell" className="cell cell-status">
        <span className="status-text" data-status={row.status}>
          <svg className="check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path data-check d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ visibility: row.status === "approved" ? "visible" : "hidden" }} />
          </svg>
          {STATUS_TEXT[row.status]}
        </span>
        {row.decidedNote ? <span className="note" title={row.decidedNote}>{row.decidedNote}</span> : null}
        <div className="row-actions">
          {props.locked ? null : decided ? (
            <button type="button" className="btn btn-sm" onClick={() => props.onUndo(row)} disabled={busy}>Undo</button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => props.onApprove(row)} disabled={busy} aria-keyshortcuts="A" title="Approve (A)">Approve</button>
              <button type="button" className="btn btn-sm" onClick={() => props.onOpenPanel(row.id, "edit")} aria-keyshortcuts="E" title="Edit quantity (E)">Edit</button>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => props.onOpenPanel(row.id, "reject")} aria-keyshortcuts="R" title="Reject (R)">Reject</button>
            </>
          )}
        </div>
      </div>

      {panel ? (
        <InlinePanel
          mode={panel}
          title={`${panel === "edit" ? "Edit" : "Reject"} ${row.name}`}
          initialQty={row.qty}
          unit={row.unit}
          busy={busy}
          error={error}
          onCancel={props.onClosePanel}
          onSubmit={(value) => props.onSubmitPanel(row, panel, value)}
        />
      ) : null}
    </div>
  );
}

export const RecRow = memo(RecRowImpl);
