import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { servicesWithMeta, staffResources } from "@/lib/queries";
import { dayFromParam } from "@/lib/format";
import { NewAppointmentForm } from "./form";

export default async function NewAppointmentPage({ searchParams }: { searchParams: Promise<{ date?: string; time?: string; staff?: string; client?: string }> }) {
  const s = await requireTenant();
  const sp = await searchParams;
  const [services, resources, clients] = await Promise.all([
    servicesWithMeta(db(), s.tenant.id),
    staffResources(db(), s.tenant.id),
    withTenant(db(), s.tenant.id, (tx) =>
      tx.selectFrom("client").select(["id", "first_name", "last_name", "phone", "email"]).orderBy("updated_at", "desc").limit(500).execute(),
    ),
  ]);
  const day = dayFromParam(sp.date, s.tenant.timezone);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Nová rezervácia</h1>
      <NewAppointmentForm
        services={services.map((x) => ({ id: x.id, name: x.name, duration: x.duration_min, price: x.price_cents }))}
        staff={resources.filter((r) => r.kind === "staff").map((r) => ({ id: r.id, name: r.name }))}
        clients={clients.map((c) => ({ id: c.id, label: `${[c.first_name, c.last_name].filter(Boolean).join(" ")}${c.phone ? ` · ${c.phone}` : ""}` }))}
        defaults={{ date: day.toISODate()!, time: sp.time ?? "10:00", staffId: sp.staff ?? "", clientId: sp.client ?? "" }}
        currency={s.tenant.currency}
        locale={s.tenant.locale}
        step={s.tenant.slot_step_min}
      />
    </div>
  );
}
