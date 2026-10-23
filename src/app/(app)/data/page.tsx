import { getDb } from "@/db/client";
import { dataFreshness, latestReports } from "@/ingest/ingest";
import { FILE_MAPPINGS, INGEST_KINDS } from "@/ingest/mapping";
import { zohoConfig } from "@/zoho";
import { UploadCard } from "./UploadCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data · Freshroots" };

export default async function DataPage() {
  const db = await getDb();
  const [fresh, reports] = await Promise.all([dataFreshness(db), latestReports(db)]);
  const reportFor = new Map(reports.map((r) => [r.kind, r]));
  const kinds = [...INGEST_KINDS].sort((a, b) => FILE_MAPPINGS[a].loadOrder - FILE_MAPPINGS[b].loadOrder);
  const zohoOn = zohoConfig() !== null;
  const today = new Date().toISOString().slice(0, 10);
  const inventoryAge = fresh.latestInventoryDate ? Math.round((Date.parse(today) - Date.parse(fresh.latestInventoryDate)) / 86_400_000) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data</h1>
          <p>Upload the SAP and Zoho extracts. Every row is validated; rows that fail are listed with the reason and the rest still load. Uploading the same file again is safe.</p>
        </div>
      </div>

      <section className="grid grid-3" aria-label="Data freshness" style={{ marginBottom: "var(--s-5)" }}>
        <div className="card stat">
          <span className="stat-label">Latest sales week</span>
          <span className="stat-value num" data-testid="fresh-sales">{fresh.latestSalesWeek ?? "none"}</span>
          <span className="muted">{fresh.salesRows.toLocaleString("en-IN")} weekly sales rows</span>
        </div>
        <div className="card stat">
          <span className="stat-label">Latest stock snapshot</span>
          <span className="stat-value num" data-testid="fresh-stock">{fresh.latestInventoryDate ?? "none"}</span>
          <span className="muted">{inventoryAge === null ? "No inventory loaded yet" : `${inventoryAge} day${inventoryAge === 1 ? "" : "s"} before today`}</span>
        </div>
        <div className="card stat">
          <span className="stat-label">SKUs in master</span>
          <span className="stat-value num">{fresh.skuCount}</span>
          <span className="muted">Rows for any other SKU are routed to Raghav as exceptions</span>
        </div>
      </section>

      <div className="grid grid-2">
        {kinds.map((kind) => {
          const last = reportFor.get(kind);
          return (
            <UploadCard
              key={kind}
              kind={kind}
              label={FILE_MAPPINGS[kind].label}
              source={FILE_MAPPINGS[kind].source}
              headers={Object.values(FILE_MAPPINGS[kind].columns)}
              managedBy={kind === "open_pos" && zohoOn ? "Zoho connector" : null}
              last={last ? { fileName: last.fileName, accepted: last.accepted, rejected: last.rejected, replaced: last.replaced, at: last.at.toISOString() } : null}
            />
          );
        })}
      </div>
    </>
  );
}
