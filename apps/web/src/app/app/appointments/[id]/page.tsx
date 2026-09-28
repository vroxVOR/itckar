import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { appointmentDetail } from "@/lib/queries";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { cancelAction, setStatusAction } from "../actions";

const statusColor: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  completed: "bg-neutral-100 text-neutral-700",
  cancelled: "bg-red-50 text-red-700",
  no_show: "bg-orange-50 text-orange-700",
};

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireTenant();
  const { id } = await params;
  const a = await appointmentDetail(db(), s.tenant.id, id);
  if (!a) notFound();
  const l = s.tenant.locale;
  const zone = s.tenant.timezone;
  const day = a.start_at.slice(0, 10);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/app/calendar?date=${day}`} className="text-sm text-neutral-500 hover:underline">← Kalendár</Link>
        <span className={`badge ${statusColor[a.status]}`}>{t(l, `status_${a.status}` as MessageKey)}</span>
        <span className="ml-auto text-xs text-neutral-400">{a.source}</span>
      </div>
      <div className="card">
        <h1 className="text-xl font-semibold">{fmtDate(a.start_at, zone, l)}</h1>
        <p className="text-lg">{fmtTime(a.start_at, zone, l)} – {fmtTime(a.end_at, zone, l)}</p>
        <ul className="mt-4 divide-y divide-neutral-100 text-sm">
          {a.items.map((i) => (
            <li key={i.id} className="flex justify-between py-2">
              <span>{i.service_name}</span>
              <span className="text-neutral-600">{money(i.price_cents, s.tenant.currency, l)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 text-sm">
          {a.segments.map((seg) => (
            <div key={seg.id} className="flex gap-2 text-neutral-600">
              <span className="w-24 tabular-nums">{fmtTime(seg.start_at, zone, l)}–{fmtTime(seg.end_at, zone, l)}</span>
              <span>{seg.kind === "processing" ? "⏳ pôsobenie" : "aktívne"}</span>
              <span>· {seg.resource_ids.map((rid) => a.resources.find((r) => r.id === rid)?.name ?? "?").join(", ")}</span>
            </div>
          ))}
        </div>
        {a.client_note && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">Poznámka klienta: {a.client_note}</p>}
        {a.notes && <p className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm">Interná poznámka: {a.notes}</p>}
      </div>

      <div className="card">
        <h2 className="font-medium">Klient</h2>
        {a.client_id ? (
          <div className="mt-2 text-sm">
            <Link href={`/app/clients/${a.client_id}`} className="font-medium hover:underline">{[a.first_name, a.last_name].filter(Boolean).join(" ")}</Link>
            <div className="text-neutral-600">{a.phone} {a.email && `· ${a.email}`}</div>
            {a.no_show_count! > 0 && <div className="mt-1 text-orange-700">Neprišiel/a {a.no_show_count}×</div>}
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">Bez klienta</p>
        )}
      </div>

      {a.status !== "cancelled" && (
        <div className="card flex flex-wrap gap-2">
          {a.status !== "completed" && (
            <form action={setStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="completed" /><button className="btn-secondary">Hotovo</button></form>
          )}
          {a.status !== "no_show" && (
            <form action={setStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="no_show" /><button className="btn-secondary">Neprišiel/a</button></form>
          )}
          {a.status !== "confirmed" && (
            <form action={setStatusAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="status" value="confirmed" /><button className="btn-secondary">Späť na potvrdené</button></form>
          )}
          <form action={cancelAction} className="ml-auto flex gap-2">
            <input type="hidden" name="id" value={a.id} />
            <input className="input w-48" name="reason" placeholder="Dôvod (voliteľné)" />
            <button className="btn-danger">Zrušiť rezerváciu</button>
          </form>
        </div>
      )}

      {a.notifications.length > 0 && (
        <div className="card text-sm">
          <h2 className="font-medium">Notifikácie</h2>
          <ul className="mt-2 space-y-1 text-neutral-600">
            {a.notifications.map((n) => (
              <li key={n.id}>{n.channel} · {n.template} → {n.recipient} · {n.status}{n.error ? ` (${n.error})` : ""}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
