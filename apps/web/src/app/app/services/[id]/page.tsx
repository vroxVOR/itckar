import { notFound } from "next/navigation";
import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { staffResources } from "@/lib/queries";
import { ServiceForm, type ServiceFormData } from "../form";

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireTenant();
  const { id } = await params;
  const data = await withTenant(db(), s.tenant.id, async (tx) => {
    const svc = await tx.selectFrom("service").selectAll().where("id", "=", id).executeTakeFirst();
    if (!svc) return null;
    const cat = svc.category_id ? await tx.selectFrom("service_category").select("name").where("id", "=", svc.category_id).executeTakeFirst() : null;
    const reqs = await tx.selectFrom("service_requirement").selectAll().where("service_id", "=", id).execute();
    const cands = reqs.length ? await tx.selectFrom("service_requirement_candidate").selectAll().where("requirement_id", "in", reqs.map((r) => r.id)).execute() : [];
    const segs = await tx.selectFrom("service_segment").selectAll().where("service_id", "=", id).orderBy("position").execute();
    const categories = await tx.selectFrom("service_category").select("name").orderBy("sort_order").execute();
    return { svc, cat, reqs, cands, segs, categories };
  });
  if (!data) notFound();
  const resources = await staffResources(db(), s.tenant.id);
  const staffReq = data.reqs.find((r) => r.key === "staff");
  const extraReq = data.reqs.find((r) => r.key !== "staff");
  const initial: ServiceFormData = {
    id,
    name: data.svc.name,
    description: data.svc.description ?? "",
    categoryName: data.cat?.name ?? "",
    price: data.svc.price_cents / 100,
    priceFrom: data.svc.price_from,
    bufferBeforeMin: data.svc.buffer_before_min,
    bufferAfterMin: data.svc.buffer_after_min,
    bookableOnline: data.svc.bookable_online,
    color: data.svc.color ?? "",
    staffIds: data.cands.filter((c) => c.requirement_id === staffReq?.id).map((c) => c.resource_id),
    extraKind: (extraReq?.kind as ServiceFormData["extraKind"]) ?? "",
    extraIds: data.cands.filter((c) => c.requirement_id === extraReq?.id).map((c) => c.resource_id),
    segments: data.segs.map((x) => ({ name: x.name ?? "", durationMin: x.duration_min, kind: x.kind })),
  };
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{data.svc.name}</h1>
      <ServiceForm
        initial={initial}
        staff={resources.filter((r) => r.kind === "staff").map((r) => ({ id: r.id, name: r.name }))}
        extras={resources.filter((r) => r.kind !== "staff").map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
        categories={data.categories.map((c) => c.name)}
        currency={s.tenant.currency}
      />
    </div>
  );
}
