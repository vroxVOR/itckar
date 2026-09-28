"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/session";

const schema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80),
  phone: z.string().trim().max(30),
  email: z.string().trim().max(200),
  notes: z.string().trim().max(5000),
  healthNotes: z.string().trim().max(5000).optional(),
  healthConsent: z.boolean(),
});

export async function updateClientAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const d = schema.parse({
    id: form.get("id"),
    firstName: form.get("firstName"),
    lastName: form.get("lastName") ?? "",
    phone: form.get("phone") ?? "",
    email: form.get("email") ?? "",
    notes: form.get("notes") ?? "",
    healthNotes: form.get("healthNotes") ?? undefined,
    healthConsent: form.get("healthConsent") === "on",
  });
  await withTenant(db(), s.tenant.id, async (tx) => {
    const hasConsent = await tx.selectFrom("consent").select("id").where("client_id", "=", d.id).where("kind", "=", "health_notes").where("revoked_at", "is", null).executeTakeFirst();
    if (d.healthConsent && !hasConsent)
      await tx.insertInto("consent").values({ tenant_id: s.tenant.id, client_id: d.id, kind: "health_notes", source: "admin", text_version: "v1" }).execute();
    if (!d.healthConsent && hasConsent)
      await tx.updateTable("consent").set({ revoked_at: new Date() }).where("id", "=", hasConsent.id).execute();
    await tx
      .updateTable("client")
      .set({
        first_name: d.firstName,
        last_name: d.lastName || null,
        phone: d.phone || null,
        email: d.email || null,
        notes: d.notes || null,
        // Without consent the health notes are wiped (data minimisation).
        health_notes: d.healthConsent ? (d.healthNotes ?? null) || null : null,
      })
      .where("id", "=", d.id)
      .execute();
  });
  revalidatePath(`/app/clients/${d.id}`);
}
