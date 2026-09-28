import { describe, expect, it } from "vitest";
import { covers, intersect, normalize, subtract } from "./intervals";

const iv = (s: number, e: number) => ({ start: s, end: e });

describe("normalize", () => {
  it("merges overlapping and touching intervals and drops empties", () => {
    expect(normalize([iv(5, 10), iv(0, 5), iv(8, 12), iv(20, 20), iv(30, 25)])).toEqual([
      iv(0, 12),
    ]);
  });
});

describe("subtract", () => {
  it("cuts holes and clips edges", () => {
    expect(subtract([iv(0, 100)], [iv(10, 20), iv(30, 40)])).toEqual([
      iv(0, 10),
      iv(20, 30),
      iv(40, 100),
    ]);
    expect(subtract([iv(0, 100)], [iv(-5, 5), iv(95, 200)])).toEqual([iv(5, 95)]);
    expect(subtract([iv(0, 100)], [iv(0, 100)])).toEqual([]);
    expect(subtract([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(0, 5), iv(25, 30)]);
  });
});

describe("intersect", () => {
  it("intersects sorted lists", () => {
    expect(intersect([iv(0, 10), iv(20, 30)], [iv(5, 25)])).toEqual([iv(5, 10), iv(20, 25)]);
    expect(intersect([iv(0, 10)], [iv(10, 20)])).toEqual([]);
  });
});

describe("covers", () => {
  const free = [iv(0, 10), iv(20, 30), iv(40, 50)];
  it("detects containment via binary search", () => {
    expect(covers(free, 20, 30)).toBe(true);
    expect(covers(free, 21, 29)).toBe(true);
    expect(covers(free, 19, 25)).toBe(false);
    expect(covers(free, 25, 31)).toBe(false);
    expect(covers(free, 10, 20)).toBe(false);
    expect(covers(free, 45, 45)).toBe(true);
    expect(covers([], 0, 1)).toBe(false);
  });
});
