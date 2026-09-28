import Link from "next/link";
import { Plus } from "lucide-react";
import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { deactivateResourceAction } from "./actions";

const KIND: Record<string, string> = { staff: "Personál", chair: "Kreslá", room: "Miestnosti", device: "Prístroje", other: "Iné" };
const DAYS = ["Po", "Ut", "St", "Št", "Pi", "So", "Ne"];

export default async function StaffPage() {
  const s = await requireTenant();
  const { resources, rules } = await withTenant(db(), s.tenant.id, async (tx) => ({
    resources: await tx.selectFrom("resource").selectAll().orderBy("active", "desc").orderBy("kind").orderBy("sort_order").orderBy("name").execute(),
    rules: await tx.selectFrom("availability_rule").selectAll().orderBy("weekday").orderBy("start_time").execute(),
  }));
  const groups = ["staff", "chair", "room", "device", "other"].map((k) => ({ kind: k, list: resources.filter((r) => r.kind === k) })).filter((g) => g.list.length);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Tím a zdroje</h1>
        <Link href="/app/staff/new" className="btn-primary ml-auto"><Plus size={16} /> Pridať</Link>
      </div>
      {groups.map((g) => (
        <section key={g.kind} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <h2 className="bg-neutral-50 px-4 py-2 text-xs font-semibold uppercase text-neutral-500">{KIND[g.kind]}</h2>
          <ul className="divide-y divide-neutral-100">
            {g.list.map((r) => {
              const myRules = rules.filter((x) => x.resource_id === r.id);
              return (
                <li key={r.id} className={`flex items-center gap-4 px-4 py-3 text-sm ${r.active ? "" : "opacity-50"}`}>
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color ?? "#cbd5e1" }} />
                  <Link href={`/app/staff/${r.id}`} className="min-w-0 flex-1 hover:underline">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-neutral-500">
                      {r.kind === "staff"
                        ? myRules.length
                          ? [1, 2, 3, 4, 5, 6, 7].filter((d) => myRules.some((x) => x.weekday === d)).map((d) => DAYS[d - 1]).join(" ") + " · " + [...new Set(myRules.map((x) => `${x.start_time.slice(0, 5)}–${x.end_time.slice(0, 5)}`))].join(", ")
                          : "bez pracovného času – nie je rezervovateľný"
                        : "vždy k dispozícii"}
                      {!r.bookable_online && " · len interne"}
                    </div>
                  </Link>
                  <form action={deactivateResourceAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                    <button className="btn-ghost text-xs">{r.active ? "Deaktivovať" : "Aktivovať"}</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
