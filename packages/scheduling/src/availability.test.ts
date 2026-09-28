import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { availableIntervals, resolveLocalInterval, localDayStart } from "./availability";
import type { Resource } from "./types";

const ZONE = "Europe/Prague";
const ms = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();

const monFri: Resource = {
  id: "anna",
  kind: "staff",
  rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday: weekday as 1, start: "09:00", end: "17:00" })),
};

describe("availableIntervals", () => {
  it("expands weekly rules per local day and clips to window", () => {
    // Mon 2026-03-23 .. Wed 2026-03-25 (partial)
    const out = availableIntervals(monFri, ms("2026-03-23T00:00"), ms("2026-03-25T12:00"), ZONE);
    expect(out).toEqual([
      { start: ms("2026-03-23T09:00"), end: ms("2026-03-23T17:00") },
      { start: ms("2026-03-24T09:00"), end: ms("2026-03-24T17:00") },
      { start: ms("2026-03-25T09:00"), end: ms("2026-03-25T12:00") },
    ]);
  });

  it("weekend has no rules -> empty; resources without rules are always available", () => {
    expect(availableIntervals(monFri, ms("2026-03-28T00:00"), ms("2026-03-30T00:00"), ZONE)).toEqual(
      [],
    );
    expect(
      availableIntervals({ id: "chair", kind: "chair" }, 100, 200, ZONE),
    ).toEqual([{ start: 100, end: 200 }]);
  });

  it("date override replaces rules (day off and extra day)", () => {
    const r: Resource = {
      ...monFri,
      overrides: [
        { date: "2026-03-24", intervals: [] },
        { date: "2026-03-28", intervals: [{ start: "10:00", end: "14:00" }] },
      ],
    };
    const out = availableIntervals(r, ms("2026-03-24T00:00"), ms("2026-03-29T00:00"), ZONE);
    expect(out.map((i) => [DateTime.fromMillis(i.start, { zone: ZONE }).toISO({ suppressMilliseconds: true }), DateTime.fromMillis(i.end, { zone: ZONE }).toISO({ suppressMilliseconds: true })])).toEqual([
      ["2026-03-25T09:00:00+01:00", "2026-03-25T17:00:00+01:00"],
      ["2026-03-26T09:00:00+01:00", "2026-03-26T17:00:00+01:00"],
      ["2026-03-27T09:00:00+01:00", "2026-03-27T17:00:00+01:00"],
      ["2026-03-28T10:00:00+01:00", "2026-03-28T14:00:00+01:00"],
    ]);
  });

  it("overnight rule spills into next day and is captured from previous day", () => {
    const night: Resource = {
      id: "n",
      kind: "staff",
      rules: [{ weekday: 5, start: "22:00", end: "02:00" }], // Friday night
    };
    // window: Saturday 00:00 - 06:00 must include 00:00-02:00 from Friday's rule
    const out = availableIntervals(night, ms("2026-03-28T00:00"), ms("2026-03-28T06:00"), ZONE);
    expect(out).toEqual([{ start: ms("2026-03-28T00:00"), end: ms("2026-03-28T02:00") }]);
  });

  describe("DST golden tests (Europe/Prague)", () => {
    it("spring forward 2026-03-29: 09:00-17:00 shift is still 8 hours, day is 23h", () => {
      const day = localDayStart("2026-03-29", ZONE);
      expect(day.plus({ days: 1 }).diff(day, "hours").hours).toBe(23);
      const { start, end } = resolveLocalInterval(day, { start: "09:00", end: "17:00" });
      expect((end - start) / 3_600_000).toBe(8);
      expect(DateTime.fromMillis(start, { zone: ZONE }).offset).toBe(120); // +02:00 after switch
    });

    it("spring forward: a 01:30-03:30 shift loses the non-existent hour", () => {
      const day = localDayStart("2026-03-29", ZONE);
      const { start, end } = resolveLocalInterval(day, { start: "01:30", end: "03:30" });
      // 01:30 CET -> 03:30 CEST is 1 hour of real time
      expect((end - start) / 3_600_000).toBe(1);
    });

    it("fall back 2026-10-25: day is 25h, 09:00-17:00 still 8h", () => {
      const day = localDayStart("2026-10-25", ZONE);
      expect(day.plus({ days: 1 }).diff(day, "hours").hours).toBe(25);
      const { start, end } = resolveLocalInterval(day, { start: "09:00", end: "17:00" });
      expect((end - start) / 3_600_000).toBe(8);
      expect(DateTime.fromMillis(start, { zone: ZONE }).offset).toBe(60);
    });

    it("fall back: overnight 22:00-04:00 across the switch is 7 real hours", () => {
      const day = localDayStart("2026-10-24", ZONE);
      const { start, end } = resolveLocalInterval(day, { start: "22:00", end: "04:00" });
      expect((end - start) / 3_600_000).toBe(7);
    });
  });
});
