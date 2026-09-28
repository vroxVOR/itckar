import { Brand } from "@/components/brand";
import { CalendarDays, Check } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { availableSlots, loadServices, publicTenantBySlug, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { fmtTime, localeTag, minutes, money } from "@/lib/format";
import { t } from "@/lib/i18n";
import { BookingForm } from "./form";

export const dynamic = "force-dynamic";

type SP = { s?: string | string[]; staff?: string; d?: string; t?: string };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const tenant = await publicTenantBySlug(db(), slug);
  if (!tenant) notFound();
  const l = tenant.locale;
  const zone = tenant.timezone;

  const { services, staff, location } = await withTenant(db(), tenant.id, async (tx) => ({
    services: (await loadServices(tx)).filter((s) => s.bookableOnline),
    staff: await tx.selectFrom("resource").select(["id", "name", "color"]).where("kind", "=", "staff").where("active", "=", true).where("bookable_online", "=", true).orderBy("sort_order").orderBy("name").execute(),
    location: await tx.selectFrom("location").select(["address", "phone"]).where("is_default", "=", true).executeTakeFirst(),
  }));
  const categories = await withTenant(db(), tenant.id, (tx) => tx.selectFrom("service_category").select(["id", "name"]).orderBy("sort_order").execute());

  const rawS = Array.isArray(sp.s) ? sp.s : (sp.s ?? "").split(",");
  const selectedIds = rawS.filter((id) => services.some((s) => s.id === id));
  const selected = selectedIds.map((id) => services.find((s) => s.id === id)!);
  const step = selected.length === 0 ? 1 : sp.staff === undefined ? 2 : !sp.t ? 3 : 4;
  const base = `/b/${slug}`;
  const q = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { s: selectedIds.join(","), staff: sp.staff, d: sp.d, t: sp.t, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "") p.set(k, v);
    else if (k === "staff" && v === "") p.set(k, "");
    return `${base}?${p.toString()}`;
  };

  // Staff that can do every selected service
  const capableStaff = staff.filter((r) => selected.every((s) => s.requirements.find((x) => x.key === "staff")?.candidates.includes(r.id)));
  const staffPin = sp.staff && capableStaff.some((r) => r.id === sp.staff) ? { staff: sp.staff } : undefined;
  const totalMin = selected.reduce((a, s) => a + s.durationMin, 0);
  const totalCents = selected.reduce((a, s) => a + s.priceCents, 0);
  const anyFrom = selected.some((s) => s.priceFrom);

  // Step 3: slots for a 14-day window starting at the chosen/first day
  let days: { date: string; label: string; count: number }[] = [];
  let daySlots: { start: number; end: number }[] = [];
  let chosenDay = "";
  if (step === 3) {
    const now = DateTime.now().setZone(zone);
    const windowStart = now.startOf("day");
    const windowEnd = windowStart.plus({ days: 14 });
    const slots = await withTenant(db(), tenant.id, (tx) =>
      availableSlots(tx, tenant, { serviceIds: selectedIds, fromMs: windowStart.toMillis(), toMs: windowEnd.toMillis(), ...(staffPin ? { pin: staffPin } : {}), onlineOnly: true, nowMs: now.toMillis() }),
    );
    const byDay = new Map<string, typeof slots>();
    for (const s of slots) {
      const k = DateTime.fromMillis(s.start, { zone }).toISODate()!;
      byDay.set(k, [...(byDay.get(k) ?? []), s]);
    }
    days = Array.from({ length: 14 }, (_, i) => {
      const d = windowStart.plus({ days: i });
      const date = d.toISODate()!;
      return { date, label: d.setLocale(localeTag(l)).toFormat("ccc d. L."), count: byDay.get(date)?.length ?? 0 };
    });
    chosenDay = sp.d && byDay.has(sp.d) ? sp.d : (days.find((d) => d.count > 0)?.date ?? days[0]!.date);
    daySlots = (byDay.get(chosenDay) ?? []).map((s) => ({ start: s.start, end: s.end }));
  }

  return (
    <main className="booking-page mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="booking-header mb-6">
        <span className="booking-header-icon" aria-hidden="true"><CalendarDays size={25} /></span>
        <div>
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        {location?.address && <p className="text-sm text-neutral-600">{location.address}{location.phone ? ` · ${location.phone}` : ""}</p>}
        </div>
      </header>
      <ol className="booking-steps mb-6 text-xs text-neutral-500">
        {[t(l, "choose_services"), t(l, "choose_staff"), t(l, "choose_time"), t(l, "your_details")].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "is-complete" : ""}><span className="step-number">{step > i + 1 ? <Check size={14} aria-hidden="true" /> : i + 1}</span><span>{label}</span></li>
        ))}
      </ol>

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="min-w-0">
          {step === 1 && (
            <form method="get" action={base} className="space-y-4">
              <ServiceList services={services} categories={categories} tenant={{ currency: tenant.currency, locale: l }} />
              <button className="btn-primary">{t(l, "next")}</button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <h2 className="font-medium">{t(l, "choose_staff")}</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                <li>
                  <Link href={q({ staff: "" })} className="card flex items-center gap-3 hover:border-brand-500">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-200 text-sm">✦</span>
                    <span className="font-medium">{t(l, "anyone")}</span>
                  </Link>
                </li>
                {capableStaff.map((r) => (
                  <li key={r.id}>
                    <Link href={q({ staff: r.id })} className="card flex items-center gap-3 hover:border-brand-500">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-white" style={{ background: r.color ?? "#2f6fed" }}>{r.name.slice(0, 1)}</span>
                      <span className="font-medium">{r.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={base} className="text-sm text-neutral-500 hover:underline">← {t(l, "back")}</Link>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-medium">{t(l, "choose_time")}</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => (
                  <Link
                    key={d.date}
                    href={q({ d: d.date })}
                    className={`booking-day shrink-0 rounded-lg border px-3 py-2 text-center text-sm ${d.date === chosenDay ? "border-brand-600 bg-brand-600 text-white" : d.count ? "border-neutral-300 bg-white" : "border-neutral-200 bg-neutral-50 text-neutral-400"}`}
                  >
                    <div>{d.label}</div>
                    <div className="text-[10px] opacity-70">{d.count ? `${d.count}×` : "—"}</div>
                  </Link>
                ))}
              </div>
              {daySlots.length === 0 ? (
                <p className="text-sm text-neutral-500">{t(l, "no_slots")}</p>
              ) : (
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {daySlots.map((s) => (
                    <li key={s.start}>
                      <Link href={q({ d: chosenDay, t: String(s.start) })} className="booking-slot block rounded-lg border border-neutral-300 bg-white py-2 text-center text-sm hover:border-brand-500 hover:bg-brand-50">
                        {fmtTime(s.start, zone, l)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={q({ staff: undefined, d: undefined })} className="text-sm text-neutral-500 hover:underline">← {t(l, "back")}</Link>
            </div>
          )}

          {step === 4 && (
            <BookingForm
              slug={slug}
              serviceIds={selectedIds}
              staffId={staffPin?.staff ?? ""}
              startMs={Number(sp.t)}
              locale={l}
              labels={{
                title: t(l, "your_details"),
                name: t(l, "name"),
                lastName: t(l, "last_name"),
                phone: t(l, "phone"),
                email: t(l, "email"),
                note: t(l, "note"),
                consentSms: t(l, "consent_sms"),
                consentEmail: t(l, "consent_email"),
                terms: t(l, "terms_note"),
                submit: t(l, "confirm_booking"),
                back: t(l, "back"),
              }}
              backHref={q({ t: undefined })}
              when={`${DateTime.fromMillis(Number(sp.t), { zone }).setLocale(localeTag(l)).toFormat("cccc d. LLLL yyyy")} · ${fmtTime(Number(sp.t), zone, l)}`}
            />
          )}
        </div>

        <aside className="booking-summary card h-fit text-sm md:sticky md:top-4">
          <h3 className="font-medium">{tenant.name}</h3>
          {selected.length === 0 ? (
            <p className="mt-2 text-neutral-500">{t(l, "choose_services")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-neutral-100">
              {selected.map((s) => (
                <li key={s.id} className="flex justify-between py-1.5">
                  <span>{s.name}<span className="block text-xs text-neutral-500">{minutes(s.durationMin, l)}</span></span>
                  <span>{money(s.priceCents, tenant.currency, l, s.priceFrom)}</span>
                </li>
              ))}
              <li className="flex justify-between py-1.5 font-medium">
                <span>{t(l, "total")} · {minutes(totalMin, l)}</span>
                <span>{money(totalCents, tenant.currency, l, anyFrom)}</span>
              </li>
            </ul>
          )}
          {staffPin && <p className="mt-2 text-neutral-600">{capableStaff.find((r) => r.id === staffPin.staff)?.name}</p>}
          {sp.staff === "" && step > 2 && <p className="mt-2 text-neutral-600">{t(l, "anyone")}</p>}
          <p className="booking-powered mt-4 text-[11px] text-neutral-500">{t(l, "powered_by")} <Brand compact /></p>
        </aside>
      </div>
    </main>
  );
}

function ServiceList({ services, categories, tenant }: { services: Awaited<ReturnType<typeof loadServices>>; categories: { id: string; name: string }[]; tenant: { currency: string; locale: string } }) {
  const groups = [...categories.map((c) => ({ key: c.id, name: c.name, list: services.filter((s) => s.categoryId === c.id) })), { key: "_", name: "", list: services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId)) }].filter((g) => g.list.length);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.key}>
          {g.name && <h2 className="mb-2 text-xs font-semibold uppercase text-neutral-500">{g.name}</h2>}
          <ul className="space-y-2">
            {g.list.map((s) => (
              <li key={s.id}>
                <label className="service-option card flex cursor-pointer items-start gap-3 hover:border-brand-500 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                  <input type="checkbox" name="s" value={s.id} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="flex justify-between gap-3 font-medium"><span>{s.name}</span><span>{money(s.priceCents, tenant.currency, tenant.locale, s.priceFrom)}</span></span>
                    <span className="block text-xs text-neutral-500">{minutes(s.durationMin, tenant.locale)}</span>
                    {s.description && <span className="mt-1 block text-sm text-neutral-600">{s.description}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {services.length === 0 && <p className="text-sm text-neutral-500">—</p>}
    </div>
  );
}
