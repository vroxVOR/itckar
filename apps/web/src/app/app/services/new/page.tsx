import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { staffResources } from "@/lib/queries";
import { ServiceForm } from "../form";

export default async function NewServicePage() {
  const s = await requireTenant();
  const resources = await staffResources(db(), s.tenant.id);
  const categories = await withTenant(db(), s.tenant.id, (tx) => tx.selectFrom("service_category").select("name").orderBy("sort_order").execute());
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Nová služba</h1>
      <ServiceForm
        initial={{ name: "", description: "", categoryName: "", price: 0, priceFrom: false, bufferBeforeMin: 0, bufferAfterMin: 0, bookableOnline: true, color: "", staffIds: resources.filter((r) => r.kind === "staff").map((r) => r.id), extraKind: "", extraIds: [], segments: [{ name: "", durationMin: 30, kind: "active" }] }}
        staff={resources.filter((r) => r.kind === "staff").map((r) => ({ id: r.id, name: r.name }))}
        extras={resources.filter((r) => r.kind !== "staff").map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
        categories={categories.map((c) => c.name)}
        currency={s.tenant.currency}
      />
    </div>
  );
}
