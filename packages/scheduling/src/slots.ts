import { DateTime } from "luxon";
import type {
  Assignment,
  BusyInterval,
  CartItem,
  CheckSlotInput,
  CheckSlotResult,
  FindSlotsInput,
  Interval,
  Ms,
  Resource,
  SegmentPlacement,
  Slot,
} from "./types";
import { MINUTE, covers, normalize, subtract } from "./intervals";
import { availableIntervals } from "./availability";

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export class SchedulingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "empty_cart"
      | "invalid_service"
      | "unknown_resource"
      | "invalid_pin"
      | "invalid_step",
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

/**
 * Validate the cart and drop candidate resources that are not part of `resources`
 * (e.g. deactivated staff). A requirement with no remaining candidates is an error.
 */
function normalizeCart(cart: CartItem[], resources: Map<string, Resource>): CartItem[] {
  if (cart.length === 0) throw new SchedulingError("Cart is empty", "empty_cart");
  return cart.map((item, i) => {
    const s = item.service;
    if (s.segments.length === 0)
      throw new SchedulingError(`Service ${s.id} has no segments`, "invalid_service");
    const keys = new Set(s.requirements.map((r) => r.key));
    if (keys.size !== s.requirements.length)
      throw new SchedulingError(`Service ${s.id} has duplicate requirement keys`, "invalid_service");
    const requirements = s.requirements.map((r) => {
      const candidates = r.candidates.filter((c) => resources.has(c));
      if (candidates.length === 0)
        throw new SchedulingError(
          `Service ${s.id} requirement "${r.key}" has no known candidates (cart item ${i})`,
          "unknown_resource",
        );
      return { ...r, candidates };
    });
    for (const seg of s.segments) {
      if (!(seg.durationMin > 0) || !Number.isFinite(seg.durationMin))
        throw new SchedulingError(`Service ${s.id} has a non-positive segment`, "invalid_service");
      for (const k of seg.occupies)
        if (!keys.has(k))
          throw new SchedulingError(
            `Service ${s.id} segment occupies unknown key "${k}"`,
            "invalid_service",
          );
    }
    for (const [key, rid] of Object.entries(item.pin ?? {})) {
      const req = requirements.find((r) => r.key === key);
      if (!req || !req.candidates.includes(rid))
        throw new SchedulingError(
          `Pinned resource "${rid}" is not a candidate for "${key}" in service ${s.id}`,
          "invalid_pin",
        );
    }
    return { ...item, service: { ...s, requirements } };
  });
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface KeyDemand {
  cartIndex: number;
  key: string;
  candidates: string[];
  /** Intervals the assigned resource must be free for (segments + buffers). */
  intervals: Interval[];
}

interface Timeline {
  end: Ms;
  demands: KeyDemand[];
  segments: Omit<SegmentPlacement, "resourceIds">[];
  /** (cartIndex, segmentIndex) -> keys occupied, for resolving resourceIds later. */
  occupies: string[][][];
}

function buildTimeline(cart: CartItem[], start: Ms): Timeline {
  const demands: KeyDemand[] = [];
  const segments: Timeline["segments"] = [];
  const occupies: string[][][] = [];
  let cursor = start;
  for (const [ci, item] of cart.entries()) {
    const s = item.service;
    const perKey = new Map<string, Interval[]>();
    for (const r of s.requirements) perKey.set(r.key, []);
    const itemOcc: string[][] = [];
    const first = 0;
    const last = s.segments.length - 1;
    for (const [si, seg] of s.segments.entries()) {
      const segStart = cursor;
      const segEnd = cursor + seg.durationMin * MINUTE;
      segments.push({ cartIndex: ci, segmentIndex: si, kind: seg.kind, start: segStart, end: segEnd });
      itemOcc.push(seg.occupies);
      for (const k of seg.occupies) {
        let a = segStart;
        let b = segEnd;
        if (si === first && s.bufferBeforeMin) a -= s.bufferBeforeMin * MINUTE;
        if (si === last && s.bufferAfterMin) b += s.bufferAfterMin * MINUTE;
        perKey.get(k)!.push({ start: a, end: b });
      }
      cursor = segEnd;
    }
    occupies.push(itemOcc);
    for (const r of s.requirements) {
      const pinned = item.pin?.[r.key];
      demands.push({
        cartIndex: ci,
        key: r.key,
        candidates: pinned ? [pinned] : r.candidates,
        intervals: normalize(perKey.get(r.key)!),
      });
    }
  }
  return { end: cursor, demands, segments, occupies };
}

/** Total span (ms) of a cart including outer buffers, used to pad the availability window. */
function cartSpan(cart: CartItem[]): { before: Ms; after: Ms; duration: Ms } {
  let duration = 0;
  let before = 0;
  let after = 0;
  for (const { service } of cart) {
    duration += service.segments.reduce((a, s) => a + s.durationMin, 0) * MINUTE;
    before = Math.max(before, (service.bufferBeforeMin ?? 0) * MINUTE);
    after = Math.max(after, (service.bufferAfterMin ?? 0) * MINUTE);
  }
  return { before, after, duration };
}

/* ------------------------------------------------------------------ */
/* Free-time index                                                     */
/* ------------------------------------------------------------------ */

interface FreeIndex {
  avail: Map<string, Interval[]>;
  free: Map<string, Interval[]>;
}

function buildFreeIndex(
  resources: Map<string, Resource>,
  busy: BusyInterval[],
  from: Ms,
  to: Ms,
  zone: string,
  ignoreRef?: string,
): FreeIndex {
  const busyBy = new Map<string, Interval[]>();
  for (const b of busy) {
    if (ignoreRef !== undefined && b.ref === ignoreRef) continue;
    const list = busyBy.get(b.resourceId) ?? [];
    list.push({ start: b.start, end: b.end });
    busyBy.set(b.resourceId, list);
  }
  const avail = new Map<string, Interval[]>();
  const free = new Map<string, Interval[]>();
  for (const r of resources.values()) {
    const a = availableIntervals(r, from, to, zone);
    avail.set(r.id, a);
    free.set(r.id, subtract(a, normalize(busyBy.get(r.id) ?? [])));
  }
  return { avail, free };
}

function fits(free: Interval[] | undefined, intervals: Interval[]): boolean {
  if (!free) return false;
  for (const iv of intervals) if (!covers(free, iv.start, iv.end)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Assignment search                                                   */
/* ------------------------------------------------------------------ */

/**
 * Backtracking over demands. Resources used by another key of the SAME cart item are
 * excluded (a stylist cannot be both "stylist" and "assistant"). Across cart items the
 * same resource may be reused because segments are sequential in time.
 */
function assign(demands: KeyDemand[], free: Map<string, Interval[]>): Assignment[] | null {
  const result: Assignment[] = [];
  const usedInItem = new Map<number, Set<string>>();
  /** Continuity: the resource chosen for a key in an earlier cart item is tried first. */
  const lastForKey = new Map<string, string | undefined>();

  const rec = (i: number): boolean => {
    if (i === demands.length) return true;
    const d = demands[i]!;
    const used = usedInItem.get(d.cartIndex) ?? new Set<string>();
    const preferred = lastForKey.get(d.key);
    const order =
      preferred && d.candidates.includes(preferred)
        ? [preferred, ...d.candidates.filter((c) => c !== preferred)]
        : d.candidates;
    for (const rid of order) {
      if (used.has(rid)) continue;
      if (!fits(free.get(rid), d.intervals)) continue;
      used.add(rid);
      usedInItem.set(d.cartIndex, used);
      result.push({ cartIndex: d.cartIndex, key: d.key, resourceId: rid });
      const prev = lastForKey.get(d.key);
      lastForKey.set(d.key, rid);
      if (rec(i + 1)) return true;
      lastForKey.set(d.key, prev);
      result.pop();
      used.delete(rid);
    }
    return false;
  };

  return rec(0) ? result : null;
}

function resolveSegments(tl: Timeline, assignments: Assignment[]): SegmentPlacement[] {
  const byItemKey = new Map<string, string>();
  for (const a of assignments) byItemKey.set(`${a.cartIndex}:${a.key}`, a.resourceId);
  return tl.segments.map((s) => ({
    ...s,
    resourceIds: (tl.occupies[s.cartIndex]![s.segmentIndex] ?? []).map(
      (k) => byItemKey.get(`${s.cartIndex}:${k}`)!,
    ),
  }));
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function findSlots(input: FindSlotsInput): Slot[] {
  const step = (input.stepMin ?? 15) * MINUTE;
  if (!(step > 0)) throw new SchedulingError("stepMin must be positive", "invalid_step");
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const cart = normalizeCart(input.cart, resources);

  const span = cartSpan(cart);
  const idx = buildFreeIndex(
    resources,
    input.busy,
    input.from - span.before,
    input.to + span.duration + span.after,
    input.zone,
    input.ignoreRef,
  );
  const limit = input.limit ?? 2000;
  const earliest = (input.now ?? input.from) + (input.minNoticeMin ?? 0) * MINUTE;
  const out: Slot[] = [];

  let day = DateTime.fromMillis(input.from, { zone: input.zone }).startOf("day");
  while (day.toMillis() < input.to && out.length < limit) {
    const next = day.plus({ days: 1 });
    const dayStart = day.toMillis();
    const dayEnd = next.toMillis();
    for (let t = dayStart; t < dayEnd && t < input.to; t += step) {
      if (t < input.from || t < earliest) continue;
      const tl = buildTimeline(cart, t);
      const assignments = assign(tl.demands, idx.free);
      if (!assignments) continue;
      out.push({ start: t, end: tl.end, assignments, segments: resolveSegments(tl, assignments) });
      if (out.length >= limit) break;
    }
    day = next;
  }
  return out;
}

/**
 * Re-validate one concrete slot with concrete assignments right before persisting.
 * The database exclusion constraint is the final guard; this gives a friendly reason.
 */
export function checkSlot(input: CheckSlotInput): CheckSlotResult {
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const cart = normalizeCart(input.cart, resources);
  const earliest = (input.now ?? input.start) + (input.minNoticeMin ?? 0) * MINUTE;
  if (input.start < earliest) return { ok: false, reason: "too_soon" };

  const tl = buildTimeline(cart, input.start);
  const span = cartSpan(cart);
  const idx = buildFreeIndex(
    resources,
    input.busy,
    input.start - span.before,
    tl.end + span.after,
    input.zone,
    input.ignoreRef,
  );

  const chosen = new Map<string, string>();
  for (const a of input.assignments) chosen.set(`${a.cartIndex}:${a.key}`, a.resourceId);
  const perItemUsed = new Map<number, Set<string>>();
  for (const d of tl.demands) {
    const rid = chosen.get(`${d.cartIndex}:${d.key}`);
    if (!rid || !d.candidates.includes(rid))
      return {
        ok: false,
        reason: "invalid_assignment",
        detail: `missing or invalid resource for ${d.key} (item ${d.cartIndex})`,
      };
    const used = perItemUsed.get(d.cartIndex) ?? new Set<string>();
    if (used.has(rid))
      return { ok: false, reason: "invalid_assignment", detail: `resource ${rid} used twice` };
    used.add(rid);
    perItemUsed.set(d.cartIndex, used);
    if (!fits(idx.avail.get(rid), d.intervals))
      return { ok: false, reason: "unavailable", detail: `${rid} not working at that time` };
    if (!fits(idx.free.get(rid), d.intervals))
      return { ok: false, reason: "busy", detail: `${rid} already booked` };
  }
  const assignments = tl.demands.map((d) => ({
    cartIndex: d.cartIndex,
    key: d.key,
    resourceId: chosen.get(`${d.cartIndex}:${d.key}`)!,
  }));
  return {
    ok: true,
    slot: { start: input.start, end: tl.end, assignments, segments: resolveSegments(tl, assignments) },
  };
}

/** Convenience: group slots by local date "YYYY-MM-DD". */
export function groupSlotsByDay(slots: Slot[], zone: string): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>();
  for (const s of slots) {
    const key = DateTime.fromMillis(s.start, { zone }).toISODate()!;
    const list = out.get(key) ?? [];
    list.push(s);
    out.set(key, list);
  }
  return out;
}
