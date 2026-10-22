import { gt } from "./num";

export interface DistributorShift {
  distributorId: string;
  baselineShare: number;
  recentShare: number;
  /** How far the recent share is below the baseline share, in percent of the baseline share. */
  dropPct: number;
}

/** Ignore distributors that supply very little: their share is noise. */
const MIN_BASELINE_SHARE = 0.05;

/**
 * Distributors whose share of an SKU's volume over the recent window is more than `thresholdPct` percent below
 * their share over the baseline window. `weeks` is the baseline window, oldest first. Needs at least two
 * distributors and volume in both windows. Used only to route the SKU to the planner, never to recommend.
 */
export function detectDistributorShift(
  byDistributor: ReadonlyMap<string, ReadonlyMap<string, number>>,
  weeks: readonly string[],
  recentWeeks: number,
  thresholdPct: number,
): DistributorShift[] {
  if (byDistributor.size < 2) return [];
  const recent = new Set(weeks.slice(-recentWeeks));
  const sums = new Map<string, { base: number; recent: number }>();
  let totalBase = 0;
  let totalRecent = 0;
  for (const [id, perWeek] of byDistributor) {
    let base = 0;
    let rec = 0;
    for (const week of weeks) {
      const u = perWeek.get(week) ?? 0;
      base += u;
      if (recent.has(week)) rec += u;
    }
    sums.set(id, { base, recent: rec });
    totalBase += base;
    totalRecent += rec;
  }
  if (totalBase === 0 || totalRecent === 0) return [];
  const out: DistributorShift[] = [];
  for (const [id, s] of [...sums].sort(([a], [b]) => a.localeCompare(b))) {
    const baselineShare = s.base / totalBase;
    if (baselineShare < MIN_BASELINE_SHARE) continue;
    const recentShare = s.recent / totalRecent;
    const dropPct = ((baselineShare - recentShare) / baselineShare) * 100;
    if (gt(dropPct, thresholdPct)) out.push({ distributorId: id, baselineShare, recentShare, dropPct });
  }
  return out;
}
