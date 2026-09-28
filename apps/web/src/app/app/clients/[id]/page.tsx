import Link from "next/link";
import { notFound } from "next/navigation";
import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { fmtDateTime, money } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { updateClientAction } from "../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireTenant();
  const { id } = await params;
  const data = await withTenant(db(), s.tenant.id, async (tx) => {
    const client = await tx.selectFrom("client").selectAll().where("id", "=", id).executeTakeFirst();
    if (!client) return null;
    const appts = await tx.selectFrom("appointment").selectAll().where("client_id", "=", id).orderBy("start_at", "desc").limit(50).execute();
    const items = appts.length
      ? await tx.selectFrom("appointment_item").select(["appointment_id", "service_name", "price_cents"]).where("appointment_id", "in", appts.map((a) => a.id)).execute()
      : [];
    const consents = await tx.selectFrom("consent").selectAll().where("client_id", "=", id).where("revoked_at", "is", null).execute();
    return { client, appts, items, consents };
  });
  if (!data) notFound();
  const { client, appts, items, consents } = data;
  const l = s.tenant.locale;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/app/clients" className="text-sm text-neutral-500 hover:underline">← Klienti</Link>
      <div className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <form action={updateClientAction} className="card space-y-3">
          <input type="hidden" name="id" value={client.id} />
          <h1 className="text-lg font-semibold">{[client.first_name, client.last_name].filter(Boolean).join(" ")}</h1>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Meno</label><input className="input" name="firstName" defaultValue={client.first_name} required /></div>
            <div><label className="label">Priezvisko</label><input className="input" name="lastName" defaultValue={client.last_name ?? ""} /></div>
            <div><label className="label">Telefón</label><input className="input" name="phone" defaultValue={client.phone ?? ""} /></div>
            <div><label className="label">E-mail</label><input className="input" name="email" type="email" defaultValue={client.email ?? ""} /></div>
          </div>
          <div><label className="label">Poznámky (interné)</label><textarea className="input" name="notes" rows={3} defaultValue={client.notes ?? ""} /></div>
          <div>
            <label className="label">Zdravotné poznámky (čl. 9 GDPR – len so súhlasom)</label>
            <textarea className="input" name="healthNotes" rows={2} defaultValue={client.health_notes ?? ""} disabled={!consents.some((c) => c.kind === "health_notes")} />
            <label className="mt-1 flex items-center gap-2 text-xs text-neutral-600">
              <input type="checkbox" name="healthConsent" defaultChecked={consents.some((c) => c.kind === "health_notes")} /> Klient súhlasil so zaznamenaním zdravotných údajov
            </label>
          </div>
          <div className="text-xs text-neutral-500">
            Súhlasy: {consents.length ? consents.map((c) => c.kind).join(", ") : "žiadne"} · no-show: {client.no_show_count}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Uložiť</button>
            <Link href={`/app/appointments/new?client=${client.id}`} className="btn-secondary">Nová rezervácia</Link>
          </div>
        </form>
        <div className="card">
          <h2 className="font-medium">História ({appts.length})</h2>
          <ul className="mt-2 divide-y divide-neutral-100 text-sm">
            {appts.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/app/appointments/${a.id}`} className="flex justify-between hover:underline">
                  <span>{fmtDateTime(a.start_at, s.tenant.timezone, l)}</span>
                  <span className="text-neutral-500">{t(l, `status_${a.status}` as MessageKey)}</span>
                </Link>
                <div className="text-neutral-600">
                  {items.filter((i) => i.appointment_id === a.id).map((i) => i.service_name).join(" + ")} · {money(items.filter((i) => i.appointment_id === a.id).reduce((x, i) => x + i.price_cents, 0), s.tenant.currency, l)}
                </div>
              </li>
            ))}
            {appts.length === 0 && <li className="py-2 text-neutral-500">Zatiaľ žiadne návštevy.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
