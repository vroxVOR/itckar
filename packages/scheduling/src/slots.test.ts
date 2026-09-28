import { describe, expect, it } from "vitest";
import { checkSlot, findSlots, groupSlotsByDay, SchedulingError } from "./slots.js";
import { anna, bob, chair1, chair2, colour, fmt, haircut, massage, room1, t, ZONE } from "./fixtures.js";

// Monday 2026-03-23
const DAY_FROM = t("2026-03-23T00:00");
const DAY_TO = t("2026-03-24T00:00");

const base = { zone: ZONE, from: DAY_FROM, to: DAY_TO, resources: [anna, bob, chair1, chair2, room1], busy: [] };

describe("findSlots: basics", () => {
  it("returns haircut slots within staff hours on a 15-minute grid, preferring first candidate", () => {
    const slots = findSlots({ ...base, cart: [{ service: haircut }] });
    const starts = slots.map((s) => fmt(s.start));
    expect(starts[0]).toBe("2026-03-23 09:00");
    // union of anna (9-17) and bob (12-20): last 30 min haircut starts 19:30
    expect(starts.at(-1)).toBe("2026-03-23 19:30");
    expect(starts).toContain("2026-03-23 16:45"); // anna can still finish by 17:15? no -> bob covers
    expect(slots[0]!.assignments).toEqual([
      { cartIndex: 0, key: "staff", resourceId: "anna" },
      { cartIndex: 0, key: "chair", resourceId: "chair1" },
    ]);
    // 09:00 slot: only anna available
    const late = slots.find((s) => fmt(s.start) === "2026-03-23 18:00")!;
    expect(late.assignments[0]!.resourceId).toBe("bob");
    expect(slots.every((s) => s.end - s.start === 30 * 60_000)).toBe(true);
  });

  it("returns nothing on a day nobody works", () => {
    const slots = findSlots({ ...base, from: t("2026-03-22T00:00"), to: t("2026-03-23T00:00"), cart: [{ service: haircut }] });
    expect(slots).toEqual([]);
  });

  it("respects the step size and minimum notice", () => {
    const slots = findSlots({
      ...base,
      cart: [{ service: haircut }],
      stepMin: 30,
      now: t("2026-03-23T10:10"),
      minNoticeMin: 60,
    });
    expect(fmt(slots[0]!.start)).toBe("2026-03-23 11:30");
    expect(slots.every((s) => new Date(s.start).getMinutes() % 30 === 0)).toBe(true);
  });

  it("pinning a staff member restricts to their hours", () => {
    const slots = findSlots({ ...base, cart: [{ service: haircut, pin: { staff: "bob" } }] });
    expect(fmt(slots[0]!.start)).toBe("2026-03-23 12:00");
    expect(slots.every((s) => s.assignments[0]!.resourceId === "bob")).toBe(true);
  });

  it("rejects invalid pins and unknown resources", () => {
    expect(() => findSlots({ ...base, cart: [{ service: haircut, pin: { staff: "nobody" } }] })).toThrow(SchedulingError);
    // unknown candidates are skipped; only when none remain it is an error
    expect(() =>
      findSlots({ ...base, resources: [anna, bob], cart: [{ service: haircut }] }),
    ).toThrow(/no known candidates/);
    expect(findSlots({ ...base, resources: [anna, chair1], cart: [{ service: haircut }] }).length).toBe(31);
    expect(() => findSlots({ ...base, cart: [] })).toThrow(/empty/);
  });
});

