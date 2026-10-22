import { z } from "zod";
import { WEEK_PATTERN, parseDate } from "@/engine/weeks";
import type { ParseKind } from "./mapping";

// Control characters (other than tab) never belong in a business CSV.
const CONTROL_CHARS = /[\u0000-\u0008\u000A-\u001F\u007F]/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "is required")
    .max(max, `is longer than ${max} characters`)
    .refine((v) => !CONTROL_CHARS.test(v), "contains control characters");

const id = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/, "must be 1 to 40 letters, digits, '_', '-' or '.'");

const wholeNumber = (label: string, min: number) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.0+)?$/, `${label} must be a whole number`)
    .transform((v) => Number(v))
    .refine((n) => Number.isSafeInteger(n) && n >= min && n <= 2_000_000_000, `${label} must be between ${min} and 2,000,000,000`);

const isoDate = z
  .string()
  .trim()
  .refine((v) => {
    try {
      parseDate(v);
      return true;
    } catch {
      return false;
    }
  }, "must be a real date as YYYY-MM-DD");

const yesNo = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v, ctx) => {
    if (["true", "yes", "1", "y"].includes(v)) return true;
    if (["false", "no", "0", "n"].includes(v)) return false;
    ctx.addIssue({ code: "custom", message: "must be TRUE or FALSE" });
    return z.NEVER;
  });

export const rowSchemas = {
  distributors: z.object({
    distributorId: id,
    name: text(120),
    region: text(80),
    status: text(30),
  }),
  sku_master: z.object({
    skuId: id,
    name: text(120),
    category: text(60),
    perishability: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["low", "high"], { error: "must be Low or High" })),
    standardReorderQty: wholeNumber("Standard_Reorder_Qty", 1),
    unit: text(20),
    distributorId: id,
  }),
  festival_calendar: z
    .object({
      year: wholeNumber("Year", 1990),
      month: wholeNumber("Month", 1),
      yearMonth: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must look like YYYY-MM"),
      isFestival: yesNo,
    })
    .refine((r) => r.month <= 12 && r.yearMonth === `${r.year}-${String(r.month).padStart(2, "0")}`, "Year and Month do not match Year_Month"),
  sales: z.object({
    skuId: id,
    week: z.string().trim().regex(WEEK_PATTERN, "must be an ISO week like 2026-W42"),
    units: wholeNumber("Units_Sold", 0),
  }),
  inventory: z.object({
    skuId: id,
    location: text(80),
    unitsOnHand: wholeNumber("Units_On_Hand", 0),
    asOfDate: isoDate,
  }),
  outcomes_weekly: z.object({
    week: z.string().trim().regex(WEEK_PATTERN, "must be an ISO week like 2026-W42"),
    stockoutIncidents: wholeNumber("Stockout_Incidents", 0),
    overstockValueInr: wholeNumber("Overstock_Value_INR", 0),
  }),
  orders: z.object({
    skuId: id,
    week: z.string().trim().regex(WEEK_PATTERN, "must be an ISO week like 2026-W42"),
    orderedQty: wholeNumber("Ordered_Qty", 0),
  }),
  open_pos: z.object({
    skuId: id,
    qty: wholeNumber("Open_PO_Qty", 1),
    expectedDate: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(isoDate.nullable()),
  }),
} satisfies Record<ParseKind, z.ZodType>;

export type RowFor<K extends ParseKind> = z.output<(typeof rowSchemas)[K]>;

/** Natural key used to detect duplicate rows inside one file. */
export const rowKeys: { [K in ParseKind]: (row: RowFor<K>) => string } = {
  distributors: (r) => r.distributorId,
  sku_master: (r) => r.skuId,
  festival_calendar: (r) => r.yearMonth,
  sales: (r) => `${r.skuId}|${r.week}`,
  inventory: (r) => `${r.skuId}|${r.location}|${r.asOfDate}`,
  outcomes_weekly: (r) => r.week,
  orders: (r) => `${r.skuId}|${r.week}`,
  open_pos: () => "",
};
