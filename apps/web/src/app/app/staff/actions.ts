"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { z } from "zod";
import { addTimeOff, BookingError, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/session";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ruleSchema = z.object({ weekday: z.number().int().min(1).max(7), start: z.string().regex(HHMM), end: z.string().regex(HHMM) });
const schema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["staff", "chair", "room", "device", "other"]),
  color: z.string().trim().max(20),
  bookableOnline: z.boolean(),
  rules: z.array(ruleSchema),
});

export type StaffState = { error?: string } | undefined;

export async function saveResourceAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const s = await requireTenant();
  const parsed = schema.safeParse({
    id: form.get("id") || undefined,
    name: form.get("name"),
    kind: form.get("kind"),
    color: form.get("color") ?? "",
    bookableOnline: form.get("bookableOnline") === "on",
    rules: JSON.parse(String(form.get("rulesJson") ?? "[]")),
  });
  if (!parsed.success) return { error: "Skontrolujte názov a časy (HH:mm)." };
  const d = parsed.data;
  const id = await withTenant(db(), s.tenant.id, async (tx) => {
    const values = { name: d.name, kind: d.kind, color: d.color || null, bookable_online: d.bookableOnline };
    let id: string;
    if (d.id) {
      await tx.updateTable("resource").set(values).where("id", "=", d.id).execute();
      id = d.id;
      await tx.deleteFrom("availability_rule").where("resource_id", "=", id).execute();
    } else {
      const loc = await tx.selectFrom("location").select("id").where("is_default", "=", true).executeTakeFirst();
      id = (await tx.insertInto("resource").values({ tenant_id: s.tenant.id, location_id: loc?.id ?? null, ...values }).returning("id").executeTakeFirstOrThrow()).id;
    }
    if (d.rules.length)
      await tx
        .insertInto("availability_rule")
        .values(d.rules.map((r) => ({ tenant_id: s.tenant.id, resource_id: id, weekday: r.weekday, start_time: r.start, end_time: r.end })))
        .execute();
    return id;
  });
  revalidatePath("/app/staff");
  redirect(`/app/staff/${id}`);
}

export async function deactivateResourceAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const active = form.get("active") === "1";
  await withTenant(db(), s.tenant.id, (tx) => tx.updateTable("resource").set({ active }).where("id", "=", id).execute());
  revalidatePath("/app/staff");
}

const timeOffSchema = z.object({
  resourceId: z.string().uuid(),
  from: z.string().min(10),
  to: z.string().min(10),
  note: z.string().trim().max(200),
});

export async function addTimeOffAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const s = await requireTenant();
  const parsed = timeOffSchema.safeParse({ resourceId: form.get("resourceId"), from: form.get("from"), to: form.get("to"), note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "Zadajte začiatok a koniec." };
  const zone = s.tenant.timezone;
  const from = DateTime.fromISO(parsed.data.from, { zone });
  const to = DateTime.fromISO(parsed.data.to, { zone });
  if (!from.isValid || !to.isValid || to <= from) return { error: "Koniec musí byť po začiatku." };
  try {
    await withTenant(db(), s.tenant.id, (tx) =>
      addTimeOff(tx, s.tenant.id, { resourceId: parsed.data.resourceId, startMs: from.toMillis(), endMs: to.toMillis(), ...(parsed.data.note ? { note: parsed.data.note } : {}) }),
    );
  } catch (e) {
    if (e instanceof BookingError) return { error: "V tomto čase už existuje rezervácia. Najprv ju presuňte alebo zrušte." };
    throw e;
  }
  revalidatePath(`/app/staff/${parsed.data.resourceId}`);
  revalidatePath("/app/calendar");
  return undefined;
}

export async function removeTimeOffAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const resourceId = String(form.get("resourceId"));
  await withTenant(db(), s.tenant.id, (tx) => tx.deleteFrom("resource_block").where("id", "=", id).where("kind", "=", "timeoff").execute());
  revalidatePath(`/app/staff/${resourceId}`);
  revalidatePath("/app/calendar");
}

const overrideSchema = z.object({ resourceId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string(), end: z.string(), note: z.string().max(200) });

/** Day override: empty start/end = day off; otherwise custom hours for that date. */
export async function setDayOverrideAction(_prev: StaffState, form: FormData): Promise<StaffState> {
  const s = await requireTenant();
  const parsed = overrideSchema.safeParse({ resourceId: form.get("resourceId"), date: form.get("date"), start: form.get("start") ?? "", end: form.get("end") ?? "", note: form.get("note") ?? "" });
  if (!parsed.success) return { error: "Zadajte dátum." };
  const d = parsed.data;
  const intervals = d.start && d.end ? [{ start: d.start, end: d.end }] : [];
  if (intervals.length && !(HHMM.test(d.start) && HHMM.test(d.end))) return { error: "Čas vo formáte HH:mm." };
  await withTenant(db(), s.tenant.id, (tx) =>
    tx
      .insertInto("availability_override")
      .values({ tenant_id: s.tenant.id, resource_id: d.resourceId, date: d.date, intervals: JSON.stringify(intervals), note: d.note || null })
      .onConflict((oc) => oc.columns(["resource_id", "date"]).doUpdateSet({ intervals: JSON.stringify(intervals), note: d.note || null }))
      .execute(),
  );
  revalidatePath(`/app/staff/${d.resourceId}`);
  return undefined;
}

export async function removeOverrideAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const resourceId = String(form.get("resourceId"));
  await withTenant(db(), s.tenant.id, (tx) => tx.deleteFrom("availability_override").where("id", "=", id).execute());
  revalidatePath(`/app/staff/${resourceId}`);
}
