"use client";

import { useRef } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";

interface Props {
  values: (number | null)[];
  label: string;
  /** How to read the last point in the accessible name. */
  unit?: string;
}

const W = 140;
const H = 36;
const PAD = 3;

/** Line drawn to scale between the min and max of the series. The path draws itself in once, on first view. */
export function Sparkline({ values, label, unit = "" }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => PAD + (values.length <= 1 ? (W - 2 * PAD) / 2 : (i / (values.length - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const d = points.map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = points.at(-1);

  useGSAP(
    () => {
      const path = ref.current?.querySelector<SVGPathElement>("[data-draw]");
      if (!path || !ref.current) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        gsap.set(path, { drawSVG: "0%" });
        ScrollTrigger.create({ trigger: ref.current, start: "top bottom", once: true, onEnter: () => gsap.to(path, { drawSVG: "100%", duration: t.slow, ease: t.easeInOut }) });
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [d] },
  );

  if (points.length === 0) return <span className="faint small">No data yet</span>;
  return (
    <svg ref={ref} className="sparkline" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label}: latest ${last ? last.v.toFixed(2) : "none"}${unit}, range ${min.toFixed(2)} to ${max.toFixed(2)}${unit}`}>
      <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="var(--border-strong)" strokeWidth="1" />
      <path data-draw d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {last ? <circle cx={x(last.i)} cy={y(last.v)} r="3" fill="var(--accent)" /> : null}
    </svg>
  );
}
