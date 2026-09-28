"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, createTenantWithOwner, selectTenantForSession, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/, "slug"),
  country: z.enum(["CZ", "SK"]),
  vertical: z.enum(["hair", "barber", "beauty", "nails", "massage", "wellness", "other"]),
});

export type OnboardingState = { error?: string } | undefined;

export async function createTenantAction(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  const s = await requireUser();
  const parsed = schema.safeParse({
    name: form.get("name"),
    slug: form.get("slug"),
    country: form.get("country"),
    vertical: form.get("vertical"),
  });
  if (!parsed.success) return { error: "Skontrolujte názov a adresu (len malé písmená, čísla a pomlčky)." };
  const d = parsed.data;
  const isSK = d.country === "SK";
  let tenantId: string;
  try {
    tenantId = await createTenantWithOwner(
      db(),
      { slug: d.slug, name: d.name, timezone: isSK ? "Europe/Bratislava" : "Europe/Prague", locale: isSK ? "sk" : "cs", currency: isSK ? "EUR" : "CZK", country: d.country, vertical: d.vertical },
      s.user.id,
    );
  } catch (e) {
    if (e instanceof AuthError && e.code === "slug_taken") return { error: "Táto adresa je už obsadená, zvoľte inú." };
    throw e;
  }
  // The owner is also the first bookable staff member.
  await withTenant(db(), tenantId, async (tx) => {
    const loc = await tx.selectFrom("location").select("id").where("is_default", "=", true).executeTakeFirst();
    const staff = await tx
      .insertInto("resource")
      .values({ tenant_id: tenantId, location_id: loc?.id ?? null, kind: "staff", name: s.user.name, user_id: s.user.id, color: "#2f6fed" })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("availability_rule")
      .values([1, 2, 3, 4, 5].map((weekday) => ({ tenant_id: tenantId, resource_id: staff.id, weekday, start_time: "09:00", end_time: "17:00" })))
      .execute();
  });
  await selectTenantForSession(db(), s.sessionId, s.user.id, tenantId);
  redirect("/app/services?welcome=1");
}

export async function switchTenantAction(form: FormData) {
  const s = await requireUser();
  const tenantId = String(form.get("tenantId") ?? "");
  if (!tenantId) return;
  await selectTenantForSession(db(), s.sessionId, s.user.id, tenantId);
  redirect("/app");
}
