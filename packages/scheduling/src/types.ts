/**
 * Core scheduling domain types.
 *
 * Design (see reports/Rezervačné systémy pre salóny.md, "Architektúra"):
 *  - A service is an ordered list of SEGMENTS. Each segment lasts N minutes and
 *    OCCUPIES a subset of the service's resource requirement keys.
 *    Example hair colour: requirements { staff, chair }
 *      apply   30 min  occupies [staff, chair]
 *      process 45 min  occupies [chair]           <- stylist is free (bookable gap)
 *      finish  30 min  occupies [staff, chair]
 *  - A requirement key maps to a set of CANDIDATE resources (staff members, chairs, rooms,
 *    devices). The same resource must serve a key for all segments of one service.
 *  - Time is handled as epoch milliseconds internally; availability rules are expressed
 *    in the business's IANA time zone and expanded per local day (DST-safe).
 */

/** Epoch milliseconds. */
export type Ms = number;

export type ResourceKind = "staff" | "chair" | "room" | "device" | "other";

export interface Resource {
  id: string;
  kind: ResourceKind;
  name?: string;
  /**
   * Weekly availability rules in the business time zone. If omitted the resource is
   * considered always available (typical for chairs/rooms bounded by staff hours).
   */
  rules?: WeeklyRule[];
  /** Per-date overrides (holidays, sick days, extra hours). Take precedence over rules. */
  overrides?: DateOverride[];
}

/** ISO weekday: 1 = Monday ... 7 = Sunday (matches luxon). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** "HH:mm" local time. end may be <= start to denote an overnight interval. */
export interface LocalInterval {
  start: string;
  end: string;
}

export interface WeeklyRule extends LocalInterval {
  weekday: Weekday;
}

export interface DateOverride {
  /** "YYYY-MM-DD" in the business time zone. */
  date: string;
  /** Empty array = whole day unavailable. */
  intervals: LocalInterval[];
}

export interface ResourceRequirement {
  /** Stable key referenced by segments, e.g. "staff", "chair", "room". */
  key: string;
  kind: ResourceKind;
  /** Candidate resource ids. Order = preference order. */
  candidates: string[];
}

export type SegmentKind = "active" | "processing";

export interface ServiceSegment {
  id?: string;
  name?: string;
  durationMin: number;
  kind: SegmentKind;
  /** Requirement keys this segment occupies. */
  occupies: string[];
}

export interface Service {
  id: string;
  name?: string;
  requirements: ResourceRequirement[];
  segments: ServiceSegment[];
  /** Widens the occupancy of the resources used by the first segment. */
  bufferBeforeMin?: number;
  /** Widens the occupancy of the resources used by the last segment. */
  bufferAfterMin?: number;
}

/** An occupied half-open interval [start, end) on a resource (existing bookings, holds). */
export interface BusyInterval {
  resourceId: string;
  start: Ms;
  end: Ms;
  /** Optional reference, e.g. appointment id, so the engine can ignore the booking being edited. */
  ref?: string;
}

export interface CartItem {
  service: Service;
  /** Force particular resources for requirement keys, e.g. { staff: "anna" }. */
  pin?: Record<string, string>;
}

export interface FindSlotsInput {
  /** IANA zone of the business, e.g. "Europe/Prague". */
  zone: string;
  /** Search window [from, to) as instants. */
  from: Ms;
  to: Ms;
  /** Services booked back-to-back in this order. */
  cart: CartItem[];
  resources: Resource[];
  busy: BusyInterval[];
  /** Grid step in minutes, default 15. Grid is aligned to local midnight of each day. */
  stepMin?: number;
  /** Current time; slots starting before now + minNoticeMin are dropped. Default: from. */
  now?: Ms;
  minNoticeMin?: number;
  /** Ignore busy intervals with this ref (rescheduling). */
  ignoreRef?: string;
  /** Maximum number of slots to return (safety valve). Default 2000. */
  limit?: number;
}

export interface Assignment {
  cartIndex: number;
  key: string;
  resourceId: string;
}

export interface SegmentPlacement {
  cartIndex: number;
  segmentIndex: number;
  kind: SegmentKind;
  start: Ms;
  end: Ms;
  /** Resource ids occupied during this segment (already resolved). */
  resourceIds: string[];
}

export interface Slot {
  start: Ms;
  end: Ms;
  assignments: Assignment[];
  segments: SegmentPlacement[];
}

export interface CheckSlotInput
  extends Omit<FindSlotsInput, "from" | "to" | "stepMin" | "limit" | "cart"> {
  start: Ms;
  cart: CartItem[];
  /** Full assignment the client chose (or that the server pre-resolved). */
  assignments: Assignment[];
}

export type CheckSlotResult =
  | { ok: true; slot: Slot }
  | { ok: false; reason: "unavailable" | "busy" | "too_soon" | "invalid_assignment"; detail?: string };

/** Half-open interval [start, end). */
export interface Interval {
  start: Ms;
  end: Ms;
}
