"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
  kind?: string;
  pages?: string[];
}

const SUGGESTIONS = [
  "Which SKUs need a reorder now, and why?",
  "What is still waiting for approval?",
  "Is the kill switch on, and how close are we to it?",
  "How does the system decide a reorder?",
  "What has been sent to Zoho?",
];

const PAGE_HREF: Record<string, string> = { Review: "/", Settings: "/settings", Data: "/data", Outcomes: "/outcomes", Zoho: "/zoho", Health: "/health", Backtest: "/backtest", Compare: "/compare", Export: "/" };

export function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = messages.filter((m) => m.kind === undefined || m.kind === "answer").map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: question }]);
    setDraft("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
      const json = (await res.json()) as { kind?: string; answer?: string; pages?: string[]; error?: string };
      setMessages((m) => [...m, { role: "assistant", text: json.answer ?? json.error ?? "Something went wrong.", kind: json.kind ?? "error", pages: json.pages }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't reach the server. The dashboard pages have the same information.", kind: "error" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat" data-testid="chat">
      {open ? (
        <section className="chat-panel card" role="dialog" aria-label="Ask the planner">
          <header className="chat-head">
            <div>
              <strong>Ask the planner</strong>
              <p className="small muted">Read-only. Answers come from this dashboard&apos;s data only and are checked before they appear.</p>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)} aria-label="Close the assistant">Close</button>
          </header>
          <div className="chat-log" aria-live="polite" aria-relevant="additions" data-testid="chat-log">
            {messages.length === 0 ? (
              <div className="chat-empty">
                <p className="small muted">Try one of these:</p>
                <div className="chat-chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="chip chip-plain chat-chip" onClick={() => void send(s)}>{s}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg chat-${m.role}${m.kind && m.kind !== "answer" ? " chat-note" : ""}`} data-testid={`chat-${m.role}`}>
                <p>{m.text}</p>
                {m.pages && m.pages.length > 0 ? (
                  <p className="small chat-pages">See: {m.pages.map((p, j) => <span key={p}>{j > 0 ? ", " : ""}<Link href={PAGE_HREF[p] ?? "/"}>{p}</Link></span>)}</p>
                ) : null}
              </div>
            ))}
            {busy ? <div className="chat-msg chat-assistant chat-note" role="status"><p>Checking the dashboard…</p></div> : null}
            <div ref={end} />
          </div>
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <label className="sr-only" htmlFor="chat-input">Your question</label>
            <textarea
              id="chat-input"
              ref={input}
              rows={2}
              maxLength={500}
              value={draft}
              placeholder="Ask about a SKU, the kill switch, Zoho, the rules…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !draft.trim()} data-testid="chat-send">Ask</button>
          </form>
        </section>
      ) : null}
      <button type="button" className="btn btn-primary chat-launch" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="chat-launch">
        {open ? "Hide assistant" : "Ask the planner"}
      </button>
    </div>
  );
}
