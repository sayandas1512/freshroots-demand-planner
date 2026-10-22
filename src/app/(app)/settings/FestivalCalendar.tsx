"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function FestivalCalendar({ months, canEdit }: { months: { yearMonth: string; isFestival: boolean }[]; canEdit: boolean }) {
  const router = useRouter();
  const initial = useMemo(() => new Map(months.map((m) => [m.yearMonth, m.isFestival])), [months]);
  const [flags, setFlags] = useState<Map<string, boolean>>(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const years = [...new Set([...flags.keys()].map((k) => k.slice(0, 4)))].sort();
  const dirty = [...flags].filter(([k, v]) => initial.get(k) !== v);

  function toggle(key: string) {
    setStatus(null);
    setFlags((f) => new Map(f).set(key, !f.get(key)));
  }

  function addYear() {
    const next = String(Number(years.at(-1) ?? new Date().getFullYear()) + 1);
    setFlags((f) => {
      const copy = new Map(f);
      for (let m = 1; m <= 12; m += 1) copy.set(`${next}-${String(m).padStart(2, "0")}`, false);
      return copy;
    });
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/settings/festival", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ months: dirty.map(([yearMonth, isFestival]) => ({ yearMonth, isFestival })) }),
      });
      setStatus(res.ok ? "Calendar saved. It applies from the next run." : "Could not save the calendar.");
      if (res.ok) router.refresh();
    } catch {
      setStatus("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card calendar" aria-labelledby="cal-h">
      <div className="calendar-head">
        <div>
          <h2 id="cal-h">Festival calendar</h2>
          <p className="muted small">Months marked as festival months get the demand uplift. Brief default: March, October and November. Changes apply to future runs, not to runs already saved.</p>
        </div>
        <div className="calendar-actions">
          <button type="button" className="btn btn-sm" onClick={addYear} disabled={!canEdit}>Add {Number(years.at(-1) ?? new Date().getFullYear()) + 1}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || dirty.length === 0} onClick={save} data-testid="save-calendar">{busy ? "Saving…" : `Save calendar${dirty.length ? ` (${dirty.length})` : ""}`}</button>
        </div>
      </div>
      {years.map((y) => (
        <div key={y} className="cal-year">
          <strong className="num">{y}</strong>
          <div className="cal-months" role="group" aria-label={`Festival months in ${y}`}>
            {MONTHS.map((name, i) => {
              const key = `${y}-${String(i + 1).padStart(2, "0")}`;
              const on = flags.get(key) ?? false;
              return (
                <button key={key} type="button" className="cal-month" aria-pressed={on} disabled={!canEdit} onClick={() => toggle(key)} data-testid={`cal-${key}`}>
                  {on ? "★ " : ""}{name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {status ? <p role="status" className="small">{status}</p> : null}
    </section>
  );
}
