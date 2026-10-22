/** Comparison helpers that are safe against floating point noise (e.g. 1.2 * 100 !== 120). */
const EPS = 1e-9;

export const gt = (a: number, b: number): boolean => a - b > EPS;
export const lt = (a: number, b: number): boolean => b - a > EPS;

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mean of empty list");
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
