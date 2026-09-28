"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  locale: z.enum(["cs", "sk", "en"]),
  timezone: z.string().min(3),
  slotStepMin: z.coerce.number().int().min(5).max(120),
  minNoticeMin: z.coerce.number().int().min(0).max(60 * 24 * 14),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  cancelUntilMin: z.coerce.number().int().min(0).max(60 * 24 * 30),
  reminderHours: z.array(z.coerce.number().int().min(1).max(24 * 14)),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(200),
});

export type SettingsState = { error?: string; ok?: boolean } | undefined;

export async function saveSettingsAction(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const s = await requireTenant();
  if (s.role === "staff") return { error: "Nastavenia môže meniť len majiteľ alebo admin." };
  const parsed = schema.safeParse({
    name: form.get("name"),
    locale: form.get("locale"),
    timezone: form.get("timezone"),
    slotStepMin: form.get("slotStepMin"),
    minNoticeMin: form.get("minNoticeMin"),
    maxAdvanceDays: form.get("maxAdvanceDays"),
    cancelUntilMin: form.get("cancelUntilMin"),
    reminderHours: String(form.get("reminderHours") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    phone: form.get("phone") ?? "",
    address: form.get("address") ?? "",
  });
  if (!parsed.success) return { error: "Skontrolujte hodnoty." };
  const d = parsed.data;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: d.timezone });
  } catch {
    return { error: "Neznáma časová zóna." };
  }
  await withTenant(db(), s.tenant.id, async (tx) => {
    await tx
      .updateTable("tenant")
      .set({ name: d.name, locale: d.locale, timezone: d.timezone, slot_step_min: d.slotStepMin, min_notice_min: d.minNoticeMin, max_advance_days: d.maxAdvanceDays, cancel_until_min: d.cancelUntilMin, reminder_hours: d.reminderHours })
      .where("id", "=", s.tenant.id)
      .execute();
    await tx.updateTable("location").set({ phone: d.phone || null, address: d.address || null }).where("is_default", "=", true).execute();
  });
  revalidatePath("/app", "layout");
  return { ok: true };
}
