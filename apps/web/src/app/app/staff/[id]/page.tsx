import { notFound } from "next/navigation";
import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { timeOffInRange } from "@/lib/queries";
import { fmtDateTime } from "@/lib/format";
import { ResourceForm } from "../form";
import { TimeOffForms } from "./timeoff";
import { removeOverrideAction, removeTimeOffAction } from "../actions";

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireTenant();
  const { id } = await params;
  const data = await withTenant(db(), s.tenant.id, async (tx) => {
    const r = await tx.selectFrom("resource").selectAll().where("id", "=", id).executeTakeFirst();
    if (!r) return null;
    const rules = await tx.selectFrom("availability_rule").selectAll().where("resource_id", "=", id).orderBy("weekday").orderBy("start_time").execute();
    const overrides = await tx.selectFrom("availability_override").selectAll().where("resource_id", "=", id).where("date", ">=", new Date().toISOString().slice(0, 10)).orderBy("date").execute();
    return { r, rules, overrides };
  });
  if (!data) notFound();
  const timeOff = (await timeOffInRange(db(), s.tenant.id, new Date().toISOString(), new Date(Date.now() + 365 * 86_400_000).toISOString())).filter((b) => b.resource_id === id);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">{data.r.name}</h1>
      <ResourceForm
        initial={{ id, name: data.r.name, kind: data.r.kind, color: data.r.color ?? "", bookableOnline: data.r.bookable_online, rules: data.rules.map((x) => ({ weekday: x.weekday, start: x.start_time.slice(0, 5), end: x.end_time.slice(0, 5) })) }}
      />
      <TimeOffForms resourceId={id} />
      {(timeOff.length > 0 || data.overrides.length > 0) && (
        <section className="card text-sm">
          <h2 className="font-medium">Naplánované voľno a výnimky</h2>
          <ul className="mt-2 divide-y divide-neutral-100">
            {timeOff.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2">
                <span>{fmtDateTime(b.start, s.tenant.timezone, s.tenant.locale)} – {fmtDateTime(b.end, s.tenant.timezone, s.tenant.locale)} {b.note && <span className="text-neutral-500">· {b.note}</span>}</span>
                <form action={removeTimeOffAction}><input type="hidden" name="id" value={b.id} /><input type="hidden" name="resourceId" value={id} /><button className="btn-ghost text-xs">Odstrániť</button></form>
              </li>
            ))}
            {data.overrides.map((o) => {
              const iv = o.intervals as { start: string; end: string }[];
              return (
                <li key={o.id} className="flex items-center justify-between py-2">
                  <span>{o.date}: {iv.length ? iv.map((x) => `${x.start}–${x.end}`).join(", ") : "voľný deň"} {o.note && <span className="text-neutral-500">· {o.note}</span>}</span>
                  <form action={removeOverrideAction}><input type="hidden" name="id" value={o.id} /><input type="hidden" name="resourceId" value={id} /><button className="btn-ghost text-xs">Odstrániť</button></form>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
