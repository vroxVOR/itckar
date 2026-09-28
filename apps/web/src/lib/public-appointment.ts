import "server-only";
import { tenantIdForPublicToken, withTenant } from "@itckar/db";
import { db } from "@/lib/db";

export async function publicAppointment(token: string) {
  const tenantId = await tenantIdForPublicToken(db(), token);
  if (!tenantId) return null;
  return withTenant(db(), tenantId, async (tx) => {
    const tenant = await tx.selectFrom("tenant").selectAll().where("id", "=", tenantId).executeTakeFirstOrThrow();
    const a = await tx.selectFrom("appointment").selectAll().where("public_token", "=", token).executeTakeFirst();
    if (!a) return null;
    const items = await tx.selectFrom("appointment_item").selectAll().where("appointment_id", "=", a.id).orderBy("position").execute();
    const client = a.client_id ? await tx.selectFrom("client").select(["first_name", "phone", "email", "locale"]).where("id", "=", a.client_id).executeTakeFirst() : undefined;
    const location = await tx.selectFrom("location").select(["address", "phone"]).where("is_default", "=", true).executeTakeFirst();
    const staffIds = [...new Set((await tx.selectFrom("appointment_segment").select("resource_ids").where("appointment_id", "=", a.id).execute()).flatMap((s) => s.resource_ids))];
    const staff = staffIds.length ? await tx.selectFrom("resource").select(["name"]).where("id", "in", staffIds).where("kind", "=", "staff").execute() : [];
    return { tenant, appointment: a, items, client, location, staff: staff.map((s) => s.name) };
  });
}
