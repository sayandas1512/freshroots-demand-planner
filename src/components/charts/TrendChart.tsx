"use client";

import { useRef, useState } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";
import { niceScale } from "./scale";

export interface TrendPoint {
  label: string;
  value: number;
  kind: "baseline" | "live";
}

interface Props {
  points: TrendPoint[];
  title: string;
  /** Average of the frozen baseline, drawn as a dashed line. */
  baseline: number | null;
  /** Lines drawn above the baseline at +warn% and +kill% ("worse" is higher for both measures). */
  warnPct: number;
  killPct: number;
  format: (v: number) => string;
  /** Short format for the axis ticks. */
  tick?: (v: number) => string;
  /** How many of the latest live points the kill check averages. */
  windowSize?: number;
  testId?: string;
}

const W = 640;
const H = 250;
const M = { l: 58, r: 74, t: 26, b: 30 };

/**
 * The weekly figures against the frozen baseline: baseline weeks in grey, live weeks in colour, the dashed baseline
 * average, and the warning and stopping lines the kill check uses. The last four live weeks are shaded because that
 * is the window the kill check averages. Hover or focus a point for its exact value.
 */
export function TrendChart({ points, title, baseline, warnPct, killPct, format, tick = format, windowSize = 4, testId }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const warnAt = baseline === null ? null : baseline * (1 + warnPct / 100);
  const killAt = baseline === null ? null : baseline * (1 + killPct / 100);
  const scale = niceScale(Math.max(1, ...points.map((p) => p.value), killAt ?? 0) * 1.04);
  const maxV = scale.max;
  const minV = 0;
  const x = (i: number) => M.l + (points.length <= 1 ? (W - M.l - M.r) / 2 : (i / (points.length - 1)) * (W - M.l - M.r));
  const y = (v: number) => H - M.b - ((v - minV) / (maxV - minV)) * (H - M.t - M.b);
  const ticks = scale.ticks;
  const liveIdx = points.map((p, i) => (p.kind === "live" ? i : -1)).filter((i) => i >= 0);
  const windowIdx = liveIdx.slice(-windowSize);
  const line = (idx: number[]) => idx.map((i, k) => `${k === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y((points[i] as TrendPoint).value).toFixed(1)}`).join(" ");
  const baseIdx = points.map((p, i) => (p.kind === "baseline" ? i : -1)).filter((i) => i >= 0);
  // the live line starts at the last baseline point so the two read as one story
  const liveLine = line([...(baseIdx.length > 0 ? [baseIdx.at(-1) as number] : []), ...liveIdx]);
  const area = liveIdx.length === 0 ? "" : `${liveLine} L${x(liveIdx.at(-1) as number).toFixed(1)} ${y(0)} L${x(baseIdx.length > 0 ? (baseIdx.at(-1) as number) : liveIdx[0] as number).toFixed(1)} ${y(0)} Z`;
  const a = active === null ? null : (points[active] as TrendPoint);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const q = gsap.utils.selector(el);
        const tl = gsap.timeline({ paused: true, defaults: { ease: t.easeOut } });
        tl.from(q(".tc-grid"), { opacity: 0, duration: 0.5 })
          .from(q(".tc-draw"), { drawSVG: "0%", duration: 1.1, stagger: 0.18, ease: t.easeInOut }, 0.1)
          .from(q(".tc-area"), { opacity: 0, duration: 0.8 }, 0.5)
          .from(q(".tc-window"), { opacity: 0, scaleY: 0.4, transformOrigin: "50% 100%", duration: 0.6 }, 0.7)
          .from(q(".tc-point"), { scale: 0, transformOrigin: "50% 50%", stagger: 0.04, duration: 0.4, ease: "back.out(2.4)" }, 0.5)
          .from(q(".tc-limit"), { opacity: 0, x: -10, duration: 0.6, stagger: 0.1 }, 0.6);
        ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => tl.play() });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  if (points.length === 0) return <p className="muted small">No weekly figures yet.</p>;
  const summary = `${title}. ${points.length} weeks. ${baseline === null ? "No frozen baseline yet." : `Baseline average ${format(baseline)}.`} Latest: ${format((points.at(-1) as TrendPoint).value)}.`;

  return (
    <div className="chart" ref={root} data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} onPointerLeave={() => setActive(null)}>
        <g className="tc-grid">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--hairline)" strokeWidth="1" />
              <text x={M.l - 8} y={y(v) + 4} textAnchor="end" className="tc-axis">{tick(v)}</text>
            </g>
          ))}
        </g>

        {windowIdx.length > 1 ? (
          <g className="tc-window">
            <rect x={x(windowIdx[0] as number) - 8} y={M.t} width={x(windowIdx.at(-1) as number) - x(windowIdx[0] as number) + 16} height={H - M.t - M.b} rx="8" fill="var(--accent)" opacity="0.07" />
            <text x={(x(windowIdx[0] as number) + x(windowIdx.at(-1) as number)) / 2} y={M.t - 5} textAnchor="middle" className="tc-note">last {windowIdx.length} weeks (what the kill check averages)</text>
          </g>
        ) : null}

        {killAt !== null ? (
          <g className="tc-limit">
            <line x1={M.l} x2={W - M.r} y1={y(killAt)} y2={y(killAt)} stroke="var(--st-stockout)" strokeWidth="1.5" strokeDasharray="6 5" />
            <text x={W - M.r + 6} y={y(killAt) + 4} className="tc-tag" fill="var(--st-stockout)">stop +{killPct}%</text>
          </g>
        ) : null}
        {warnAt !== null ? (
          <g className="tc-limit">
            <line x1={M.l} x2={W - M.r} y1={y(warnAt)} y2={y(warnAt)} stroke="var(--st-demand)" strokeWidth="1.5" strokeDasharray="6 5" />
            <text x={W - M.r + 6} y={y(warnAt) + 4} className="tc-tag" fill="var(--st-demand)">warn +{warnPct}%</text>
          </g>
        ) : null}
        {baseline !== null ? (
          <g className="tc-limit">
            <line x1={M.l} x2={W - M.r} y1={y(baseline)} y2={y(baseline)} stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="2 4" />
            <text x={W - M.r + 6} y={y(baseline) + 4} className="tc-tag" fill="var(--text-muted)">baseline</text>
          </g>
        ) : null}

        <defs>
          <linearGradient id={`tc-fade-${testId ?? "x"}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area ? <path className="tc-area" d={area} fill={`url(#tc-fade-${testId ?? "x"})`} /> : null}
        {baseIdx.length > 1 ? <path className="tc-draw" d={line(baseIdx)} fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {liveIdx.length > 0 ? <path className="tc-draw" d={liveLine} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /> : null}

        {a !== null && active !== null ? <line x1={x(active)} x2={x(active)} y1={M.t} y2={H - M.b} stroke="var(--border-strong)" strokeWidth="1" /> : null}
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`} className="tc-point">
            <circle cx={x(i)} cy={y(p.value)} r={active === i ? 7 : 4.5} fill={p.kind === "live" ? "var(--accent)" : "var(--text-faint)"} stroke="var(--surface)" strokeWidth="2" />
            <circle
              cx={x(i)}
              cy={y(p.value)}
              r="14"
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${p.label}, ${p.kind === "live" ? "live" : "baseline"}: ${format(p.value)}`}
              style={{ outline: "none" }}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            />
            {i % labelEvery === 0 || i === points.length - 1 ? <text x={x(i)} y={H - 10} textAnchor="middle" className="tc-axis">{p.label.replace(/^\d{4}-/, "")}</text> : null}
          </g>
        ))}
      </svg>
      {a !== null && active !== null ? (
        <div className="chart-tip" role="status" style={{ left: `${(x(active) / W) * 100}%`, top: `${(y(a.value) / H) * 100}%` }}>
          <b>{a.label}</b>
          <span>{format(a.value)}</span>
          <small>{a.kind === "live" ? "live week" : "baseline week"}</small>
        </div>
      ) : null}
    </div>
  );
}
