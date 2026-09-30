"use server";

import { revalidatePath } from "next/cache";
import { BookingError, cancelAppointment, tenantIdForPublicToken, withTenant } from "@itckar/db";
import { checkPublicActionLimit, publicLimitMessage } from "@/lib/public-action-limit";
import { db } from "@/lib/db";
import { bookingErrorMessage } from "@/lib/i18n";

export type CancelState = { error?: string; retryAfterSeconds?: number } | undefined;

export async function clientCancelAction(_prev: CancelState, form: FormData): Promise<CancelState> {
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{32}$/.test(token)) return { error: "not_found" };
  const tenantId = await tenantIdForPublicToken(db(), token);
  if (!tenantId) return { error: "not_found" };
  const retryAfterSeconds = await checkPublicActionLimit(tenantId, "cancel");
  if (retryAfterSeconds) {
    const tenant = await withTenant(db(), tenantId, (tx) => tx.selectFrom("tenant").select("locale").where("id", "=", tenantId).executeTakeFirstOrThrow());
    return { error: publicLimitMessage(tenant.locale, retryAfterSeconds), retryAfterSeconds };
  }
  try {
    await withTenant(db(), tenantId, async (tx) => {
      const tenant = await tx.selectFrom("tenant").selectAll().where("id", "=", tenantId).executeTakeFirstOrThrow();
      const a = await tx.selectFrom("appointment").select("id").where("public_token", "=", token).executeTakeFirstOrThrow();
      await cancelAppointment(tx, tenant, { appointmentId: a.id, by: "client", reason: "client_online" });
    });
  } catch (e) {
    if (e instanceof BookingError) {
      const tenant = await withTenant(db(), tenantId, (tx) => tx.selectFrom("tenant").select("locale").where("id", "=", tenantId).executeTakeFirst());
      return { error: bookingErrorMessage(tenant?.locale ?? "cs", e.code) };
    }
    throw e;
  }
  revalidatePath(`/r/${token}`);
  return undefined;
}
