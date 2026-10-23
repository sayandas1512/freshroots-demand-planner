import { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { getKillState } from "./state";

/** 423 response while the kill switch is on, for routes that change decisions. Null when it is fine to go on. */
export async function lockedByKill(db: Db): Promise<NextResponse | null> {
  const state = await getKillState(db);
  return state.active ? NextResponse.json({ error: `The kill switch is on (${state.reason}). Review is read-only until it is cleared.`, reason: "killed" }, { status: 423 }) : null;
}

/** 423 response when the export must not leave the building: the kill switch is on. */
export async function exportBlocked(db: Db): Promise<NextResponse | null> {
  const kill = await getKillState(db);
  if (kill.active) return NextResponse.json({ error: `Export is stopped: the kill switch is on (${kill.reason}).`, reason: "killed" }, { status: 423 });
  return null;
}
