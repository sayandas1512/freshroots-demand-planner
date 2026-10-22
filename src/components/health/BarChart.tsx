interface Props {
  rows: { label: string; value: number }[];
  /** Accessible name for the whole chart. */
  title: string;
  barColor?: (label: string) => string;
}

const LABEL_W = 270;
const BAR_H = 18;
const GAP = 8;
const W = 760;
const VALUE_W = 48;

/** Horizontal bars drawn to scale from zero. Labels and values use theme tokens so both themes stay readable. */
export function BarChart({ rows, title, barColor }: Props) {
  if (rows.length === 0) return <p className="muted">No data yet.</p>;
  const max = Math.max(...rows.map((r) => r.value));
  const plotW = W - LABEL_W - VALUE_W;
  const height = rows.length * (BAR_H + GAP) + GAP;
  return (
    <svg className="barchart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} width="100%">
      {rows.map((r, i) => {
        const y = GAP + i * (BAR_H + GAP);
        const w = max === 0 ? 0 : (r.value / max) * plotW;
        return (
          <g key={r.label}>
            <text x={LABEL_W - 8} y={y + BAR_H / 2 + 4} textAnchor="end" fontSize="12" fontFamily="var(--font-mono)" fill="var(--text-muted)">{r.label}</text>
            <rect x={LABEL_W} y={y} width={plotW} height={BAR_H} rx="3" fill="var(--gauge-track)" />
            <rect x={LABEL_W} y={y} width={Math.max(w, r.value > 0 ? 2 : 0)} height={BAR_H} rx="3" fill={barColor?.(r.label) ?? "var(--accent)"} />
            <text x={LABEL_W + plotW + 8} y={y + BAR_H / 2 + 4} fontSize="12" fontFamily="var(--font-mono)" fill="var(--text)">{r.value}</text>
          </g>
        );
      })}
    </svg>
  );
}
