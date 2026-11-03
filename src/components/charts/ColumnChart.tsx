"use client";

import { useRef, useState } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { niceScale } from "./scale";

export interface Stack {
  key: string;
  label: string;
  value: number;
  color: string;
  /** What the stack is made of, shown in the tooltip (for example SKU names). */
  items?: string[];
}
export interface Column {
  label: string;
  stacks: Stack[];
}

interface Props {
  columns: Column[];
  title: string;
  /** Formats a stack value for the tooltip and the axis. */
  format?: (v: number) => string;
  legend?: { label: string; color: string }[];
  testId?: string;
}

const W = 640;
const H = 230;
const M = { l: 52, r: 12, t: 14, b: 34 };

/** Stacked columns that grow from the baseline when first seen. Hover or focus a column to list what is in it. */
export function ColumnChart({ columns, title, format = (v) => String(v), legend, testId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const totals = columns.map((c) => c.stacks.reduce((a, s) => a + s.value, 0));
  const scale = niceScale(Math.max(1, ...totals) * 1.04, 3);
  const max = scale.max;
  const slot = (W - M.l - M.r) / Math.max(1, columns.length);
  const bw = Math.min(64, slot * 0.62);
  const y = (v: number) => H - M.b - (v / max) * (H - M.t - M.b);
  const ticks = scale.ticks;

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const bars = el.querySelectorAll(".cc-bar");
        gsap.set(bars, { scaleY: 0, transformOrigin: "50% 100%" });
        ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => gsap.to(bars, { scaleY: 1, duration: t.slow * 1.2, stagger: 0.07, ease: "back.out(1.3)" }) });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [totals.join(",")] },
  );

  const col = active === null ? null : (columns[active] as Column);
  return (
    <div className="chart" ref={root} data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${columns.map((c, i) => `${c.label}: ${format(totals[i] as number)}`).join("; ")}.`} onPointerLeave={() => setActive(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="tc-axis">{format(Math.round(v))}</text>
          </g>
        ))}
        {columns.map((c, i) => {
          const cx = M.l + slot * i + slot / 2;
          let acc = 0;
          return (
            <g key={c.label} opacity={active === null || active === i ? 1 : 0.4} style={{ transition: "opacity .2s" }}>
              {c.stacks.map((s) => {
                const y1 = y(acc + s.value);
                const h = y(acc) - y1;
                acc += s.value;
                return s.value > 0 ? <rect key={s.key} className="cc-bar" x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, h - 1)} rx="3" fill={s.color} /> : null;
              })}
              <rect x={cx - slot / 2} y={M.t} width={slot} height={H - M.t - M.b} fill="transparent" tabIndex={0} role="img" aria-label={`${c.label}: ${c.stacks.map((s) => `${s.label} ${format(s.value)}`).join(", ")}`} style={{ outline: "none" }} onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
              <text x={cx} y={H - 12} textAnchor="middle" className="tc-axis">{c.label}</text>
            </g>
          );
        })}
      </svg>
      {col !== null && active !== null ? (
        <div className="chart-tip chart-tip-wide" role="status" style={{ left: `${((M.l + slot * active + slot / 2) / W) * 100}%`, top: `${(y(totals[active] as number) / H) * 100}%` }}>
          <b>{col.label}</b>
          {col.stacks.filter((s) => s.value > 0).map((s) => (
            <span key={s.key}><i style={{ background: s.color }} aria-hidden="true" />{s.label}: {format(s.value)}{s.items && s.items.length > 0 ? <small>{s.items.slice(0, 6).join(", ")}{s.items.length > 6 ? `, +${s.items.length - 6} more` : ""}</small> : null}</span>
          ))}
        </div>
      ) : null}
      {legend ? <ul className="legend legend-inline" aria-hidden="true">{legend.map((l) => <li key={l.label}><span className="legend-row"><i style={{ background: l.color }} /><span className="legend-name">{l.label}</span></span></li>)}</ul> : null}
    </div>
  );
}
