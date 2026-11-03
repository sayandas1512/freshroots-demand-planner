import { describe, expect, it } from "vitest";
import { publicOrigin } from "@/lib/origin";

const req = (url: string) => new Request(url);
const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;

describe("publicOrigin", () => {
  it("uses the public APP_URL even when the request came in on the protected deployment address", () => {
    expect(publicOrigin(req("https://freshroots-planner-6yv98oyam-team.vercel.app/api/cron/run"), env({ APP_URL: "https://freshroots-planner-wheat.vercel.app/" }))).toBe("https://freshroots-planner-wheat.vercel.app");
  });

  it("falls back to the request's own origin when APP_URL is missing or malformed", () => {
    expect(publicOrigin(req("http://localhost:3200/api/run"), env({}))).toBe("http://localhost:3200");
    expect(publicOrigin(req("http://localhost:3200/api/run"), env({ APP_URL: "not a url" }))).toBe("http://localhost:3200");
    expect(publicOrigin(req("http://localhost:3200/api/run"), env({ APP_URL: "  " }))).toBe("http://localhost:3200");
  });
});