describe("findSlots: processing time (hair colour)", () => {
  it("stylist is bookable for a haircut during the processing gap of a colour", () => {
    // Anna colours 09:00-10:45: apply 09:00-09:30 (anna+chair1), process 09:30-10:15 (chair1), finish 10:15-10:45 (anna+chair1)
    const busy = [
      { resourceId: "anna", start: t("2026-03-23T09:00"), end: t("2026-03-23T09:30"), ref: "a1" },
      { resourceId: "chair1", start: t("2026-03-23T09:00"), end: t("2026-03-23T10:45"), ref: "a1" },
      { resourceId: "anna", start: t("2026-03-23T10:15"), end: t("2026-03-23T10:45"), ref: "a1" },
    ];
    const slots = findSlots({ ...base, resources: [anna, chair1, chair2], busy, cart: [{ service: haircut }] });
    const starts = slots.map((s) => fmt(s.start));
    expect(starts).toContain("2026-03-23 09:30"); // in the gap
    expect(starts).toContain("2026-03-23 09:45"); // 09:45-10:15 still in the gap
    expect(starts).not.toContain("2026-03-23 10:00"); // would overlap finish at 10:15
    expect(starts).not.toContain("2026-03-23 09:15");
    const gap = slots.find((s) => fmt(s.start) === "2026-03-23 09:30")!;
    expect(gap.assignments.find((a) => a.key === "chair")!.resourceId).toBe("chair2");
  });

  it("colour slot reports segments with resolved resources and staff-free processing", () => {
    const slots = findSlots({ ...base, resources: [anna, chair1], cart: [{ service: colour }] });
    const s = slots[0]!;
    expect(fmt(s.start)).toBe("2026-03-23 09:00");
    expect(fmt(s.end)).toBe("2026-03-23 10:45");
    expect(s.segments.map((x) => [x.kind, x.resourceIds])).toEqual([
      ["active", ["anna", "chair1"]],
      ["processing", ["chair1"]],
      ["active", ["anna", "chair1"]],
    ]);
    // last colour must finish by 17:00 -> starts 15:15
    expect(fmt(slots.at(-1)!.start)).toBe("2026-03-23 15:15");
  });

  it("without a free chair, the processing gap cannot host another colour", () => {
    const busy = [{ resourceId: "chair1", start: t("2026-03-23T09:00"), end: t("2026-03-23T10:45") }];
    const slots = findSlots({ ...base, resources: [anna, bob, chair1], busy, cart: [{ service: colour }] });
    expect(fmt(slots[0]!.start)).toBe("2026-03-23 10:45");
  });
});

describe("findSlots: multi-service cart", () => {
  it("books services back to back and keeps the same stylist when possible", () => {
    const slots = findSlots({ ...base, cart: [{ service: colour }, { service: haircut }] });
    const s = slots[0]!;
    expect(fmt(s.start)).toBe("2026-03-23 09:00");
    expect(fmt(s.end)).toBe("2026-03-23 11:15");
    const staff = s.assignments.filter((a) => a.key === "staff").map((a) => a.resourceId);
    expect(staff).toEqual(["anna", "anna"]);
  });

  it("switches stylist for the second service if the first one is not available", () => {
    // anna busy 11:15-11:45 -> haircut after a 09:00 colour must go to bob? bob starts at 12:00, so no.
    // Instead: colour at 14:15-16:00 then haircut 16:00-16:30 by anna busy -> bob takes it.
    const busy = [{ resourceId: "anna", start: t("2026-03-23T16:00"), end: t("2026-03-23T17:00") }];
    const slots = findSlots({ ...base, busy, cart: [{ service: colour }, { service: haircut }] });
    const s = slots.find((x) => fmt(x.start) === "2026-03-23 14:15")!;
    expect(s.assignments.filter((a) => a.key === "staff").map((a) => a.resourceId)).toEqual(["anna", "bob"]);
  });
});

describe("findSlots: buffers", () => {
  it("buffer after widens occupancy but not the reported slot end", () => {
    const busy = [{ resourceId: "anna", start: t("2026-03-23T11:00"), end: t("2026-03-23T12:00") }];
    const slots = findSlots({ ...base, busy, cart: [{ service: massage }] });
    const starts = slots.map((s) => fmt(s.start));
    expect(starts).toContain("2026-03-23 09:45"); // ends 10:45 + 15 buffer = 11:00 OK
    expect(starts).not.toContain("2026-03-23 10:00"); // buffer would overlap 11:00
    expect(starts).toContain("2026-03-23 12:00");
    const s = slots.find((x) => fmt(x.start) === "2026-03-23 09:45")!;
    expect(fmt(s.end)).toBe("2026-03-23 10:45");
    // last: 15:45-16:45 + buffer to 17:00
    expect(starts.at(-1)).toBe("2026-03-23 15:45");
  });
});

