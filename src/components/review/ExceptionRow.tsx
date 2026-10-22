"use client";

import { memo } from "react";
import type { ReviewException } from "@/run/review-types";
import { InlinePanel } from "./InlinePanel";
import { Chip, EXCEPTION_HELP, EXCEPTION_LABEL, IconException } from "./ui";

interface Props {
  item: ReviewException;
  selected: boolean;
  panelOpen: boolean;
  busy: boolean;
  locked: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onOpenPanel: (id: string) => void;
  onClosePanel: () => void;
  onSubmit: (item: ReviewException, note: string) => void;
  onReopen: (item: ReviewException) => void;
}

function ExceptionRowImpl({ item, selected, panelOpen, busy, error, locked, ...cb }: Props) {
  const handled = item.status === "handled";
  return (
    <div
      role="row"
      className="row row-exception"
      data-flip-id={item.id}
      data-stripe="exception"
      data-decided={handled ? "true" : "false"}
      data-testid={`exception-${item.skuId}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={() => cb.onSelect(item.id)}
    >
      <div role="cell" className="cell cell-sku">
        <strong className="sku-name">{item.name ?? "Not in SKU master"}</strong>
        <span className="sku-meta mono">{item.skuId}</span>
      </div>
      <div role="cell" className="cell cell-action">
        <Chip className="chip-exception" Icon={IconException}>{EXCEPTION_LABEL[item.type]}</Chip>
        <span className="faint small">Needs your judgment</span>
      </div>
      <div role="cell" className="cell cell-reason cell-wide">
        <p className="reason">{item.detail}</p>
        <p className="facts">{EXCEPTION_HELP[item.type]}</p>
      </div>
      <div role="cell" className="cell cell-status">
        <span className="status-text" data-status={handled ? "approved" : "pending"}>{handled ? "Handled" : "Open"}</span>
        {item.handledNote ? <span className="note" title={item.handledNote}>{item.handledNote}</span> : null}
        <div className="row-actions">
          {locked ? null : handled ? (
            <button type="button" className="btn btn-sm" onClick={() => cb.onReopen(item)} disabled={busy}>Reopen</button>
          ) : (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => cb.onOpenPanel(item.id)} aria-keyshortcuts="H" title="Mark handled (H)">Mark handled</button>
          )}
        </div>
      </div>
      {panelOpen ? (
        <InlinePanel mode="handle" title={`Handle ${item.skuId}`} busy={busy} error={error} onCancel={cb.onClosePanel} onSubmit={(v) => cb.onSubmit(item, v.reason)} />
      ) : null}
    </div>
  );
}

export const ExceptionRow = memo(ExceptionRowImpl);
