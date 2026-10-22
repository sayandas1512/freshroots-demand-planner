export type RangeVerdict = "below" | "within" | "above";

export interface RangeComparison {
  verdict: RangeVerdict;
  /** Percent difference from the range midpoint (negative = lower loss than the baseline). */
  pctFromMidpoint: number;
}

/** Compare a quarter's figure with the brief's baseline range. Lower is better for losses and write-offs. */
export function compareToRange(value: number, low: number, high: number): RangeComparison {
  const mid = (low + high) / 2;
  const verdict: RangeVerdict = value < low ? "below" : value > high ? "above" : "within";
  return { verdict, pctFromMidpoint: mid === 0 ? 0 : Math.round(((value - mid) / mid) * 1000) / 10 };
}

/** ₹18,00,000 -> "₹18.0 lakh". */
export function formatLakh(inr: number): string {
  return `₹${(inr / 100_000).toFixed(1)} lakh`;
}
