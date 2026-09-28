"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { BookingError, createAppointment, publicTenantBySlug, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { bookingErrorMessage } from "@/lib/i18n";

const schema = z.object({
  slug: z.string(),
  serviceIds: z.array(z.string().uuid()).min(1).max(6),
  staffId: z.string().uuid().optional().or(z.literal("")),
  startMs: z.coerce.number().int().positive(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80),
  phone: z.string().trim().min(6).max(30),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(1000),
  consentSms: z.boolean(),
  consentEmail: z.boolean(),
  locale: z.string().max(5),
  website: z.string().max(0), // honeypot
});

export type BookState = { error?: string } | undefined;

export async function bookAction(_prev: BookState, form: FormData): Promise<BookState> {
  const parsed = schema.safeParse({
    slug: form.get("slug"),
    serviceIds: String(form.get("serviceIds") ?? "").split(",").filter(Boolean),
    staffId: form.get("staffId") ?? "",
    startMs: form.get("startMs"),
    firstName: form.get("firstName"),
    lastName: form.get("lastName") ?? "",
    phone: form.get("phone"),
    email: form.get("email") ?? "",
    note: form.get("note") ?? "",
    consentSms: form.get("consentSms") === "on",
    consentEmail: form.get("consentEmail") === "on",
    locale: form.get("locale") ?? "",
    website: form.get("website") ?? "",
  });
  if (!parsed.success) return { error: "Vyplňte meno a telefón." };
  const d = parsed.data;
  const tenant = await publicTenantBySlug(db(), d.slug);
  if (!tenant) return { error: "Prevádzka neexistuje." };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let token: string;
  try {
    const created = await withTenant(db(), tenant.id, (tx) =>
      createAppointment(tx, tenant, {
        serviceIds: d.serviceIds,
        startMs: d.startMs,
        ...(d.staffId ? { pin: { staff: d.staffId } } : {}),
        client: {
          firstName: d.firstName,
          ...(d.lastName ? { lastName: d.lastName } : {}),
          phone: d.phone,
          ...(d.email ? { email: d.email } : {}),
          ...(d.note ? { note: d.note } : {}),
          locale: d.locale || tenant.locale,
          marketingSmsConsent: d.consentSms,
          marketingEmailConsent: d.consentEmail,
          ...(ip ? { consentIp: ip } : {}),
        },
        source: "online",
      }),
    );
    token = created.publicToken;
  } catch (e) {
    if (e instanceof BookingError) return { error: bookingErrorMessage(tenant.locale, e.code) };
    throw e;
  }
  redirect(`/b/${d.slug}/done/${token}`);
}
