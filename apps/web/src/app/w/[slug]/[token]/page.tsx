import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { publicTenantBySlug, withTenant } from "@itckar/db";
import { Brand } from "@/components/brand";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { waitlistCopy } from "@/lib/waitlist-copy";
import { stopWaiting } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function WaitlistOffer({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  if (!/^[a-f0-9]{48}$/.test(token)) notFound();
  const tenant = await publicTenantBySlug(db(), slug);
  if (!tenant) notFound();
  const data = await withTenant(db(), tenant.id, async (tx) => {
    const entry = await tx
      .selectFrom("waitlist_entry")
      .selectAll()
      .where("public_token", "=", token)
      .executeTakeFirst();
    if (!entry) return null;
    const services = await tx
      .selectFrom("service")
      .select(["id", "name"])
      .where("id", "in", entry.service_ids)
      .execute();
    return { entry, services };
  });
  if (!data) notFound();
  const { entry, services } = data;
  const c = waitlistCopy(tenant.locale);
  const expired = Date.parse(entry.until_at) <= Date.now();
  const active = !["closed", "booked"].includes(entry.status) && !expired;
  const offer =
    active &&
    ["offered", "notified"].includes(entry.status) &&
    entry.offered_start_at &&
    Date.parse(entry.offered_start_at) > Date.now();
  const query = new URLSearchParams({
    s: entry.service_ids.join(","),
    staff: entry.staff_id ?? "",
    t: String(Date.parse(entry.offered_start_at ?? "")),
    w: token,
  });
  return (
    <main className="booking-page mx-auto max-w-xl px-4 py-10">
      <header className="booking-header mb-6">
        <span className="booking-header-icon">
          <CalendarDays size={24} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{tenant.name}</h1>
          <p className="text-sm text-neutral-600">{c.title}</p>
        </div>
      </header>
      <section className="card space-y-5">
        <h2 className="font-semibold">
          {entry.service_ids.map((id) => services.find((s) => s.id === id)?.name ?? "—").join(", ")}
        </h2>
        <p className="text-sm text-neutral-600">
          {c.from}: {fmtDate(entry.from_at, tenant.timezone, tenant.locale, "short")} –{" "}
          {fmtDate(Date.parse(entry.until_at) - 1, tenant.timezone, tenant.locale, "short")}
        </p>
        {offer ? (
          <>
            <p className="rounded-xl bg-brand-50 p-4 text-lg font-semibold text-brand-700">
              {fmtDateTime(entry.offered_start_at!, tenant.timezone, tenant.locale)}
            </p>
            <p className="text-sm text-neutral-600">{c.note}</p>
            <Link className="btn-primary" href={`/b/${slug}?${query}`}>
              {c.book}
            </Link>
          </>
        ) : (
          <p role="status">
            {entry.status === "booked"
              ? c.booked
              : entry.status === "closed"
                ? c.ended
                : expired
                  ? c.expired
                  : entry.offered_start_at && Date.parse(entry.offered_start_at) <= Date.now()
                    ? c.offerExpired
                    : c.waiting}
          </p>
        )}
        <div className="flex flex-wrap gap-3 border-t border-neutral-100 pt-4">
          <Link className="btn-secondary" href={`/b/${slug}`}>
            {c.other}
          </Link>
          {active && (
            <form action={stopWaiting}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="token" value={token} />
              <button className="btn-secondary">{c.stop}</button>
            </form>
          )}
        </div>
      </section>
      <div className="mt-6 flex justify-center">
        <Brand compact />
      </div>
    </main>
  );
}
