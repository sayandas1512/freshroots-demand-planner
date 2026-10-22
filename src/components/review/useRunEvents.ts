"use client";

import { useEffect, useRef } from "react";
import type { StepState } from "@/run/review-types";

export interface StepEvent {
  step: string;
  status: StepState;
  detail: string | null;
}
export interface DoneEvent {
  status: string;
  llmStatus: string;
}

/** Subscribes to /api/run/[id]/events while `runId` is set. Handlers are kept in a ref so they can change freely. */
export function useRunEvents(runId: string | null, handlers: { onStep: (e: StepEvent) => void; onDone: (e: DoneEvent) => void; onError: () => void }): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/run/${runId}/events`);
    let finished = false;
    source.addEventListener("step", (ev) => ref.current.onStep(JSON.parse((ev as MessageEvent<string>).data) as StepEvent));
    source.addEventListener("done", (ev) => {
      finished = true;
      source.close();
      ref.current.onDone(JSON.parse((ev as MessageEvent<string>).data) as DoneEvent);
    });
    source.addEventListener("error", () => {
      if (finished) return;
      source.close();
      ref.current.onError();
    });
    return () => source.close();
  }, [runId]);
}
