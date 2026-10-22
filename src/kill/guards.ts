import { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { getActiveConfig } from "@/run/config-store";
import { getKillState } from "./state";

/** 423 response while the kill switch is on, for routes that change decisions. Null when it is fine to go on. */
export async function lockedByKill(db: Db): Promise<NextResponse | null> {
  const state = await getKillState(db);
  return state.active ? NextResponse.json({ error: `The kill switch is on (${state.reason}). Review is read-only until it is cleared.`, reason: "killed" }, { status: 423 }) : null;
}

/** 423 response when the export must not leave the building: shadow mode or the kill switch. */
export async function exportBlocked(db: Db): Promise<NextResponse | null> {
  const kill = await getKillState(db);
  if (kill.active) return NextResponse.json({ error: `Export is stopped: the kill switch is on (${kill.reason}).`, reason: "killed" }, { status: 423 });
  const { config } = await getActiveConfig(db);
  if (config.mode === "shadow") return NextResponse.json({ error: "Export is blocked: the system is in shadow mode. Runs and reviews work, but nothing goes to procurement until go-live.", reason: "shadow" }, { status: 423 });
  return null;
}
