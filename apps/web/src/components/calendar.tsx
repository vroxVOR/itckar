import Link from "next/link";
import { CalendarMove } from "./calendar-move";
import { DateTime } from "luxon";
import type { CalendarAppointment, TimeOffBlock } from "@/lib/queries";
import type { Resource } from "@itckar/db";

const PX_PER_MIN = 1.2;
const START_HOUR = 7;
const END_HOUR = 21;

interface Column {
  key: string;
  title: string;
  color?: string | null;
  /** local day (midnight) for this column */
  day: DateTime;
  /** resource id filter: only segments of this resource are shown; undefined = all */
  resourceId?: string;
}

function pos(startIso: string, endIso: string, day: DateTime) {
  const dayStart = day.set({ hour: START_HOUR }).toMillis();
  const s = Math.max(Date.parse(startIso), dayStart);
  const e = Math.min(Date.parse(endIso), day.set({ hour: END_HOUR }).toMillis());
  if (e <= s) return null;
  return { top: ((s - dayStart) / 60_000) * PX_PER_MIN, height: Math.max(((e - s) / 60_000) * PX_PER_MIN, 14) };
}

export function CalendarGrid({
  columns,
  appointments,
  timeOff,
  zone,
  resources,
  newHref,
  step,
}: {
  step: number;
  columns: Column[];
  appointments: CalendarAppointment[];
  timeOff: TimeOffBlock[];
  zone: string;
  resources: Resource[];
  newHref: (day: DateTime, hour: number, resourceId?: string) => string;
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const totalHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MIN;
  const now = DateTime.now().setZone(zone);
  const colorOf = (rid: string) => resources.find((r) => r.id === rid)?.color ?? "#2f6fed";

  return (
    <CalendarMove zone={zone} step={step}>
    <div className="calendar-surface overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(140px, 1fr))` }}>
        <div className="border-b border-neutral-200" />
        {columns.map((c) => (
          <div key={c.key} className="calendar-column-heading flex items-center gap-2 border-b border-l border-neutral-200 px-2 py-2 text-sm font-medium">
            {c.color && <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />}
            <span className="truncate">{c.title}</span>
          </div>
        ))}
        <div className="relative" style={{ height: totalHeight }}>
          {hours.map((h) => (
            <div key={h} className="absolute right-2 text-xs text-neutral-500" style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN }}>
              {String(h).padStart(2, "0")}:00
            </div>
          ))}
        </div>
        {columns.map((c) => {
          const dayStartMs = c.day.toMillis();
          const dayEndMs = c.day.plus({ days: 1 }).toMillis();
          const dayAppts = appointments.filter((a) => {
            const inDay = Date.parse(a.start_at) < dayEndMs && Date.parse(a.end_at) > dayStartMs;
            if (!inDay) return false;
            return c.resourceId ? a.segments.some((s) => s.resource_ids.includes(c.resourceId!)) : true;
          });
          const offs = timeOff.filter((b) => (!c.resourceId || b.resource_id === c.resourceId) && Date.parse(b.start) < dayEndMs && Date.parse(b.end) > dayStartMs);
          const isToday = c.day.hasSame(now, "day");
          return (
            <div key={c.key} data-calendar-day={c.day.toISODate()} data-resource={c.resourceId ?? ""} className="relative border-l border-neutral-200" style={{ height: totalHeight }}>
              {hours.map((h) => (
                <Link
                  key={h}
                  href={newHref(c.day, h, c.resourceId)}
                  className="absolute inset-x-0 border-t border-neutral-100 hover:bg-brand-50/60"
                  style={{ top: (h - START_HOUR) * 60 * PX_PER_MIN, height: 60 * PX_PER_MIN }}
                  aria-label={`${c.title} ${h}:00`}
                />
              ))}
              {offs.map((b) => {
                const p = pos(b.start, b.end, c.day);
                return p ? (
                  <div key={b.id} className="absolute inset-x-1 rounded-md bg-[repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6_6px,#e5e7eb_6px,#e5e7eb_12px)] px-1 text-[11px] text-neutral-500" style={{ top: p.top, height: p.height }} title={b.note ?? ""}>
                    {b.note ?? "—"}
                  </div>
                ) : null;
              })}
              {dayAppts.map((a) => {
                const segs = c.resourceId ? a.segments.filter((s) => s.resource_ids.includes(c.resourceId!)) : a.segments;
                const rid = segs[0]?.resource_ids[0];
                const color = c.resourceId ? colorOf(c.resourceId) : rid ? colorOf(rid) : "#2f6fed";
                return segs.map((s, i) => {
                  const p = pos(s.start_at, s.end_at, c.day);
                  if (!p) return null;
                  const processing = s.kind === "processing";
                  return (
                    <Link
                      key={`${a.id}-${i}`}
                      href={`/app/appointments/${a.id}`}
                      draggable={["pending", "confirmed"].includes(a.status) && Date.parse(a.start_at) > now.toMillis()}
                      data-move-id={["pending", "confirmed"].includes(a.status) && Date.parse(a.start_at) > now.toMillis() ? a.id : undefined}
                      data-start={Date.parse(a.start_at)}
                      data-offset={Math.max(Date.parse(s.start_at), c.day.set({ hour: START_HOUR }).toMillis()) - Date.parse(a.start_at)}
                      className="calendar-event absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] leading-tight shadow-xs hover:brightness-95"
                      style={{
                        top: p.top,
                        height: p.height,
                        borderColor: color,
                        background: processing ? `repeating-linear-gradient(45deg, ${color}22, ${color}22 6px, ${color}11 6px, ${color}11 12px)` : `${color}33`,
                        opacity: a.status === "no_show" ? 0.5 : 1,
                      }}
                      title={`${a.client_name ?? ""} · ${a.services}`}
                    >
                      <div className="truncate font-medium text-neutral-900">{processing ? "⏳ " : ""}{a.client_name ?? "—"}</div>
                      {p.height >= 26 && <div className="truncate text-neutral-700">{a.services}</div>}
                    </Link>
                  );
                });
              })}
              {isToday && now.hour >= START_HOUR && now.hour < END_HOUR && (
                <div className="pointer-events-none absolute inset-x-0 border-t-2 border-red-500" style={{ top: (now.diff(c.day.set({ hour: START_HOUR }), "minutes").minutes) * PX_PER_MIN }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
    </CalendarMove>
  );
}
