"use client";

import { useRef } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";

interface Props {
  /** Percent worse than the baseline; null when it cannot be judged yet. */
  value: number | null;
  warnPct: number;
  killPct: number;
  title: string;
  detail: string;
  testId?: string;
}

const CX = 100;
const CY = 96;
const R = 78;
const MIN = -20;
const MAX_FACTOR = 2; // the dial ends at twice the stopping line

const polar = (deg: number, r = R) => ({ x: CX + r * Math.cos((Math.PI * (180 + deg)) / 180), y: CY + r * Math.sin((Math.PI * (180 + deg)) / 180) });
const arc = (a: number, b: number, r = R) => {
  const p = polar(a, r);
  const q = polar(b, r);
  return `M${p.x.toFixed(2)} ${p.y.toFixed(2)} A${r} ${r} 0 0 1 ${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
};

/**
 * A half-circle dial from -20% to twice the stopping line. Green is fine, amber warns, red stops. The needle swings to
 * how much worse the last four weeks are than the baseline, using the same numbers as the kill check.
 */
export function ArcGauge({ value, warnPct, killPct, title, detail, testId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const max = killPct * MAX_FACTOR;
  const toDeg = (v: number) => ((Math.min(Math.max(v, MIN), max) - MIN) / (max - MIN)) * 180;
  const level = value === null ? "no_data" : value > killPct ? "kill" : value > warnPct ? "warn" : "ok";
  const colour = level === "kill" ? "var(--st-stockout)" : level === "warn" ? "var(--st-demand)" : level === "ok" ? "var(--accent)" : "var(--text-faint)";
  const word = level === "kill" ? "Past the stopping line" : level === "warn" ? "Warning" : level === "ok" ? "Within limits" : "Not enough weeks yet";
  const target = value === null ? 0 : toDeg(value);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const needle = el.querySelector<SVGGElement>(".ag-needle");
      const fill = el.querySelector<SVGPathElement>(".ag-fill");
      const num = el.querySelector<HTMLElement>(".ag-num");
      if (!needle) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        gsap.set(needle, { rotation: 0, svgOrigin: `${CX} ${CY}` });
        if (fill) gsap.set(fill, { drawSVG: "0%" });
        if (num && value !== null) num.textContent = "0.0%";
        ScrollTrigger.create({
          trigger: el,
          start: "top 90%",
          once: true,
          onEnter: () => {
            gsap.to(needle, { rotation: target, svgOrigin: `${CX} ${CY}`, duration: t.slow * 1.8, ease: "elastic.out(1, 0.6)" });
            if (fill) gsap.to(fill, { drawSVG: `0% ${(target / 180) * 100}%`, duration: t.slow * 1.4, ease: t.easeOut });
            if (num && value !== null) {
              const o = { v: 0 };
              gsap.to(o, { v: value, duration: t.slow * 1.4, ease: t.easeOut, onUpdate: () => { num.textContent = `${o.v >= 0 ? "+" : ""}${o.v.toFixed(1)}%`; } });
            }
          },
        });
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(needle, { rotation: target, svgOrigin: `${CX} ${CY}` });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [value, warnPct, killPct] },
  );

  const tip = polar(0, R - 12);
  return (
    <div className="gauge-card" ref={root} data-testid={testId} data-level={level}>
      <svg viewBox="0 0 200 118" role="img" aria-label={`${title}: ${value === null ? "not enough weeks to judge" : `${value.toFixed(1)}% worse than the baseline, ${word.toLowerCase()}`}. Warning above ${warnPct}%, stop above ${killPct}%.`}>
        <path d={arc(0, toDeg(warnPct))} fill="none" stroke="var(--gauge-band)" strokeWidth="14" />
        <path d={arc(toDeg(warnPct), toDeg(killPct))} fill="none" stroke="var(--st-demand-bg)" strokeWidth="14" />
        <path d={arc(toDeg(killPct), 180)} fill="none" stroke="var(--st-stockout-bg)" strokeWidth="14" />
        <path d={arc(0, toDeg(warnPct))} fill="none" stroke="var(--accent)" strokeWidth="2" opacity=".55" transform="translate(0 -11)" strokeDasharray="1 5" />
        {value !== null ? <path className="ag-fill" d={arc(0, Math.max(target, 0.01))} fill="none" stroke={colour} strokeWidth="14" strokeLinecap="round" opacity=".9" /> : null}
        {[{ v: warnPct, c: "var(--st-demand)", l: `+${warnPct}%` }, { v: killPct, c: "var(--st-stockout)", l: `+${killPct}%` }].map((m) => {
          const a = polar(toDeg(m.v), R + 13);
          return <text key={m.l} x={a.x} y={a.y + 3} textAnchor="middle" className="ag-tick" fill={m.c}>{m.l}</text>;
        })}
        <g className="ag-needle">
          <line x1={CX} y1={CY} x2={tip.x} y2={tip.y} stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
          <circle cx={CX} cy={CY} r="7" fill="var(--text)" />
          <circle cx={CX} cy={CY} r="3" fill="var(--surface)" />
        </g>
      </svg>
      <div className="ag-read">
        <strong className="ag-num" style={{ color: colour }}>{value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}</strong>
        <span className="ag-word" style={{ color: colour }}>{word}</span>
        <span className="muted small">{detail}</span>
      </div>
    </div>
  );
}
