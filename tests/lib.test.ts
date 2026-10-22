import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAlertEmail } from "@/lib/email";
import { logLine, redact } from "@/lib/log";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("alert email (Resend)", () => {
  it("is skipped without keys and never throws", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ALERT_EMAIL", "");
    expect(await sendAlertEmail({ subject: "s", text: "t" }, vi.fn() as unknown as typeof fetch)).toBe(false);
  });
  it("posts to Resend with the bearer key and the recipients, and reports success", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ALERT_EMAIL", "deepa@x.test, it@x.test");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sendAlertEmail({ subject: "Kill", text: "body" }, fetchMock as unknown as typeof fetch)).toBe(true);
    const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(call[0]).toBe("https://api.resend.com/emails");
    expect(call[1].headers.authorization).toBe("Bearer re_test");
    expect(JSON.parse(call[1].body)).toMatchObject({ to: ["deepa@x.test", "it@x.test"], subject: "Kill" });
  });
  it("returns false on an API error or a network failure, so the banner still stands", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ALERT_EMAIL", "a@x.test");
    expect(await sendAlertEmail({ subject: "s", text: "t" }, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch)).toBe(false);
    expect(await sendAlertEmail({ subject: "s", text: "t" }, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe(false);
  });
});

describe("structured logs", () => {
  it("emit one JSON object with a run id and redact secrets and prompts at any depth", () => {
    const line = logLine("info", "run step", { runId: "r1", apiKey: "sk-secret", nested: { password: "p", prompt: "full prompt text", ok: 1 }, headers: { authorization: "Bearer x" } }, new Date("2026-10-19T00:00:00Z"));
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({ t: "2026-10-19T00:00:00.000Z", level: "info", msg: "run step", runId: "r1", apiKey: "[redacted]" });
    expect(parsed.nested).toEqual({ password: "[redacted]", prompt: "[redacted]", ok: 1 });
    expect(parsed.headers).toEqual({ authorization: "[redacted]" });
    expect(line).not.toContain("sk-secret");
    expect(line).not.toContain("full prompt text");
    expect(redact({ token: "t", arr: [1] })).toEqual({ token: "[redacted]", arr: [1] });
  });
});
