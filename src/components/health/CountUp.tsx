"use client";

import { useRef } from "react";
import { FULL_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { ScrollTrigger, gsap, useGSAP } from "@/lib/gsap";

interface Props {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  testId?: string;
}

const format = (n: number, decimals: number) => n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Counts up to its value the first time it scrolls into view. Server markup already holds the final value. */
export function CountUp({ value, decimals = 0, prefix = "", suffix = "", testId }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const finalText = `${prefix}${format(value, decimals)}${suffix}`;

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const counter = { v: 0 };
        ScrollTrigger.create({
          trigger: el,
          start: "top bottom",
          once: true,
          onEnter: () => {
            gsap.to(counter, {
              v: value,
              duration: t.slow,
              ease: t.easeOut,
              onUpdate: () => {
                el.textContent = `${prefix}${format(counter.v, decimals)}${suffix}`;
              },
              onComplete: () => {
                el.textContent = finalText;
              },
            });
          },
        });
      });
      return () => {
        mm.revert();
        el.textContent = finalText;
      };
    },
    { scope: ref, dependencies: [value, decimals, prefix, suffix] },
  );

  return <span ref={ref} className="num" data-testid={testId}>{finalText}</span>;
}
