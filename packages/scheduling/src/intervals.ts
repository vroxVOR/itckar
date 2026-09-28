import type { Interval, Ms } from "./types";

export const MINUTE = 60_000;

/** Sort by start and merge overlapping/touching intervals. Drops empty intervals. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      if (iv.end > last.end) last.end = iv.end;
    } else {
      out.push({ start: iv.start, end: iv.end });
    }
  }
  return out;
}

/** a \ b for normalized inputs. */
export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let j = 0;
  for (const iv of a) {
    let cursor = iv.start;
    // skip b intervals entirely before this a interval
    while (j < b.length && b[j]!.end <= iv.start) j++;
    let k = j;
    while (k < b.length && b[k]!.start < iv.end) {
      const cut = b[k]!;
      if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, iv.end) });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= iv.end) break;
      k++;
    }
    if (cursor < iv.end) out.push({ start: cursor, end: iv.end });
  }
  return out;
}

/** a ∩ b for normalized inputs. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i]!.start, b[j]!.start);
    const e = Math.min(a[i]!.end, b[j]!.end);
    if (s < e) out.push({ start: s, end: e });
    if (a[i]!.end < b[j]!.end) i++;
    else j++;
  }
  return out;
}

/** True if [start, end) is fully contained in one interval of the normalized list. */
export function covers(free: readonly Interval[], start: Ms, end: Ms): boolean {
  if (end <= start) return true;
  // binary search for the last interval with start <= `start`
  let lo = 0;
  let hi = free.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (free[mid]!.start <= start) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return false;
  return free[idx]!.end >= end;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function clip(intervals: readonly Interval[], window: Interval): Interval[] {
  return intersect(intervals, [window]);
}
