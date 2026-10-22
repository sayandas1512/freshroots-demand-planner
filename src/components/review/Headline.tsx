"use client";

import { useRef } from "react";
import { FULL_MOTION_QUERY, REDUCED_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { SplitText, gsap, useGSAP } from "@/lib/gsap";
import { SourceChip } from "./ui";

const LAST_KEY = "fr-headline-run";

function alreadyShown(runId: string): boolean {
  try {
    return sessionStorage.getItem(LAST_KEY) === runId;
  } catch {
    return false;
  }
}

function remember(runId: string): void {
  try {
    sessionStorage.setItem(LAST_KEY, runId);
  } catch {
    /* sessionStorage unavailable: the reveal may replay on reload, which is harmless */
  }
}

/** Three-line run headline. Lines reveal through SplitText masks, once per new run. */
export function Headline({ runId, lines, source }: { runId: string; lines: string[]; source: "llm" | "template" }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (alreadyShown(runId)) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const splits = [...(root.current?.querySelectorAll<HTMLElement>("[data-line]") ?? [])].map((p) => SplitText.create(p, { type: "lines", mask: "lines" }));
        gsap.from(
          splits.flatMap((s) => s.lines),
          { yPercent: 110, duration: t.slow, ease: t.easeOut, stagger: 0.12, onComplete: () => remember(runId) },
        );
        return () => splits.forEach((s) => s.revert());
      });
      mm.add(REDUCED_MOTION_QUERY, () => remember(runId));
      return () => mm.revert();
    },
    { scope: root, dependencies: [runId] },
  );

  return (
    <section className="headline" ref={root} aria-label="Run headline" data-testid="headline">
      <div className="headline-lines">
        {lines.map((line, i) => (
          <p key={i} data-line className={i === 0 ? "headline-first" : undefined}>{line}</p>
        ))}
      </div>
      <SourceChip source={source} />
    </section>
  );
}
