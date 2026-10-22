import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { systemHealth } from "@/run/healthcheck";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Is it working? Needs a session or the bearer CRON_SECRET (an uptime monitor can send it).
 * Returns 503 when the database is down so a monitor can alert. `?llm=1` also pings the LLM provider.
 */
export async function GET(request: Request) {
  const pingLlm = new URL(request.url).searchParams.get("llm") === "1";
  try {
    const health = await systemHealth(await getDb(), { pingLlm });
    return NextResponse.json(health, { status: health.overall === "down" ? 503 : 200 });
  } catch {
    return NextResponse.json({ overall: "down", error: "health check failed" }, { status: 503 });
  }
}
