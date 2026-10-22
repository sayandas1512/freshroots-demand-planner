export type Perishability = "low" | "high";
export type Action = "REORDER_NOW" | "REORDER_1_5X" | "PAUSE" | "HOLD";
export type Flag = "STOCKOUT_RISK" | "HIGH_DEMAND" | "OVERSTOCK_RISK";
export type ExceptionType =
  | "new_sku"
  | "short_history"
  | "missing_stock"
  | "zero_demand"
  | "anomalous_jump"
  | "unknown_sku"
  | "conflicting_signals"
  | "processing_error"
  | "distributor_shift";

export interface SkuMaster {
  skuId: string;
  name: string;
  category: string;
  perishability: Perishability;
  standardReorderQty: number;
  unit: string;
  distributorId: string;
  /** Optional master data. Null when the file did not provide it. */
  leadTimeWeeks?: number | null;
  moq?: number | null;
}

/** Everything the engine reads. Built by the data loader (live run) or the backtest (replay). */
export interface EngineData {
  asOf: string;
  skus: readonly SkuMaster[];
  /** sku_id -> ISO week -> units. May contain unknown SKUs and weeks outside the window; the engine ignores those it should. */
  sales: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** sku_id -> units on hand summed over locations. A missing key means no snapshot. */
  stock: ReadonlyMap<string, number>;
  /** sku_id -> open PO quantity. A missing key means none. */
  openPo: ReadonlyMap<string, number>;
  /** 'YYYY-MM' months flagged as festival months. */
  festivalMonths: ReadonlySet<string>;
  /** Optional: sku -> distributor -> week -> units. Present only when distributor exceptions are on. */
  distributorSales?: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, number>>>;
}

export interface LineMetrics {
  asOf: string;
  windowFirstWeek: string;
  windowLastWeek: string;
  recentWeeks: number;
  baselineWeeks: number;
  avgBaseline: number;
  avgRecent: number;
  ratio: number;
  ratioThreshold: number;
  demandPerWeek: number;
  stockOnHand: number;
  openPoQty: number;
  stockUsed: number;
  coverWeeks: number;
  coverMin: number;
  coverMax: number;
  perishable: boolean;
  festival: boolean;
  upliftApplied: number;
  upliftMode: string;
  standardReorderQty: number;
  highDemandMultiplier: number;
  includeOpenPoInStock: boolean;
  urgent: boolean;
  leadTimeWeeks: number | null;
  moq: number | null;
  /** Informational only. They never change the action or the quantity. */
  infoFlags: InfoFlag[];
}

export type InfoFlag = "LEAD_TIME_BREACH" | "BELOW_MOQ";

export interface RecommendationLine {
  skuId: string;
  action: Action;
  flags: Flag[];
  ruleFired: string;
  qty: number | null;
  metrics: LineMetrics;
}

export interface ExceptionItem {
  skuId: string;
  type: ExceptionType;
  detail: string;
}

export type SkuOutcome = { kind: "line"; line: RecommendationLine } | { kind: "exception"; exception: ExceptionItem };

export interface EvaluationResult {
  lines: RecommendationLine[];
  exceptions: ExceptionItem[];
}
