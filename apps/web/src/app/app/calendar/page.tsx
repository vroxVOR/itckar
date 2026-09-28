import Link from "next/link";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { appointmentsInRange, staffResources, timeOffInRange } from "@/lib/queries";
import { dayFromParam, localeTag } from "@/lib/format";
import { t } from "@/lib/i18n";
import { CalendarGrid } from "@/components/calendar";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const s = await requireTenant();
  const sp = await searchParams;
  const zone = s.tenant.timezone;
  const view = sp.view === "week" ? "week" : "day";
  const day = dayFromParam(sp.date, zone);
  const from = view === "week" ? day.startOf("week") : day;
  const to = from.plus({ days: view === "week" ? 7 : 1 });

  const [appointments, resources, timeOff] = await Promise.all([
    appointmentsInRange(db(), s.tenant.id, from.toISO()!, to.toISO()!),
    staffResources(db(), s.tenant.id),
    timeOffInRange(db(), s.tenant.id, from.toISO()!, to.toISO()!),
  ]);
  const staff = resources.filter((r) => r.kind === "staff");
  const columns =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => {
          const d = from.plus({ days: i });
          return { key: d.toISODate()!, title: d.setLocale(localeTag(s.tenant.locale)).toFormat("ccc d. L."), day: d };
        })
      : staff.map((r) => ({ key: r.id, title: r.name, color: r.color, day, resourceId: r.id }));

  const link = (d: DateTime, v = view) => `/app/calendar?date=${d.toISODate()}&view=${v}`;
  const step = view === "week" ? { weeks: 1 } : { days: 1 };
  const title =
    view === "week"
      ? `${from.setLocale(localeTag(s.tenant.locale)).toFormat("d. L.")} – ${to.minus({ days: 1 }).setLocale(localeTag(s.tenant.locale)).toFormat("d. L. yyyy")}`
      : day.setLocale(localeTag(s.tenant.locale)).toFormat("cccc d. LLLL yyyy");

  return (
    <div className="space-y-4">
      <div className="calendar-toolbar flex flex-wrap items-center gap-2">
        <Link href={link(from.minus(step))} className="btn-secondary px-2" aria-label="prev"><ChevronLeft size={16} /></Link>
        <Link href={link(DateTime.now().setZone(zone).startOf("day"))} className="btn-secondary">{t(s.tenant.locale, "today")}</Link>
        <Link href={link(from.plus(step))} className="btn-secondary px-2" aria-label="next"><ChevronRight size={16} /></Link>
        <h1 className="ml-2 text-lg font-semibold capitalize">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 text-sm">
            <Link href={link(day, "day")} className={`rounded-md px-3 py-1 ${view === "day" ? "bg-brand-600 text-white" : ""}`}>{t(s.tenant.locale, "day")}</Link>
            <Link href={link(day, "week")} className={`rounded-md px-3 py-1 ${view === "week" ? "bg-brand-600 text-white" : ""}`}>{t(s.tenant.locale, "week")}</Link>
          </div>
          <Link href={`/app/appointments/new?date=${day.toISODate()}`} className="btn-primary"><Plus size={16} /> {t(s.tenant.locale, "new_appointment")}</Link>
        </div>
      </div>
      {staff.length === 0 ? (
        <div className="card text-sm text-neutral-600">
          Zatiaľ nemáte žiadneho člena tímu. <Link href="/app/staff" className="underline">Pridajte prvého</Link>.
        </div>
      ) : (
        <CalendarGrid
          columns={columns}
          appointments={appointments}
          timeOff={timeOff}
          zone={zone}
          resources={resources}
          newHref={(d, h, rid) => `/app/appointments/new?date=${d.toISODate()}&time=${String(h).padStart(2, "0")}:00${rid ? `&staff=${rid}` : ""}`}
        />
      )}
      <p className="text-xs text-neutral-500">
        {appointments.length} rezervácií · šrafované = pôsobenie (kaderník je voľný) · sivé = voľno / blokácia
      </p>
    </div>
  );
}
