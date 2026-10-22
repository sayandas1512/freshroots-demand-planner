import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** WCAG AA (4.5:1 for text) for the colour pairs the UI actually uses, in both themes. */
const css = readFileSync("src/app/tokens.css", "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  const vars: Record<string, string> = {};
  for (const m of css.slice(open, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[m[1] as string] = m[2] as string;
  return vars;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const themes: Record<string, Record<string, string>> = {
  light: block(':root, :root[data-theme="light"]'),
  dark: block(':root[data-theme="dark"]'),
};

const PAIRS: [string, string][] = [
  ["text", "bg"], ["text", "surface"], ["text", "surface-2"],
  ["text-muted", "bg"], ["text-muted", "surface"], ["text-muted", "surface-2"],
  ["text-faint", "surface"],
  ["accent", "surface"], ["accent", "bg"], ["accent-ink", "accent"], ["accent", "accent-soft"],
  ["st-stockout", "st-stockout-bg"], ["st-demand", "st-demand-bg"], ["st-overstock", "st-overstock-bg"],
  ["st-perish", "st-perish-bg"], ["st-hold", "st-hold-bg"], ["st-exception", "st-exception-bg"],
  ["st-stockout", "surface"], ["st-demand", "surface"], ["st-overstock", "surface"], ["st-perish", "surface"], ["st-hold", "surface"], ["st-exception", "surface"],
  ["text", "st-stockout-bg"], ["text", "st-demand-bg"],
];

describe("colour contrast, WCAG AA", () => {
  for (const [name, vars] of Object.entries(themes)) {
    for (const [fg, bg] of PAIRS) {
      it(`${name}: ${fg} on ${bg}`, () => {
        expect(vars[fg], `${fg} defined`).toBeDefined();
        expect(vars[bg], `${bg} defined`).toBeDefined();
        expect(ratio(vars[fg] as string, vars[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("non-text marks (gauge marks and track) reach 3:1 against the surface", () => {
    for (const [name, vars] of Object.entries(themes)) {
      expect(ratio(vars["text-muted"] as string, vars.surface as string), `${name} marks`).toBeGreaterThanOrEqual(3);
      expect(ratio(vars["st-stockout"] as string, vars["gauge-track"] as string), `${name} red fill on track`).toBeGreaterThanOrEqual(3);
      expect(ratio(vars["st-overstock"] as string, vars["gauge-track"] as string), `${name} blue fill on track`).toBeGreaterThanOrEqual(3);
    }
  });
});
