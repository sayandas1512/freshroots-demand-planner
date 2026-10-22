import { describe, expect, it } from "vitest";
import { bearerMatches, createSessionValue, verifySessionValue } from "@/auth/session";
import { rateLimit, resetRateLimits } from "@/lib/ratelimit";

describe("session cookie", () => {
  it("verifies a fresh value and rejects tampering, expiry and a different secret", async () => {
    const value = await createSessionValue("secret", 1_000);
    expect(await verifySessionValue("secret", value, 1_001)).toBe(true);
    expect(await verifySessionValue("other", value, 1_001)).toBe(false);
    expect(await verifySessionValue("secret", value, 1_000 + 60 * 60 * 13)).toBe(false);
    expect(await verifySessionValue("secret", `${value}0`, 1_001)).toBe(false);
    expect(await verifySessionValue("secret", undefined, 1_001)).toBe(false);
    expect(await verifySessionValue("secret", "garbage", 1_001)).toBe(false);
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
