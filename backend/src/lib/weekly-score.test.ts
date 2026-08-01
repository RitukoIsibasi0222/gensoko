import { describe, expect, it } from "vitest";
import { getWeeklyScoreWeekStart, isSameWeeklyScoreWeek } from "./weekly-score.js";

describe("weekly score helpers", () => {
  it("returns the Monday 00:00 JST week start as a UTC instant", () => {
    const weekStart = getWeeklyScoreWeekStart(new Date("2026-07-02T12:00:00.000Z"));

    expect(weekStart).toEqual(new Date("2026-06-28T15:00:00.000Z"));
  });

  it("switches weeks at Monday 00:00 JST", () => {
    expect(getWeeklyScoreWeekStart(new Date("2026-06-28T14:59:59.999Z"))).toEqual(
      new Date("2026-06-21T15:00:00.000Z"),
    );
    expect(getWeeklyScoreWeekStart(new Date("2026-06-28T15:00:00.000Z"))).toEqual(
      new Date("2026-06-28T15:00:00.000Z"),
    );
  });

  it("compares week identifiers by timestamp and treats null as different", () => {
    const weekStart = new Date("2026-06-28T15:00:00.000Z");

    expect(isSameWeeklyScoreWeek(new Date("2026-06-28T15:00:00.000Z"), weekStart)).toBe(true);
    expect(isSameWeeklyScoreWeek(new Date("2026-06-21T15:00:00.000Z"), weekStart)).toBe(false);
    expect(isSameWeeklyScoreWeek(null, weekStart)).toBe(false);
  });
});
