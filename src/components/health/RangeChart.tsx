interface Entry {
  label: string;
  value: number;
}

interface Props {
  title: string;
  /** The brief's baseline range in INR. */
  low: number;
  high: number;
  entries: Entry[];
}

const W = 640;
const PAD_L = 90;
const PAD_R = 24;
const ROW = 26;

const lakh = (inr: number) => `${(inr / 100_000).toFixed(1)}`;

/** The brief's range is a shaded band; each quarter is a dot on the same axis, in lakh. Lower is better. */
export function RangeChart({ title, low, high, entries }: Props) {
  const axisMax = Math.max(high * 1.25, ...entries.map((e) => e.value * 1.1));
  const plotW = W - PAD_L - PAD_R;
  const x = (v: number) => PAD_L + (v / axisMax) * plotW;
  const height = 36 + Math.max(entries.length, 1) * ROW;
  const ticks = Array.from({ length: 5 }, (_, i) => (axisMax / 4) * i);
  return (
    <svg className="rangechart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}. Brief baseline ${lakh(low)} to ${lakh(high)} lakh. ${entries.map((e) => `${e.label} ${lakh(e.value)} lakh`).join(", ") || "No quarters entered yet"}.`} width="100%">
      <rect x={x(low)} y={6} width={x(high) - x(low)} height={height - 36} fill="var(--st-demand-bg)" stroke="var(--st-demand-mark)" strokeDasharray="4 3" />
      <text x={(x(low) + x(high)) / 2} y={18} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--st-demand)">brief: {lakh(low)} to {lakh(high)}</text>
      {entries.map((e, i) => (
        <g key={e.label}>
          <text x={PAD_L - 10} y={36 + i * ROW + 4} textAnchor="end" fontSize="12" fontFamily="var(--font-mono)" fill="var(--text-muted)">{e.label}</text>
          <line x1={PAD_L} x2={x(e.value)} y1={36 + i * ROW} y2={36 + i * ROW} stroke="var(--border-strong)" />
          <circle cx={x(e.value)} cy={36 + i * ROW} r="6" fill={e.value > high ? "var(--st-stockout)" : "var(--accent)"} />
          <text x={x(e.value) + 10} y={36 + i * ROW + 4} fontSize="12" fontFamily="var(--font-mono)" fill="var(--text)">{lakh(e.value)}</text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={height - 18} y2={height - 18} stroke="var(--border-strong)" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={height - 18} y2={height - 14} stroke="var(--border-strong)" />
          <text x={x(t)} y={height - 3} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono)" fill="var(--text-muted)">{lakh(t)}</text>
        </g>
      ))}
    </svg>
  );
}
