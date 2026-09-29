"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import { z } from "zod";
import { addWaitlistEntry, closeWaitlistEntry, WaitlistError, withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";

export type WaitlistState = { error?: string; success?: boolean } | undefined;
export async function addAction(_previous: WaitlistState, form: FormData): Promise<WaitlistState> {
  const s = await requireTenant();
  const parsed = z
    .object({
      clientId: z.string().uuid(),
      serviceIds: z.array(z.string().uuid()).min(1).max(6),
      staffId: z.string().uuid().or(z.literal("")),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      channel: z.enum(["email", "sms"]),
      requested: z.literal(true),
    })
    .safeParse({
      ...Object.fromEntries(form),
      serviceIds: form.getAll("serviceIds"),
      requested: form.get("requested") === "on",
    });
  if (!parsed.success)
    return { error: "Vyberte klienta, služby, obdobie a potvrďte jeho žiadosť o upozornenie." };
  const d = parsed.data;
  const from = DateTime.fromISO(d.from, { zone: s.tenant.timezone }).startOf("day");
  const until = DateTime.fromISO(d.until, { zone: s.tenant.timezone })
    .plus({ days: 1 })
    .startOf("day");
  if (!from.isValid || !until.isValid) return { error: "Vyberte platné obdobie." };
  try {
    await withTenant(db(), s.tenant.id, (tx) =>
      addWaitlistEntry(tx, s.tenant, {
        clientId: d.clientId,
        serviceIds: d.serviceIds,
        ...(d.staffId ? { staffId: d.staffId } : {}),
        fromMs: from.toMillis(),
        untilMs: until.toMillis(),
        channel: d.channel,
        actorId: s.user.id,
        requested: d.requested,
      }),
    );
  } catch (e) {
    if (e instanceof WaitlistError)
      return {
        error: {
          contact:
            "Klient nemá kontakt pre zvolený spôsob upozornenia. Doplňte ho v karte klienta.",
          duplicate: "Tento klient už na rovnaký výber čaká.",
          not_found: "Klient sa nenašiel.",
          invalid: "Skontrolujte obdobie, online služby a či ich vybraný člen tímu poskytuje.",
        }[e.code],
      };
    throw e;
  }
  revalidatePath("/app/waitlist");
  return { success: true };
}

export async function closeAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = z.string().uuid().safeParse(form.get("id"));
  if (!id.success) return;
  await withTenant(db(), s.tenant.id, (tx) => closeWaitlistEntry(tx, { id: id.data }));
  revalidatePath("/app/waitlist");
}
