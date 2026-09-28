import { DateTime } from "luxon";
import type { DateOverride, Interval, LocalInterval, Ms, Resource, WeeklyRule, Weekday } from "./types";
import { normalize, clip } from "./intervals";

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHMM(s: string): { hour: number; minute: number } {
  const m = HHMM.exec(s);
  if (!m) throw new Error(`Invalid time "${s}", expected HH:mm`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/** Local midnight of a "YYYY-MM-DD" date in `zone`. */
export function localDayStart(date: string, zone: string): DateTime {
  const dt = DateTime.fromISO(date, { zone });
  if (!dt.isValid) throw new Error(`Invalid date "${date}": ${dt.invalidExplanation}`);
  return dt.startOf("day");
}

/**
 * Resolve a LocalInterval on a given local day to an absolute [start, end).
 * Overnight intervals (end <= start) end on the following day.
 * Non-existent local times (DST gap) are shifted forward by luxon; ambiguous times
 * (DST overlap) resolve to the earlier offset, which matches how staff read a rota.
 */
export function resolveLocalInterval(day: DateTime, iv: LocalInterval): Interval {
  const s = parseHHMM(iv.start);
  const e = parseHHMM(iv.end);
  const start = day.set({ hour: s.hour, minute: s.minute, second: 0, millisecond: 0 });
  let end = day.set({ hour: e.hour, minute: e.minute, second: 0, millisecond: 0 });
  if (end <= start) end = end.plus({ days: 1 });
  return { start: start.toMillis(), end: end.toMillis() };
}

/** Enumerate local days (as DateTime at local midnight) touching [from, to). */
export function* localDays(from: Ms, to: Ms, zone: string): Generator<DateTime> {
  // Start one day earlier to capture overnight intervals that spill into `from`.
  let day = DateTime.fromMillis(from, { zone }).startOf("day").minus({ days: 1 });
  const endDay = DateTime.fromMillis(to, { zone }).startOf("day");
  while (day <= endDay) {
    yield day;
    day = day.plus({ days: 1 });
  }
}

/**
 * Expand weekly rules + date overrides into absolute available intervals within [from, to).
 * Resources without rules are available for the whole window.
 */
export function availableIntervals(resource: Resource, from: Ms, to: Ms, zone: string): Interval[] {
  const window: Interval = { start: from, end: to };
  if (!resource.rules && !resource.overrides) return [window];

  const rulesByDay = new Map<Weekday, WeeklyRule[]>();
  for (const r of resource.rules ?? []) {
    const list = rulesByDay.get(r.weekday) ?? [];
    list.push(r);
    rulesByDay.set(r.weekday, list);
  }
  const overridesByDate = new Map<string, DateOverride>();
  for (const o of resource.overrides ?? []) overridesByDate.set(o.date, o);

  const out: Interval[] = [];
  for (const day of localDays(from, to, zone)) {
    const iso = day.toISODate()!;
    const override = overridesByDate.get(iso);
    const intervals: LocalInterval[] = override
      ? override.intervals
      : (rulesByDay.get(day.weekday as Weekday) ?? []);
    for (const iv of intervals) out.push(resolveLocalInterval(day, iv));
  }
  return clip(normalize(out), window);
}
