import { describe, expect, it } from "vitest";
import { isPublicViewRequest, publicViewEnabled } from "@/auth/public-view";
import { can } from "@/auth/roles";

const RUN = "3f2b1c4e-1111-4222-8333-444455556666";

describe("public view (anyone with the link, read-only)", () => {
  it("is off unless PUBLIC_VIEW=1", () => {
    const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
    expect(publicViewEnabled(env({}))).toBe(false);
    expect(publicViewEnabled(env({ PUBLIC_VIEW: "0" }))).toBe(false);
    expect(publicViewEnabled(env({ PUBLIC_VIEW: "true" }))).toBe(false);
    expect(publicViewEnabled(env({ PUBLIC_VIEW: "1" }))).toBe(true);
  });

  it("when off, nothing gets through without a session", () => {
    for (const path of ["/", "/health", "/api/health", `/api/run/${RUN}/events`]) expect(isPublicViewRequest("GET", path, false)).toBe(false);
  });

  it("when on, lets through only GETs of pages, the run progress stream and the health check", () => {
    for (const path of ["/", "/settings", "/health", "/data", "/outcomes", "/zoho", "/backtest", "/compare", `/export`]) {
      expect(isPublicViewRequest("GET", path, true), path).toBe(true);
      expect(isPublicViewRequest("HEAD", path, true), path).toBe(true);
    }
    expect(isPublicViewRequest("GET", `/api/run/${RUN}/events`, true)).toBe(true);
    expect(isPublicViewRequest("GET", "/api/health", true)).toBe(true);
  });

  it("never lets through anything that changes data or exports it, whatever the path", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const path of ["/", "/api/run", "/api/kill/stop", "/api/kill/clear", "/api/recommendations/x/decision", "/api/settings/config", "/api/ingest/sales", "/api/zoho/push", "/api/auth/verify"]) {
        expect(isPublicViewRequest(method, path, true), `${method} ${path}`).toBe(false);
      }
    }
    for (const path of ["/api/export/approved", "/api/backtest/export", "/api/cron/run", "/api/cron/kill-check", "/api/run", "/api/compare", "/api/outcomes/weekly", `/api/run/${RUN}/advance`, "/api/run/not-a-uuid/events", "/api/health/extra"]) {
      expect(isPublicViewRequest("GET", path, true), path).toBe(false);
    }
  });

  it("an anonymous visitor has no permission except to view", () => {
    for (const perm of ["decide", "run", "upload", "editRules", "editSwitches", "editKill", "clearKill", "stop", "outcomes", "export", "backtest", "manageUsers"] as const) {
      expect(can(null, perm), perm).toBe(false);
    }
    expect(can(null, "view")).toBe(false); // route guards still ask for a session; the pages themselves are what is public
  });
});
