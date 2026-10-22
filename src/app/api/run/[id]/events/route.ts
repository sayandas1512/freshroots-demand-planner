import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { runs } from "@/db/schema";
import { STEP_ORDER } from "@/run/execute";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_MS = 350;
const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for run progress. Step state lives on the run row (counts.steps), so this works across
 * serverless instances: it replays the current state, then streams each change until the run ends.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const sent = new Map<string, string>();
      let lastBeat = Date.now();
      try {
        while (!request.signal.aborted) {
          const [run] = await db.select({ status: runs.status, counts: runs.counts, llmStatus: runs.llmStatus }).from(runs).where(eq(runs.id, id)).limit(1);
          if (!run) {
            send("error", { message: "Run not found" });
            break;
          }
          const steps = run.counts.steps ?? {};
          for (const name of STEP_ORDER) {
            const step = steps[name];
            if (!step) continue;
            const fingerprint = `${step.status}|${step.detail ?? ""}`;
            if (sent.get(name) !== fingerprint) {
              sent.set(name, fingerprint);
              send("step", { step: name, status: step.status, detail: step.detail ?? null });
            }
          }
          if (run.status !== "running") {
            send("done", { status: run.status, llmStatus: run.llmStatus });
            break;
          }
          if (Date.now() - lastBeat > HEARTBEAT_MS) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastBeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "stream error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
