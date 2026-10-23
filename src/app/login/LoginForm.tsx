"use client";

import { useState } from "react";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ message: string; devLink?: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const res = await fetch("/api/auth/request-link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const json = (await res.json()) as { message?: string; devLink?: string; error?: string };
      if (res.ok) setSent({ message: json.message ?? "Check your email.", devLink: json.devLink });
      else setError(res.status === 429 ? "Too many attempts. Wait a minute and try again." : (json.error ?? "Could not send the link."));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="login-sent" role="status" data-testid="link-sent">
        <p>{sent.message}</p>
        {sent.devLink ? (
          <p className="small">Development only, no email is sent: <a href={sent.devLink} data-testid="dev-link">open the sign-in link</a>.</p>
        ) : null}
        <button type="button" className="btn btn-sm" onClick={() => setSent(null)}>Use a different email</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label className="field">
        Email
        <input type="email" name="email" autoComplete="username" required autoFocus />
      </label>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}
