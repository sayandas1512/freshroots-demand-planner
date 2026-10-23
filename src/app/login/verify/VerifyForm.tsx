"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function VerifyForm({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      if (res.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not sign in.");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="login-sent">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || token === ""} data-testid="confirm-signin">{busy ? "Signing in…" : "Sign in"}</button>
      {error ? <p className="small"><Link href="/login">Ask for a new link</Link></p> : null}
    </div>
  );
}
