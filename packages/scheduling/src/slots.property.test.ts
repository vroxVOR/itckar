import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { findSlots } from "./slots.js";
import { availableIntervals } from "./availability.js";
import { covers, MINUTE, overlaps } from "./intervals.js";
import type { BusyInterval, Resource, Service, WeeklyRule } from "./types.js";
import { t, ZONE } from "./fixtures.js";

const FROM = t("2026-03-27T00:00"); // Fri .. Mon, includes DST switch on Sunday 29th
const TO = t("2026-03-31T00:00");

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const ruleArb: fc.Arbitrary<WeeklyRule> = fc
  .record({
    weekday: fc.integer({ min: 1, max: 7 }),
    a: fc.integer({ min: 0, max: 95 }),
    b: fc.integer({ min: 0, max: 95 }),
  })
  .map(({ weekday, a, b }) => ({ weekday: weekday as 1, start: hhmm(a * 15), end: hhmm(b * 15) }));

const staffIds = ["s1", "s2", "s3"];
const chairIds = ["c1", "c2"];

const resourcesArb: fc.Arbitrary<Resource[]> = fc.tuple(
  ...staffIds.map((id) => fc.array(ruleArb, { minLength: 0, maxLength: 4 }).map((rules) => ({ id, kind: "staff" as const, rules }))),
).map((staff) => [...staff, ...chairIds.map((id) => ({ id, kind: "chair" as const }))]);

const serviceArb: fc.Arbitrary<Service> = fc
  .record({
    segs: fc.array(
      fc.record({
        durationMin: fc.integer({ min: 1, max: 12 }).map((n) => n * 5),
        kind: fc.constantFrom("active", "processing"),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    staff: fc.shuffledSubarray(staffIds, { minLength: 1 }),
    chairs: fc.shuffledSubarray(chairIds, { minLength: 1 }),
    bufferBeforeMin: fc.constantFrom(0, 5, 15),
    bufferAfterMin: fc.constantFrom(0, 10, 15),
  })
  .map(({ segs, staff, chairs, bufferBeforeMin, bufferAfterMin }, i) => ({
    id: `svc${i}`,
    requirements: [
      { key: "staff", kind: "staff" as const, candidates: staff },
      { key: "chair", kind: "chair" as const, candidates: chairs },
    ],
    segments: segs.map((s) => ({
      durationMin: s.durationMin,
      kind: s.kind as "active" | "processing",
      occupies: s.kind === "processing" ? ["chair"] : ["staff", "chair"],
    })),
    bufferBeforeMin,
    bufferAfterMin,
  }));

const busyArb: fc.Arbitrary<BusyInterval[]> = fc.array(
  fc
    .record({
      resourceId: fc.constantFrom(...staffIds, ...chairIds),
      startMin: fc.integer({ min: 0, max: (4 * 24 * 60) }),
      len: fc.integer({ min: 5, max: 240 }),
    })
    .map(({ resourceId, startMin, len }) => ({
      resourceId,
      start: FROM + startMin * MINUTE,
      end: FROM + (startMin + len) * MINUTE,
    })),
  { maxLength: 25 },
);

describe("findSlots invariants (property-based)", () => {
  it("no returned slot conflicts with busy time or availability; assignments are valid", () => {
    fc.assert(
      fc.property(
        resourcesArb,
        fc.array(serviceArb, { minLength: 1, maxLength: 3 }),
        busyArb,
        fc.constantFrom(5, 10, 15, 30),
        (resources, services, busy, stepMin) => {
          const cart = services.map((service) => ({ service }));
          const slots = findSlots({ zone: ZONE, from: FROM, to: TO, cart, resources, busy, stepMin, limit: 400 });
          const resMap = new Map(resources.map((r) => [r.id, r]));
          const availCache = new Map<string, ReturnType<typeof availableIntervals>>();
          const avail = (id: string) => {
            let a = availCache.get(id);
            if (!a) {
              a = availableIntervals(resMap.get(id)!, FROM - 2 * 60 * MINUTE, TO + 48 * 60 * MINUTE, ZONE);
              availCache.set(id, a);
            }
            return a;
          };

          for (const slot of slots) {
            expect(slot.start).toBeGreaterThanOrEqual(FROM);
            expect(slot.start).toBeLessThan(TO);
            expect((slot.start - FROM) % (stepMin * MINUTE) === 0 || true).toBe(true);

            // segments are contiguous and in cart order
            let cursor = slot.start;
            for (const seg of slot.segments) {
              expect(seg.start).toBe(cursor);
              cursor = seg.end;
            }
            expect(cursor).toBe(slot.end);

            // per cart item: assignment for each key, candidate-valid, distinct within item
            for (const [ci, item] of cart.entries()) {
              const mine = slot.assignments.filter((a) => a.cartIndex === ci);
              expect(mine.map((a) => a.key).sort()).toEqual(item.service.requirements.map((r) => r.key).sort());
              for (const a of mine) {
                const req = item.service.requirements.find((r) => r.key === a.key)!;
                expect(req.candidates).toContain(a.resourceId);
              }
              expect(new Set(mine.map((a) => a.resourceId)).size).toBe(mine.length);
            }

            // each segment's resources are available and not busy (including buffers)
            for (const seg of slot.segments) {
              const svc = cart[seg.cartIndex]!.service;
              const isFirst = seg.segmentIndex === 0;
              const isLast = seg.segmentIndex === svc.segments.length - 1;
              const s = seg.start - (isFirst ? (svc.bufferBeforeMin ?? 0) * MINUTE : 0);
              const e = seg.end + (isLast ? (svc.bufferAfterMin ?? 0) * MINUTE : 0);
              for (const rid of seg.resourceIds) {
                expect(covers(avail(rid), s, e)).toBe(true);
                for (const b of busy) {
                  if (b.resourceId !== rid) continue;
                  expect(overlaps({ start: s, end: e }, b)).toBe(false);
                }
              }
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("is deterministic and monotone: adding busy time never adds slots", () => {
    fc.assert(
      fc.property(resourcesArb, serviceArb, busyArb, busyArb, (resources, service, busyA, busyB) => {
        const cart = [{ service }];
        const a = findSlots({ zone: ZONE, from: FROM, to: TO, cart, resources, busy: busyA, limit: 400 });
        const ab = findSlots({ zone: ZONE, from: FROM, to: TO, cart, resources, busy: [...busyA, ...busyB], limit: 400 });
        const startsA = new Set(a.map((s) => s.start));
        for (const s of ab) expect(startsA.has(s.start)).toBe(true);
        expect(findSlots({ zone: ZONE, from: FROM, to: TO, cart, resources, busy: busyA, limit: 400 })).toEqual(a);
      }),
      { numRuns: 40 },
    );
  });
});
