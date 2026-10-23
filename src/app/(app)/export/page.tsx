import Link from "next/link";
import { z } from "zod";
import { currentActor } from "@/auth/actor";
import { can } from "@/auth/roles";
import { getDb } from "@/db/client";
import { exportLog } from "@/db/schema";
import { exportColumns } from "@/export/mapping";
import { approvedExportLines } from "@/export/query";
import { getKillState } from "@/kill/state";
import { getActiveConfig } from "@/run/config-store";
import { zohoConfig } from "@/zoho";
import { planDraftPos } from "@/zoho/push";
import { ZohoPushPanel } from "./ZohoPushPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Export preview · Freshroots" };

export default async function ExportPreview({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const id = z.string().uuid().safeParse(run);
  const db = await getDb();
  const [actor, kill, active] = await Promise.all([currentActor(), getKillState(db), getActiveConfig(db)]);
  if (!id.success) return <div className="card empty"><h3>No run chosen</h3><p>Open the export from the Review page.</p></div>;

  const allowed = can(actor?.role, "export");
  const lines = await approvedExportLines(db, id.data);
  const total = lines.reduce((a, l) => a + l.quantity, 0);
  const canDownload = !kill.active && allowed;
  if (canDownload) await db.insert(exportLog).values({ runId: id.data, userId: actor?.userId ?? null, lineCount: lines.length, totalQty: total, kind: "preview" });
  const columns = exportColumns(active.config.export_id_label);
  const zohoOn = zohoConfig() !== null && canDownload;
  const plan = zohoOn ? await planDraftPos(db, id.data) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Export preview</h1>
          <p>Exactly what the file will contain. Only lines you approved or edited, with their final quantities. Rejected, pending and no-quantity lines are not included.</p>
        </div>
        <div className="run-controls">
          <Link className="btn" href="/">Back to Review</Link>
          {canDownload ? <a className="btn btn-primary" href={`/api/export/approved?run=${id.data}`} download data-testid="download-csv">Download CSV ({lines.length} lines)</a> : null}
        </div>
      </div>

      {kill.active ? <div className="banner banner-bad" role="alert"><span><strong>Blocked: kill switch is on.</strong> {kill.reason}</span></div> : null}
      {!allowed ? <div className="banner banner-info" role="note"><span>Only a planner or admin can download the export.</span></div> : null}
      <div className="banner banner-info" role="note"><span>The distributor column is labelled <code>{active.config.export_id_label}</code>. It is not yet confirmed whether this is the supplier we order from or the selling distributor; change the label on Settings once procurement confirms.</span></div>

      {lines.length === 0 ? (
        <div className="card empty"><h3>Nothing to export yet</h3><p>Approve or edit a line that has a quantity on the Review page.</p></div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="data" data-testid="export-preview-table">
              <thead><tr>{columns.map((c) => <th key={c.header} className={c.header === "Quantity" ? "r" : undefined}>{c.header}</th>)}</tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.skuId}>{columns.map((c) => <td key={c.header} className={c.header === "Quantity" ? "num r" : "mono"}>{String(c.value(l))}</td>)}</tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}><strong>Total</strong></td><td className="num r"><strong>{total.toLocaleString("en-IN")}</strong></td><td colSpan={columns.length - 3} /></tr></tfoot>
            </table>
          </div>
        </div>
      )}
      {plan ? <ZohoPushPanel runId={id.data} plan={plan} enabled={active.config.zoho_push_enabled} /> : null}
    </>
  );
}
