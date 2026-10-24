import { describe, expect, it } from "vitest";
import { formatIst } from "@/lib/dates";

describe("formatIst", () => {
  it("is India time, fixed format, whatever the machine's zone", () => {
    expect(formatIst("2026-10-23T07:11:48.644Z")).toBe("23/10/2026, 12:41:48");
    expect(formatIst("2026-12-31T19:00:00Z")).toBe("01/01/2027, 00:30:00");
  });
});
