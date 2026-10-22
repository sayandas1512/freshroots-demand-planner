import type { Action, ExceptionType, Flag } from "@/engine/types";

type IconProps = { className?: string };
const svg = { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const IconStockout = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M8 2v9" /><path d="M4 8l4 4 4-4" /><path d="M3 14h10" /></svg>
);
export const IconDemand = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M2 12l4-4 3 3 5-6" /><path d="M10 5h4v4" /></svg>
);
export const IconOverstock = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M2 5h12M2 8h12M2 11h12" /></svg>
);
export const IconPerishable = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M8 14c3.3 0 5-2.2 5-4.6C13 6.6 8 2 8 2S3 6.6 3 9.4C3 11.8 4.7 14 8 14z" /></svg>
);
export const IconHold = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M3 8h10" /></svg>
);
export const IconException = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M8 2l6 6-6 6-6-6z" /><path d="M8 6v3" /><path d="M8 11.5v.01" /></svg>
);
export const IconUrgent = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M9 2L4 9h4l-1 5 5-7H8z" /></svg>
);
export const IconLlm = ({ className }: IconProps) => (
  <svg {...svg} className={className}><path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" /></svg>
);
export const IconTemplate = ({ className }: IconProps) => (
  <svg {...svg} className={className}><rect x="3" y="2" width="10" height="12" rx="1.5" /><path d="M5.5 6h5M5.5 9h5" /></svg>
);

export const ACTION_LABEL: Record<Action, string> = {
  REORDER_NOW: "Reorder now",
  REORDER_1_5X: "Reorder 1.5×",
  PAUSE: "Pause order",
  HOLD: "Hold",
};

export const FLAG_META: Record<Flag, { label: string; chip: string; Icon: (p: IconProps) => React.ReactElement }> = {
  STOCKOUT_RISK: { label: "Stockout risk", chip: "chip-stockout", Icon: IconStockout },
  HIGH_DEMAND: { label: "High demand", chip: "chip-demand", Icon: IconDemand },
  OVERSTOCK_RISK: { label: "Overstock risk", chip: "chip-overstock", Icon: IconOverstock },
};

export const EXCEPTION_LABEL: Record<ExceptionType, string> = {
  new_sku: "New SKU",
  short_history: "Short history",
  missing_stock: "Missing stock",
  zero_demand: "Zero demand",
  anomalous_jump: "Anomalous jump",
  unknown_sku: "Unknown SKU",
  conflicting_signals: "Conflicting signals",
  processing_error: "Processing error",
  distributor_shift: "Distributor shift",
};

export const EXCEPTION_HELP: Record<ExceptionType, string> = {
  new_sku: "No sales history yet. Needs a launch plan, not a rule.",
  short_history: "Fewer weeks of sales than the baseline window needs.",
  missing_stock: "No inventory snapshot for this SKU.",
  zero_demand: "Nothing sold across the baseline window, so cover is undefined.",
  anomalous_jump: "Latest week is far from the weeks before it. Check for a one-off event.",
  unknown_sku: "Rows exist in sales or stock but the SKU is not in the master.",
  conflicting_signals: "High demand and overstock at the same time. The rules cannot judge both.",
  processing_error: "The engine could not evaluate this SKU.",
  distributor_shift: "A distributor's share of this SKU has dropped sharply. Unusual distributor behaviour is a judgment call.",
};

export function Chip({ className, Icon, children, title }: { className: string; Icon?: (p: IconProps) => React.ReactElement; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip ${className}`} title={title}>
      {Icon ? <Icon /> : null}
      {children}
    </span>
  );
}

export function SourceChip({ source }: { source: "llm" | "template" }) {
  return source === "llm" ? (
    <Chip className="chip-plain" Icon={IconLlm} title="Wording written by the language model and checked against the computed numbers">LLM</Chip>
  ) : (
    <Chip className="chip-plain" Icon={IconTemplate} title="Wording from a fixed template">Template</Chip>
  );
}