describe("findSlots: rescheduling and grouping", () => {
  it("ignoreRef lets a booking be moved over its own footprint", () => {
    const busy = [{ resourceId: "anna", start: t("2026-03-23T09:00"), end: t("2026-03-23T17:00"), ref: "mine" }];
    expect(findSlots({ ...base, resources: [anna, chair1], busy, cart: [{ service: haircut }] })).toEqual([]);
    const slots = findSlots({ ...base, resources: [anna, chair1], busy, ignoreRef: "mine", cart: [{ service: haircut }] });
    expect(slots.length).toBe(31);
  });

  it("groups by local day across a DST switch", () => {
    const slots = findSlots({
      ...base,
      from: t("2026-03-28T00:00"),
      to: t("2026-03-31T00:00"),
      resources: [{ ...anna, rules: [{ weekday: 7, start: "09:00", end: "12:00" }, { weekday: 1, start: "09:00", end: "12:00" }] }, chair1],
      cart: [{ service: haircut }],
    });
    const byDay = groupSlotsByDay(slots, ZONE);
    expect([...byDay.keys()]).toEqual(["2026-03-29", "2026-03-30"]);
    expect(byDay.get("2026-03-29")!.map((s) => fmt(s.start))[0]).toBe("2026-03-29 09:00");
    expect(byDay.get("2026-03-29")!.length).toBe(11); // 09:00..11:30
  });
});

describe("checkSlot", () => {
  const cart = [{ service: haircut }];
  it("accepts a valid slot and returns placements", () => {
    const r = checkSlot({
      zone: ZONE, resources: base.resources, busy: [], cart,
      start: t("2026-03-23T10:00"),
      assignments: [
        { cartIndex: 0, key: "staff", resourceId: "anna" },
        { cartIndex: 0, key: "chair", resourceId: "chair1" },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.slot.segments[0]!.resourceIds).toEqual(["anna", "chair1"]);
  });
  it("distinguishes unavailable, busy, too_soon and invalid assignments", () => {
    const assignments = [
      { cartIndex: 0, key: "staff", resourceId: "anna" },
      { cartIndex: 0, key: "chair", resourceId: "chair1" },
    ];
    expect(checkSlot({ zone: ZONE, resources: base.resources, busy: [], cart, start: t("2026-03-23T08:00"), assignments })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(
      checkSlot({
        zone: ZONE, resources: base.resources, cart, start: t("2026-03-23T10:00"), assignments,
        busy: [{ resourceId: "chair1", start: t("2026-03-23T10:15"), end: t("2026-03-23T10:30") }],
      }),
    ).toMatchObject({ ok: false, reason: "busy" });
    expect(checkSlot({ zone: ZONE, resources: base.resources, busy: [], cart, start: t("2026-03-23T10:00"), now: t("2026-03-23T09:50"), minNoticeMin: 30, assignments })).toMatchObject({ ok: false, reason: "too_soon" });
    expect(checkSlot({ zone: ZONE, resources: base.resources, busy: [], cart, start: t("2026-03-23T10:00"), assignments: [assignments[0]!] })).toMatchObject({ ok: false, reason: "invalid_assignment" });
    expect(checkSlot({ zone: ZONE, resources: base.resources, busy: [], cart, start: t("2026-03-23T10:00"), assignments: [assignments[0]!, { cartIndex: 0, key: "chair", resourceId: "room1" }] })).toMatchObject({ ok: false, reason: "invalid_assignment" });
  });
});
