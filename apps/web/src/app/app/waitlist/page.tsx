import Link from "next/link";
import { DateTime } from "luxon";
import { Clock3, Plus } from "lucide-react";
import { loadServices, withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { WaitlistForm } from "./form";
import { closeAction } from "./actions";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const s = await requireTenant();
  const showAll = (await searchParams).view === "all";
  const now = DateTime.now().setZone(s.tenant.timezone);
  const data = await withTenant(db(), s.tenant.id, async (tx) => ({
    entries: await tx
      .selectFrom("waitlist_entry")
      .selectAll()
      .orderBy("requested_at", "desc")
      .execute(),
    clients: await tx
      .selectFrom("client")
      .select(["id", "first_name", "last_name", "email", "phone"])
      .orderBy("first_name")
      .execute(),
    services: await loadServices(tx),
    names: await tx.selectFrom("service").select(["id", "name"]).execute(),
    staff: await tx
      .selectFrom("resource")
      .select(["id", "name"])
      .where("kind", "=", "staff")
      .where("active", "=", true)
      .where("bookable_online", "=", true)
      .orderBy("name")
      .execute(),
    notifications: await tx
      .selectFrom("notification")
      .select(["id", "status"])
      .where("template", "=", "waitlist")
      .execute(),
  }));
  const active = data.entries.filter(
    (e) => !["closed", "booked"].includes(e.status) && Date.parse(e.until_at) > now.toMillis(),
  );
  const entries = showAll ? data.entries : active;
  const labels = {
    waiting: "Čaká na termín",
    offered: "Upozornenie vo fronte",
    notified: "Upozornený",
    closed: "Ukončené",
    booked: "Rezervované",
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Čakatelia</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Keď sa termín uvoľní, overíme dostupnosť a upozorníme vhodných klientov.
          </p>
        </div>
        <span className="badge bg-brand-50 text-brand-700">
          <Clock3 size={14} /> {active.length} aktívnych
        </span>
      </header>
      <details className="card">
        <summary className="cursor-pointer font-medium">
          <Plus className="mr-2 inline" size={17} />
          Pridať klienta do zoznamu
        </summary>
        <div className="mt-5 max-w-2xl">
          <WaitlistForm
            clients={data.clients.map((c) => ({
              id: c.id,
              label: [c.first_name, c.last_name, c.phone ?? c.email].filter(Boolean).join(" · "),
            }))}
            services={data.services.filter((s) => s.bookableOnline)}
            staff={data.staff}
            today={now.toISODate()!}
            maxDate={now.plus({ days: s.tenant.max_advance_days }).toISODate()!}
          />
          {!data.clients.length && (
            <Link href="/app/clients" className="mt-3 block text-sm underline">
              Najprv pridajte klienta a jeho kontakt.
            </Link>
          )}
        </div>
      </details>
      <div className="flex gap-2 text-sm">
        <Link className={showAll ? "btn-secondary" : "btn-primary"} href="/app/waitlist">
          Aktívni
        </Link>
        <Link className={showAll ? "btn-primary" : "btn-secondary"} href="/app/waitlist?view=all">
          Všetci vrátane histórie
        </Link>
      </div>
      {!entries.length ? (
        <div className="card py-12 text-center">
          <Clock3 className="mx-auto mb-3 text-brand-600" size={28} />
          <h2 className="font-medium">Zatiaľ tu nikto nečaká</h2>
          <p className="mt-2 text-sm text-neutral-500">
            Pridajte klienta, ktorému aktuálne dostupné termíny nevyhovujú.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {entries.map((e) => {
            const client = data.clients.find((c) => c.id === e.client_id);
            const expired =
              Date.parse(e.until_at) <= now.toMillis() && !["closed", "booked"].includes(e.status);
            const failed =
              data.notifications.find((n) => n.id === e.notification_id)?.status === "failed";
            return (
              <li key={e.id} className="card flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/app/clients/${e.client_id}`}
                    className="font-semibold hover:underline"
                  >
                    {[client?.first_name, client?.last_name].filter(Boolean).join(" ")}
                  </Link>
                  <p className="mt-1 text-sm">
                    {e.service_ids
                      .map(
                        (id) =>
                          data.names.find((svc) => svc.id === id)?.name ?? "Nedostupná služba",
                      )
                      .join(", ")}
                  </p>
                  <p className="mt-1 text-sm text-neutral-600">
                    {fmtDate(e.from_at, s.tenant.timezone, s.tenant.locale, "short")} –{" "}
                    {fmtDate(
                      Date.parse(e.until_at) - 1,
                      s.tenant.timezone,
                      s.tenant.locale,
                      "short",
                    )}{" "}
                    · {e.channel === "email" ? "E-mail" : "SMS"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {e.staff_id
                      ? (data.staff.find((r) => r.id === e.staff_id)?.name ??
                        "Nedostupný člen tímu")
                      : "Ktokoľvek dostupný"}
                  </p>
                  {e.offered_start_at && (
                    <p className="mt-2 text-sm text-brand-700">
                      Ponúknutý termín:{" "}
                      {fmtDateTime(e.offered_start_at, s.tenant.timezone, s.tenant.locale)}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-3">
                  <span
                    className={`badge ${failed ? "bg-red-50 text-red-700" : "bg-brand-50 text-brand-700"}`}
                  >
                    {expired ? "Obdobie uplynulo" : failed ? "Odoslanie zlyhalo" : labels[e.status]}
                  </span>
                  {["offered", "notified"].includes(e.status) &&
                    e.offered_start_at &&
                    Date.parse(e.offered_start_at) > now.toMillis() && (
                      <Link
                        className="text-xs text-brand-700 underline"
                        href={`/w/${s.tenant.slug}/${e.public_token}`}
                      >
                        Zobraziť ponuku
                      </Link>
                    )}
                  {!["closed", "booked"].includes(e.status) && (
                    <form action={closeAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn-secondary text-xs">Ukončiť čakanie</button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-neutral-500">
        Upozornenie nie je rezervácia. Termín si klient potvrdí cez odkaz. Na jednu žiadosť
        posielame jednu úspešnú ponuku; ďalšiu žiadosť pridajte po ukončení pôvodnej.
      </p>
    </div>
  );
}
