"use client";

import { useRef, useState } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** A CSS colour, normally a token such as var(--st-stockout). */
  color: string;
}

interface Props {
  segments: Segment[];
  title: string;
  centerValue: string;
  centerLabel: string;
  /** The segment that is currently selected (for example the active table filter). */
  activeKey?: string | null;
  onSelect?: (key: string) => void;
  /** How a segment value is written in the legend and the centre (default: the plain number). */
  format?: (v: number) => string;
  testId?: string;
}

const R = 44;
const C = 2 * Math.PI * R;
const GAP = 1.6; // visual gap between segments, in circumference units

/**
 * A donut that draws itself in the first time it is seen, and re-balances smoothly when the numbers change (for
 * example as lines are approved). Segments and legend rows are buttons when `onSelect` is given, so the same chart
 * can drive a filter. Hovering or focusing either one dims the rest and shows the exact figure.
 */
export function Donut({ segments, title, centerValue, centerLabel, activeKey = null, onSelect, format = String, testId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const arcs = useRef<(SVGCircleElement | null)[]>([]);
  const shown = useRef<number[] | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const total = segments.reduce((a, s) => a + s.value, 0);
  const focusKey = hover ?? activeKey;
  const focused = segments.find((s) => s.key === focusKey) ?? null;

  /** Lay the arcs out for a given set of (possibly part-way) values. */
  function render(values: number[]) {
    const sum = values.reduce((a, v) => a + v, 0) || 1;
    let offset = 0;
    values.forEach((v, i) => {
      const el = arcs.current[i];
      if (!el) return;
      const len = Math.max(0, (v / sum) * C - (v > 0 && values.filter((x) => x > 0).length > 1 ? GAP : 0));
      el.setAttribute("stroke-dasharray", `${len} ${C - len}`);
      el.setAttribute("stroke-dashoffset", String(-offset));
      offset += (v / sum) * C;
    });
  }

  useGSAP(
    () => {
      const target = segments.map((s) => s.value);
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(
        { motion: FULL_MOTION_QUERY },
        () => {
          const t = motionTokens();
          const state = { values: (shown.current ?? target.map(() => 0)).slice() };
          // sizes may differ between renders: pad or trim to the new number of segments
          while (state.values.length < target.length) state.values.push(0);
          state.values.length = target.length;
          const from = state.values.slice();
          render(from);
          const tween = () => {
            const o = { p: 0 };
            gsap.to(o, {
              p: 1,
              duration: shown.current ? t.base : t.slow * 1.4,
              ease: t.easeOut,
              onUpdate: () => render(from.map((f, i) => f + ((target[i] ?? 0) - f) * o.p)),
              onComplete: () => { shown.current = target; render(target); },
            });
          };
          if (shown.current) tween();
          else ScrollTrigger.create({ trigger: el, start: "top 92%", once: true, onEnter: tween });
        },
      );
      mm.add("(prefers-reduced-motion: reduce)", () => {
        shown.current = target;
        render(target);
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [segments.map((s) => s.value).join(",")] },
  );

  const pct = (v: number) => (total === 0 ? "0%" : `${Math.round((v / total) * 100)}%`);
  const summary = `${title}: ${segments.map((s) => `${s.label} ${format(s.value)}`).join(", ")}.`;

  return (
    <div className="donut" ref={root} data-testid={testId}>
      <div className="donut-figure">
        <svg viewBox="0 0 120 120" role="img" aria-label={summary}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--gauge-track)" strokeWidth="14" />
          <g transform="rotate(-90 60 60)">
            {segments.map((s, i) => {
              const dim = focusKey !== null && focusKey !== s.key;
              return (
                <circle
                  key={s.key}
                  ref={(n) => { arcs.current[i] = n; }}
                  className="donut-arc"
                  data-testid={testId ? `${testId}-seg-${s.key}` : undefined}
                  cx="60"
                  cy="60"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={focusKey === s.key ? 17 : 14}
                  strokeLinecap="butt"
                  strokeDasharray={`${total === 0 ? 0 : Math.max(0, (s.value / total) * C - GAP)} ${C}`}
                  strokeDashoffset={-(segments.slice(0, i).reduce((a, x) => a + x.value, 0) / (total || 1)) * C}
                  opacity={dim ? 0.28 : 1}
                  style={{ cursor: onSelect ? "pointer" : "default", transition: "opacity .25s, stroke-width .25s" }}
                  tabIndex={onSelect && s.value > 0 ? 0 : -1}
                  role={onSelect ? "button" : undefined}
                  aria-label={onSelect ? `${s.label}: ${format(s.value)}. Show these only` : undefined}
                  aria-pressed={onSelect ? activeKey === s.key : undefined}
                  onPointerEnter={() => setHover(s.key)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(s.key)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect?.(s.key)}
                  onKeyDown={(e) => { if (onSelect && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect(s.key); } }}
                />
              );
            })}
          </g>
        </svg>
        <div className="donut-center" aria-hidden="true">
          <strong className="donut-value" style={{ fontSize: (() => { const n = (focused ? format(focused.value) : centerValue).length; return n <= 3 ? 34 : n <= 5 ? 26 : 20; })() }}>{focused ? format(focused.value) : centerValue}</strong>
          <span className="donut-label">{focused ? `${focused.label} · ${pct(focused.value)}` : centerLabel}</span>
        </div>
      </div>
      <ul className="legend" aria-label={`${title}, legend`}>
        {segments.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              className="legend-row"
              data-active={activeKey === s.key || undefined}
              data-testid={testId ? `${testId}-legend-${s.key}` : undefined}
              onClick={() => onSelect?.(s.key)}
              onPointerEnter={() => setHover(s.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(s.key)}
              onBlur={() => setHover(null)}
              aria-pressed={onSelect ? activeKey === s.key : undefined}
              disabled={!onSelect}
            >
              <i style={{ background: s.color }} aria-hidden="true" />
              <span className="legend-name">{s.label}</span>
              <span className="legend-n num">{format(s.value)}</span>
              <span className="legend-pct num">{pct(s.value)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
