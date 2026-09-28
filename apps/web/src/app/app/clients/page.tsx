import Link from "next/link";
import { sql, withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireTenant();
  const { q = "" } = await searchParams;
  const clients = await withTenant(db(), s.tenant.id, async (tx) => {
    let query = tx
      .selectFrom("client as c")
      .select(["c.id", "c.first_name", "c.last_name", "c.phone", "c.email", "c.no_show_count", "c.created_at"])
      .select((eb) => [
        eb.selectFrom("appointment as a").select(sql<number>`count(*)::int`.as("n")).whereRef("a.client_id", "=", "c.id").where("a.status", "!=", "cancelled").as("visits"),
        eb.selectFrom("appointment as a").select(sql<string | null>`max(a.start_at)`.as("m")).whereRef("a.client_id", "=", "c.id").where("a.status", "!=", "cancelled").as("last_visit"),
      ])
      .orderBy("c.updated_at", "desc")
      .limit(200);
    if (q.trim()) {
      const like = `%${q.trim()}%`;
      query = query.where((eb) => eb.or([eb("c.first_name", "ilike", like), eb("c.last_name", "ilike", like), eb("c.phone", "ilike", like), eb("c.email", "ilike", like)]));
    }
    return query.execute();
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Klienti</h1>
        <form className="ml-auto flex gap-2">
          <input className="input w-64" name="q" defaultValue={q} placeholder="Meno, telefón, e-mail…" />
          <button className="btn-secondary">Hľadať</button>
        </form>
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr><th className="px-4 py-2">Meno</th><th className="px-4 py-2">Kontakt</th><th className="px-4 py-2 text-right">Návštevy</th><th className="px-4 py-2">Posledná</th><th className="px-4 py-2 text-right">No-show</th></tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-neutral-50">
                <td className="px-4 py-2"><Link href={`/app/clients/${c.id}`} className="font-medium hover:underline">{[c.first_name, c.last_name].filter(Boolean).join(" ")}</Link></td>
                <td className="px-4 py-2 text-neutral-600">{c.phone}{c.email ? ` · ${c.email}` : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.visits}</td>
                <td className="px-4 py-2 text-neutral-600">{c.last_visit ? c.last_visit.slice(0, 10) : "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums">{c.no_show_count || ""}</td>
              </tr>
            ))}
            {clients.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">Žiadni klienti.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
