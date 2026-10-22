"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card empty" role="alert">
      <h3>Something went wrong on this page</h3>
      <p>Your decisions are saved as you make them, so nothing is lost. Try again, and if it keeps happening check the Health page and the runbook in the README.</p>
      {error.digest ? <p className="small mono faint">Reference: {error.digest}</p> : null}
      <p style={{ marginTop: "var(--s-3)" }}><button type="button" className="btn btn-primary" onClick={reset}>Try again</button></p>
    </div>
  );
}
