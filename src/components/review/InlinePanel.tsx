"use client";

import { useEffect, useRef, useState } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { gsap, useGSAP } from "@/lib/gsap";

export type PanelMode = "edit" | "reject" | "handle";

interface Props {
  mode: PanelMode;
  title: string;
  initialQty?: number | null;
  unit?: string;
  onSubmit: (value: { qty?: number; reason: string }) => void;
  onCancel: () => void;
  busy?: boolean;
  error?: string | null;
}

const COPY: Record<PanelMode, { reasonLabel: string; submit: string; hint: string }> = {
  edit: { reasonLabel: "Why are you changing the quantity?", submit: "Save edit", hint: "Your reason is stored in the override log." },
  reject: { reasonLabel: "Why are you rejecting this line?", submit: "Reject line", hint: "A reason is required. It is stored in the override log." },
  handle: { reasonLabel: "How was this handled?", submit: "Mark handled", hint: "A short note helps document the judgment call." },
};

/**
 * Inline editor that opens over the row. Height and opacity tween in with gsap.from and reverse on close,
 * so opening it never moves any other row.
 */
export function InlinePanel({ mode, title, initialQty, unit, onSubmit, onCancel, busy, error }: Props) {
  const root = useRef<HTMLFormElement>(null);
  const tl = useRef<gsap.core.Tween | null>(null);
  const [qty, setQty] = useState(initialQty ? String(initialQty) : "");
  const [reason, setReason] = useState("");
  const copy = COPY[mode];

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        tl.current = gsap.from(root.current, { height: 0, opacity: 0, duration: t.base, ease: t.easeOut, clearProps: "height" });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  useEffect(() => {
    root.current?.querySelector<HTMLElement>(mode === "edit" ? "input[name=qty]" : "textarea")?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: "nearest" });
  }, [mode]);

  function close() {
    if (tl.current) {
      tl.current.eventCallback("onReverseComplete", onCancel);
      tl.current.reverse();
    } else onCancel();
  }

  const qtyValue = Number(qty);
  const qtyOk = mode !== "edit" || (Number.isInteger(qtyValue) && qtyValue >= 1);
  const reasonOk = reason.trim().length >= 3;

  return (
    <form
      ref={root}
      className="inline-panel"
      aria-label={title}
      onSubmit={(e) => {
        e.preventDefault();
        if (qtyOk && reasonOk && !busy) onSubmit({ ...(mode === "edit" ? { qty: qtyValue } : {}), reason: reason.trim() });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="inline-panel-body">
        <strong>{title}</strong>
        {mode === "edit" ? (
          <label className="field">
            New quantity{unit ? ` (${unit})` : ""}
            <input name="qty" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} required />
          </label>
        ) : null}
        <label className="field">
          {copy.reasonLabel}
          <textarea name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
          <span className="hint">{copy.hint}</span>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="inline-panel-actions">
          <button type="button" className="btn btn-sm" onClick={close}>Cancel</button>
          <button type="submit" className={`btn btn-sm ${mode === "reject" ? "btn-danger" : "btn-primary"}`} disabled={!qtyOk || !reasonOk || busy}>{copy.submit}</button>
        </div>
      </div>
    </form>
  );
}
