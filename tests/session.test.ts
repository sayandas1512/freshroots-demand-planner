import { describe, expect, it } from "vitest";
import { bearerMatches, createSessionValue, verifySessionValue } from "@/auth/session";
import { rateLimit, resetRateLimits } from "@/lib/ratelimit";

const UID = "11111111-2222-3333-4444-555555555555";

describe("session cookie", () => {
  it("round-trips user and role, and rejects tampering, expiry, another secret and malformed values", async () => {
    const value = await createSessionValue("secret", { userId: UID, role: "planner" }, 1_000);
    expect(await verifySessionValue("secret", value, 1_001)).toEqual({ userId: UID, role: "planner" });
    expect(await verifySessionValue("other", value, 1_001)).toBeNull();
    expect(await verifySessionValue("secret", value, 1_000 + 60 * 60 * 13)).toBeNull();
    expect(await verifySessionValue("secret", value.replace(".planner.", ".admin."), 1_001)).toBeNull();
    expect(await verifySessionValue("secret", `${value}0`, 1_001)).toBeNull();
    expect(await verifySessionValue("secret", undefined, 1_001)).toBeNull();
    expect(await verifySessionValue("secret", "garbage", 1_001)).toBeNull();
  });

  it("matches bearer tokens in constant time and rejects missing secrets", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("Bearer abd", "abc")).toBe(false);
    expect(bearerMatches(null, "abc")).toBe(false);
    expect(bearerMatches("Bearer abc", undefined)).toBe(false);
  });
});

describe("rateLimit", () => {
  it("blocks after the limit and recovers after the window", () => {
    resetRateLimits();
    expect(rateLimit("k", 2, 1000, 0).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, 1).ok).toBe(true);
    expect(rateLimit("k", 2, 1000, 2).ok).toBe(false);
    expect(rateLimit("k", 2, 1000, 1001).ok).toBe(true);
  });
});
