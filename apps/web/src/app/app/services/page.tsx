import Link from "next/link";
import { Plus } from "lucide-react";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { servicesWithMeta } from "@/lib/queries";
import { minutes, money } from "@/lib/format";
import { archiveServiceAction } from "./actions";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const s = await requireTenant();
  const { welcome } = await searchParams;
  const services = await servicesWithMeta(db(), s.tenant.id, true);
  const l = s.tenant.locale;
  const groups = new Map<string, typeof services>();
  for (const svc of services) {
    const k = svc.category_name ?? "";
    groups.set(k, [...(groups.get(k) ?? []), svc]);
  }
  return (
    <div className="space-y-4">
      {welcome && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm">
          <strong>Vitajte!</strong> Prevádzka je založená a vy ste prvý člen tímu (Po–Pi 9–17). Pridajte prvé služby, potom je rezervačná stránka <Link className="underline" href={`/b/${s.tenant.slug}`}>/b/{s.tenant.slug}</Link> hotová.
        </div>
      )}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Služby</h1>
        <Link href="/app/services/new" className="btn-primary ml-auto"><Plus size={16} /> Nová služba</Link>
      </div>
      {[...groups.entries()].map(([cat, list]) => (
        <section key={cat || "_"} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {cat && <h2 className="bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase text-neutral-500">{cat}</h2>}
          <ul className="divide-y divide-neutral-100">
            {list.map((svc) => (
              <li key={svc.id} className={`flex items-center gap-4 px-4 py-3 text-sm ${svc.active ? "" : "opacity-50"}`}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: svc.color ?? "#cbd5e1" }} />
                <Link href={`/app/services/${svc.id}`} className="min-w-0 flex-1 hover:underline">
                  <div className="font-medium">{svc.name}</div>
                  <div className="text-neutral-500">
                    {minutes(svc.duration_min, l)}{svc.has_processing ? " · s pôsobením" : ""}{svc.buffer_after_min ? ` · +${svc.buffer_after_min} min prestávka` : ""}{svc.bookable_online ? "" : " · len interne"}
                  </div>
                </Link>
                <span className="tabular-nums">{money(svc.price_cents, s.tenant.currency, l, svc.price_from)}</span>
                <form action={archiveServiceAction}>
                  <input type="hidden" name="id" value={svc.id} />
                  <input type="hidden" name="active" value={svc.active ? "0" : "1"} />
                  <button className="btn-ghost text-xs">{svc.active ? "Archivovať" : "Obnoviť"}</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {services.length === 0 && <div className="card text-sm text-neutral-600">Zatiaľ žiadne služby. Začnite napr. „Dámsky strih, 45 min“.</div>}
    </div>
  );
}
