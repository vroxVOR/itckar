import { DateTime } from "luxon";
import type { Resource, Service, WeeklyRule } from "./types";

export const ZONE = "Europe/Prague";
export const t = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
export const fmt = (ms: number) => DateTime.fromMillis(ms, { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm");

export const weekdays = (start: string, end: string, days: number[] = [1, 2, 3, 4, 5]): WeeklyRule[] =>
  days.map((weekday) => ({ weekday: weekday as 1, start, end }));

export const anna: Resource = { id: "anna", kind: "staff", rules: weekdays("09:00", "17:00") };
export const bob: Resource = { id: "bob", kind: "staff", rules: weekdays("12:00", "20:00") };
export const chair1: Resource = { id: "chair1", kind: "chair" };
export const chair2: Resource = { id: "chair2", kind: "chair" };
export const room1: Resource = { id: "room1", kind: "room" };

export const haircut: Service = {
  id: "haircut",
  requirements: [
    { key: "staff", kind: "staff", candidates: ["anna", "bob"] },
    { key: "chair", kind: "chair", candidates: ["chair1", "chair2"] },
  ],
  segments: [{ durationMin: 30, kind: "active", occupies: ["staff", "chair"] }],
};

/** Colour: apply 30, process 45 (stylist free, chair occupied), finish 30. */
export const colour: Service = {
  id: "colour",
  requirements: [
    { key: "staff", kind: "staff", candidates: ["anna", "bob"] },
    { key: "chair", kind: "chair", candidates: ["chair1", "chair2"] },
  ],
  segments: [
    { durationMin: 30, kind: "active", occupies: ["staff", "chair"] },
    { durationMin: 45, kind: "processing", occupies: ["chair"] },
    { durationMin: 30, kind: "active", occupies: ["staff", "chair"] },
  ],
};

export const massage: Service = {
  id: "massage",
  requirements: [
    { key: "staff", kind: "staff", candidates: ["anna"] },
    { key: "room", kind: "room", candidates: ["room1"] },
  ],
  segments: [{ durationMin: 60, kind: "active", occupies: ["staff", "room"] }],
  bufferAfterMin: 15,
};
