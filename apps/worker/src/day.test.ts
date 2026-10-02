import { describe, expect, it } from "vitest";
import { jstDay } from "./day";

describe("JST quota day", () => {
  it.each([
    ["2026-10-01T14:59:59.999Z", "2026-10-01"],
    ["2026-10-01T15:00:00.000Z", "2026-10-02"],
    ["2026-12-31T15:00:00Z", "2027-01-01"],
  ])("maps %s to %s", (instant, day) => {
    expect(jstDay(new Date(instant))).toBe(day);
    expect(jstDay(Date.parse(instant))).toBe(day);
  });
});
