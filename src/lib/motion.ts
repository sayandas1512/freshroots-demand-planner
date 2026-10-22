/**
 * Motion tokens are defined once in tokens.css. This module reads them so CSS transitions and GSAP share
 * the same durations and eases. Browser only.
 */
export interface MotionTokens {
  fast: number;
  base: number;
  slow: number;
  easeOut: string;
  easeInOut: string;
  easeSettle: string;
}

const FALLBACK: MotionTokens = { fast: 0.18, base: 0.4, slow: 0.8, easeOut: "power3.out", easeInOut: "power2.inOut", easeSettle: "back.out(1.6)" };

function seconds(value: string, fallback: number): number {
  const v = value.trim();
  if (v.endsWith("ms")) return Number.parseFloat(v) / 1000;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function motionTokens(): MotionTokens {
  if (typeof document === "undefined") return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  const get = (name: string): string => css.getPropertyValue(name);
  return {
    fast: seconds(get("--dur-fast"), FALLBACK.fast),
    base: seconds(get("--dur-base"), FALLBACK.base),
    slow: seconds(get("--dur-slow"), FALLBACK.slow),
    easeOut: get("--gsap-ease-out").trim() || FALLBACK.easeOut,
    easeInOut: get("--gsap-ease-inout").trim() || FALLBACK.easeInOut,
    easeSettle: get("--gsap-ease-settle").trim() || FALLBACK.easeSettle,
  };
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const FULL_MOTION_QUERY = "(prefers-reduced-motion: no-preference)";
