/** A "nice" axis for values from 0 to `max`: a round step (1, 2, 2.5, 5 times a power of ten) and the top it leads to. */
export function niceScale(max: number, wanted = 4): { max: number; step: number; ticks: number[] } {
  const safe = max > 0 && Number.isFinite(max) ? max : 1;
  const raw = safe / wanted;
  const base = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * base).find((s) => s >= raw) ?? 10 * base);
  const top = step * Math.ceil(safe / step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks };
}

/** How far from the baseline, in words: the sign alone is easy to misread ("lower is better" for both measures). */
export function changeWords(value: number): { amount: string; direction: "better" | "worse" | "level" } {
  const amount = `${Math.abs(value).toFixed(1)}%`;
  if (amount === "0.0%") return { amount, direction: "level" };
  return { amount, direction: value < 0 ? "better" : "worse" };
}
