"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/session";

const segmentSchema = z.object({
  name: z.string().trim().max(80).optional(),
  durationMin: z.coerce.number().int().min(1).max(24 * 60),
  kind: z.enum(["active", "processing"]),
});

const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  categoryName: z.string().trim().max(80),
  price: z.coerce.number().min(0).max(1_000_000),
  priceFrom: z.boolean(),
  bufferBeforeMin: z.coerce.number().int().min(0).max(240),
  bufferAfterMin: z.coerce.number().int().min(0).max(240),
  bookableOnline: z.boolean(),
  staffIds: z.array(z.string().uuid()).min(1, "staff"),
  extraKind: z.enum(["", "chair", "room", "device"]),
  extraIds: z.array(z.string().uuid()),
  segments: z.array(segmentSchema).min(1),
  color: z.string().trim().max(20),
});

export type ServiceState = { error?: string } | undefined;

function parseForm(form: FormData) {
  const segments = JSON.parse(String(form.get("segmentsJson") ?? "[]"));
  return schema.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name"),
    description: form.get("description") ?? "",
    categoryName: form.get("categoryName") ?? "",
    price: form.get("price") ?? 0,
    priceFrom: form.get("priceFrom") === "on",
    bufferBeforeMin: form.get("bufferBeforeMin") ?? 0,
    bufferAfterMin: form.get("bufferAfterMin") ?? 0,
    bookableOnline: form.get("bookableOnline") === "on",
    staffIds: form.getAll("staffIds"),
    extraKind: form.get("extraKind") ?? "",
    extraIds: form.getAll("extraIds"),
    segments,
    color: form.get("color") ?? "",
  });
}

export async function saveServiceAction(_prev: ServiceState, form: FormData): Promise<ServiceState> {
  const s = await requireTenant();
  const parsed = parseForm(form);
  if (!parsed.success) {
    const staffIssue = parsed.error.issues.some((i) => i.path[0] === "staffIds");
    return { error: staffIssue ? "Vyberte aspoň jedného člena tímu, ktorý službu robí." : "Skontrolujte názov, cenu a trvanie segmentov." };
  }
  const d = parsed.data;
  const extraKind = d.extraKind || null;
  const useExtra = Boolean(extraKind && d.extraIds.length > 0);
  // Active segments occupy staff (+ the extra resource); processing segments occupy only the
  // extra resource. Processing without a chair/room means "staff is free, nothing is occupied".

  const serviceId = await withTenant(db(), s.tenant.id, async (tx) => {
    let categoryId: string | null = null;
    if (d.categoryName) {
      const cat = await tx.selectFrom("service_category").select("id").where("name", "=", d.categoryName).executeTakeFirst();
      categoryId = cat
        ? cat.id
        : (await tx.insertInto("service_category").values({ tenant_id: s.tenant.id, name: d.categoryName }).returning("id").executeTakeFirstOrThrow()).id;
    }
    const values = {
      name: d.name,
      description: d.description || null,
      category_id: categoryId,
      price_cents: Math.round(d.price * 100),
      price_from: d.priceFrom,
      buffer_before_min: d.bufferBeforeMin,
      buffer_after_min: d.bufferAfterMin,
      bookable_online: d.bookableOnline,
      color: d.color || null,
    };
    let id: string;
    if (d.id) {
      await tx.updateTable("service").set(values).where("id", "=", d.id).execute();
      id = d.id;
      await tx.deleteFrom("service_requirement").where("service_id", "=", id).execute();
      await tx.deleteFrom("service_segment").where("service_id", "=", id).execute();
    } else {
      id = (await tx.insertInto("service").values({ tenant_id: s.tenant.id, ...values }).returning("id").executeTakeFirstOrThrow()).id;
    }
    const staffReq = await tx
      .insertInto("service_requirement")
      .values({ tenant_id: s.tenant.id, service_id: id, key: "staff", kind: "staff", sort_order: 0 })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("service_requirement_candidate")
      .values(d.staffIds.map((rid) => ({ requirement_id: staffReq.id, resource_id: rid, tenant_id: s.tenant.id })))
      .execute();
    if (useExtra) {
      const extraReq = await tx
        .insertInto("service_requirement")
        .values({ tenant_id: s.tenant.id, service_id: id, key: extraKind!, kind: extraKind!, sort_order: 1 })
        .returning("id")
        .executeTakeFirstOrThrow();
      await tx
        .insertInto("service_requirement_candidate")
        .values(d.extraIds.map((rid) => ({ requirement_id: extraReq.id, resource_id: rid, tenant_id: s.tenant.id })))
        .execute();
    }
    await tx
      .insertInto("service_segment")
      .values(
        d.segments.map((seg, i) => ({
          tenant_id: s.tenant.id,
          service_id: id,
          position: i,
          name: seg.name || null,
          duration_min: seg.durationMin,
          kind: seg.kind,
          occupies: seg.kind === "processing" ? (useExtra ? [extraKind!] : []) : useExtra ? ["staff", extraKind!] : ["staff"],
        })),
      )
      .execute();
    return id;
  });
  revalidatePath("/app/services");
  redirect(`/app/services?saved=${serviceId}`);
}

export async function archiveServiceAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const active = form.get("active") === "1";
  await withTenant(db(), s.tenant.id, (tx) => tx.updateTable("service").set({ active }).where("id", "=", id).execute());
  revalidatePath("/app/services");
}
