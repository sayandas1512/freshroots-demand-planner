"use client";

import { useRef } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";

interface Props {
  cover: number;
  min: number;
  max: number;
  perishable: boolean;
  /** Stable key so a row animates only the first time it is seen in this run. */
  animateKey: string;
  /** True when rows are windowed: animate on mount instead of on scroll. */
  mountAnimate: boolean;
  scroller?: HTMLElement | null;
}

const animated = new Set<string>();

type Zone = "low" | "ok" | "high";
const zoneOf = (v: number, min: number, max: number): Zone => (v < min ? "low" : v > max ? "high" : "ok");

/**
 * Horizontal bar of weeks of cover, drawn to scale. The healthy band between the min and max marks is shaded,
 * the marks are static, and the marker takes the state colour of the zone it is in.
 * The domain runs to 1.6x the maximum (or the value, if larger) so the marks stay readable for any SKU.
 */
export function CoverGauge({ cover, min, max, perishable, animateKey, mountAnimate, scroller }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const domain = Math.max(max * 1.6, cover * 1.06);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / domain) * 100)).toFixed(2)}%`;
  const zone = zoneOf(cover, min, max);

  useGSAP(
    () => {
      const el = root.current;
      if (!el || animated.has(animateKey)) return;
      const fill = el.querySelector<HTMLElement>("[data-fill]");
      const marker = el.querySelector<HTMLElement>("[data-marker]");
      const num = el.querySelector<HTMLElement>("[data-num]");
      const track = el.querySelector<HTMLElement>("[data-track]");
      if (!fill || !marker || !num || !track) return;

      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const play = () => {
          if (animated.has(animateKey)) return;
          const counter = { v: 0 };
          let last: Zone = zoneOf(0, min, max);
          marker.dataset.zone = last;
          const travel = track.clientWidth * (Math.min(domain, cover) / domain);
          gsap.set(fill, { scaleX: 0, transformOrigin: "0 50%" });
          gsap.set(marker, { x: -travel, opacity: 0 });
          const tl = gsap.timeline();
          tl.to(fill, { scaleX: 1, duration: t.slow, ease: t.easeOut }, 0)
            .to(marker, { x: 0, opacity: 1, duration: t.slow, ease: t.easeOut }, 0)
            .to(
              counter,
              {
                v: cover,
                duration: t.slow,
                ease: t.easeOut,
                onUpdate: () => {
                  num.textContent = counter.v.toFixed(1);
                  const z = zoneOf(counter.v, min, max);
                  if (z !== last) {
                    last = z;
                    marker.dataset.zone = z;
                    gsap.fromTo(marker, { scale: 1.5 }, { scale: 1, duration: t.base, ease: t.easeSettle, overwrite: "auto" });
                  }
                },
                onComplete: () => {
                  animated.add(animateKey);
                  num.textContent = cover.toFixed(1);
                  marker.dataset.zone = zone;
                },
              },
              0,
            );
        };
        if (mountAnimate) {
          play();
          return;
        }
        ScrollTrigger.create({ trigger: el, start: "top bottom", once: true, ...(scroller ? { scroller } : {}), onEnter: play });
      });
      return () => {
        mm.revert();
        // An interrupted count-up must never leave a half-way number on screen.
        num.textContent = cover.toFixed(1);
        marker.dataset.zone = zone;
      };
    },
    { scope: root, dependencies: [cover, min, max, animateKey] },
  );

  return (
    <div
      ref={root}
      className="gauge"
      role="img"
      aria-label={`Cover ${cover.toFixed(1)} weeks. Minimum ${min}, maximum ${max}${perishable ? ", perishable window" : ""}.`}
    >
      <div className="gauge-track" data-track>
        <div className="gauge-band" style={{ left: pct(min), width: `calc(${pct(max)} - ${pct(min)})` }} />
        <div className="gauge-fill" data-fill data-zone={zone} style={{ width: pct(cover) }} />
        <div className="gauge-mark" style={{ left: pct(min) }}><span>{min}</span></div>
        <div className="gauge-mark" style={{ left: pct(max) }}><span>{max}</span></div>
        <div className="gauge-marker" data-marker data-zone={zone} style={{ left: pct(cover) }} />
      </div>
      <span className="gauge-num num" data-num>{cover.toFixed(1)}</span>
    </div>
  );
}
