"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { IngestReport } from "@/ingest/ingest";
import { formatIst } from "@/lib/dates";

interface Props {
  kind: string;
  label: string;
  source: string;
  headers: string[];
  managedBy?: string | null;
  last: { fileName: string; accepted: number; rejected: number; replaced: number; at: string } | null;
}

export function UploadCard({ kind, label, source, headers, last, managedBy }: Props) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setReport(null);
    const body = new FormData();
    body.set("file", file);
    try {
      const res = await fetch(`/api/ingest/${kind}`, { method: "POST", body });
      const json = (await res.json()) as IngestReport | { error: string };
      if ("error" in json) setError(json.error);
      else {
        setReport(json);
        if (json.fileError) setError(json.fileError);
        else router.refresh();
      }
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="card upload-card" aria-labelledby={`up-${kind}`} data-testid={`upload-${kind}`}>
      <div className="upload-head">
        <h2 id={`up-${kind}`}>{label}</h2>
        <span className="chip chip-plain">{source}</span>
      </div>
      <p className="muted mono small">{headers.join(", ")}</p>
      {last ? (
        <p className="small muted">
          Last upload: <strong>{last.fileName}</strong> on {formatIst(last.at)}: {last.accepted} accepted, {last.rejected} rejected, {last.replaced} replaced.
        </p>
      ) : (
        <p className="small muted">Nothing uploaded yet.</p>
      )}
      {managedBy ? <p className="small ok-text" data-testid={`managed-${kind}`}>Managed by the {managedBy}: the CSV upload is switched off. See the Zoho page.</p> : null}
      <form onSubmit={upload} className="upload-form" hidden={Boolean(managedBy)}>
        <input ref={input} type="file" accept=".csv,text/csv" aria-label={`${label} CSV file`} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {report && !report.fileError ? (
        <div className="report" role="status">
          <div className="report-counts">
            <span className="chip chip-hold">{report.accepted} accepted</span>
            <span className={`chip ${report.rejected > 0 ? "chip-stockout" : "chip-plain"}`}>{report.rejected} rejected</span>
            <span className="chip chip-plain">{report.replaced} replaced</span>
          </div>
          {report.warnings.length > 0 ? (
            <details>
              <summary>{report.warnings.length} warning{report.warnings.length > 1 ? "s" : ""}</summary>
              <ul className="issue-list">{report.warnings.map((w) => <li key={`${w.row}-${w.reason}`}>Row {w.row}: {w.reason}</li>)}</ul>
            </details>
          ) : null}
          {report.rejects.length > 0 ? (
            <details open>
              <summary>Rejected rows{report.rejectsTruncated ? " (first 500)" : ""}</summary>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th className="r">Row</th><th>Reason</th><th>Values</th></tr></thead>
                  <tbody>
                    {report.rejects.map((r) => (
                      <tr key={`${r.row}-${r.reason}`}>
                        <td className="num r">{r.row}</td>
                        <td>{r.reason}</td>
                        <td className="mono small">{Object.values(r.raw).join(" | ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
