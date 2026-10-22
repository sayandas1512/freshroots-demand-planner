import Link from "next/link";

export default function NotFound() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Page not found</h1>
        <p className="muted">That page does not exist.</p>
        <p style={{ marginTop: "var(--s-3)" }}><Link className="btn btn-primary" href="/">Back to Review</Link></p>
      </div>
    </div>
  );
}
