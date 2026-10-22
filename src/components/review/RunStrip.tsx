"use client";

import { useRef } from "react";
import type { StepState } from "@/run/review-types";
import { FULL_MOTION_QUERY, REDUCED_MOTION_QUERY, motionTokens } from "@/lib/motion";
import { gsap, useGSAP } from "@/lib/gsap";

export type StripStepId = "timer" | "data" | "rules" | "exceptions" | "llm" | "sheet";
export const STRIP_STEPS: { id: StripStepId; label: string }[] = [
  { id: "timer", label: "Trigger" },
  { id: "data", label: "Data" },
  { id: "rules", label: "Rules" },
  { id: "exceptions", label: "Exceptions" },
  { id: "llm", label: "Wording" },
  { id: "sheet", label: "Sheet" },
];

/** The rail runs from the first node's centre to the last node's centre: 1/12 to 11/12 of the track for six boxes. */
function railScale(centre: number, trackWidth: number): number {
  const start = trackWidth / (STRIP_STEPS.length * 2);
  const length = trackWidth - 2 * start;
  return length <= 0 ? 0.001 : Math.min(1, Math.max(0.001, (centre - start) / length));
}

type EventSteps = Record<string, { status: StepState; detail?: string | null }>;

/** Collapse the engine's event steps into the six boxes of the strip. */
export function stripStates(steps: EventSteps, started: boolean): Record<StripStepId, StepState> {
  const s = (k: string): StepState => steps[k]?.status ?? "pending";
  const llmParts = [s("llm_explain"), s("llm_headline")];
  let llm: StepState = "pending";
  if (llmParts.includes("failed")) llm = "failed";
  else if (llmParts.includes("degraded")) llm = llmParts.every((p) => p === "pending") ? "pending" : "degraded";
  else if (llmParts.every((p) => p === "skipped")) llm = "skipped";
  else if (llmParts.includes("running")) llm = "running";
  else if (llmParts.every((p) => p === "done" || p === "skipped")) llm = "done";
  else if (llmParts.includes("done")) llm = "running";
  return {
    timer: started ? "done" : "pending",
    data: s("ingest_check"),
    rules: s("rules"),
    exceptions: s("exceptions"),
    llm,
    sheet: s("sheet_saved"),
  };
}

const STATE_TEXT: Record<StepState, string> = {
  pending: "waiting",
  running: "working",
  done: "done",
  degraded: "fell back to templates",
  failed: "failed",
  skipped: "skipped (no API key)",
};

interface Props {
  states: Record<StripStepId, StepState>;
  triggerLabel: string;
  live: boolean;
}

/**
 * Pipeline track. A GSAP timeline carries a pulse from box to box as real SSE events arrive.
 * It never runs on a timer of its own: with no events, nothing moves.
 */
export function RunStrip({ states, triggerLabel, live }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const previous = useRef<Record<StripStepId, StepState> | null>(null);
  const key = STRIP_STEPS.map((s) => states[s.id]).join("|");

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const mm = gsap.matchMedia();
      mm.add(FULL_MOTION_QUERY, () => {
        const t = motionTokens();
        const pulse = el.querySelector<HTMLElement>("[data-pulse]");
        const progress = el.querySelector<HTMLElement>("[data-progress]");
        const track = el.querySelector<HTMLElement>("[data-track]");
        if (!pulse || !progress || !track) return;
        const nodes = STRIP_STEPS.map((s) => el.querySelector<HTMLElement>(`[data-node="${s.id}"]`));
        const center = (i: number) => {
          const n = nodes[i];
          return n ? n.offsetLeft + n.offsetWidth / 2 : 0;
        };
        timeline.current ??= gsap.timeline();
        const tl = timeline.current;
        const prev = previous.current;

        const frontier = STRIP_STEPS.reduce((acc, s, i) => (states[s.id] === "pending" ? acc : i), 0);
        const width = center(frontier);
        if (prev && live) {
          tl.to(pulse, { x: width, opacity: 1, duration: t.base, ease: t.easeInOut });
          tl.to(progress, { scaleX: railScale(width, track.offsetWidth), duration: t.base, ease: t.easeInOut }, "<");
          STRIP_STEPS.forEach((s, i) => {
            const before = prev[s.id];
            const now = states[s.id];
            const node = nodes[i];
            if (node && before !== now && (now === "done" || now === "degraded" || now === "failed" || now === "skipped")) {
              tl.fromTo(node, { scale: 0.86 }, { scale: 1, duration: t.base, ease: t.easeSettle }, ">-0.1");
            }
          });
          if (states.sheet !== "pending" && states.llm !== "running") tl.to(pulse, { opacity: 0, duration: t.fast });
        } else {
          gsap.set(progress, { scaleX: railScale(width, track.offsetWidth) });
          gsap.set(pulse, { x: width, opacity: live ? 1 : 0 });
        }
        previous.current = states;
      });
      mm.add(REDUCED_MOTION_QUERY, () => {
        previous.current = states;
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [key, live], revertOnUpdate: false },
  );

  const done = STRIP_STEPS.filter((s) => states[s.id] === "done" || states[s.id] === "degraded" || states[s.id] === "skipped").length;
  return (
    <div className="strip" ref={root} data-testid="run-strip" data-live={live ? "true" : "false"}>
      <ol className="strip-nodes" data-track>
        <span className="strip-rail" aria-hidden="true" />
        <span className="strip-progress" data-progress aria-hidden="true" />
        <span className="strip-pulse" data-pulse aria-hidden="true" />
        {STRIP_STEPS.map((s) => (
          <li key={s.id} className="strip-node" data-node={s.id} data-state={states[s.id]}>
            <span className="strip-dot" aria-hidden="true">
              {states[s.id] === "done" ? "✓" : states[s.id] === "degraded" ? "!" : states[s.id] === "failed" ? "×" : states[s.id] === "skipped" ? "–" : ""}
            </span>
            <span className="strip-label">{s.id === "timer" ? triggerLabel : s.label}</span>
            <span className="sr-only">: {STATE_TEXT[states[s.id]]}</span>
          </li>
        ))}
      </ol>
      <span className="sr-only">{done} of {STRIP_STEPS.length} pipeline steps finished</span>
    </div>
  );
}
