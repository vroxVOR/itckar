"use server";

import { redirect } from "next/navigation";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { consumePhoneChallenge, verifyPhoneChallenge, BookingError, completeWaitlistEntry, createAppointment, holdSlot, releaseHold, publicTenantBySlug, withTenant } from "@itckar/db";
import { checkPublicActionLimit, publicLimitMessage } from "@/lib/public-action-limit";
import { db } from "@/lib/db";
import { matchesHold, readHold, signHold, type HoldSelection } from "@/lib/booking-hold";
import { bookingPhone, phoneHash, hasRememberedPhone, rememberedPhone } from "@/lib/phone-verification";
import { t } from "@/lib/i18n";
import { bookingErrorMessage } from "@/lib/i18n";

const selectionSchema = z.object({
  slug: z.string().min(1).max(100),
  serviceIds: z.array(z.string().uuid()).min(1).max(6),
  staffId: z.string().uuid().or(z.literal("")),
  startMs: z.number().int().positive(),
});

const schema = z.object({
  phoneToken: z.string().regex(/^(?:[a-f0-9]{48})?$/),
  phoneCode: z.string().regex(/^(?:[0-9]{6})?$/),
  waitlistToken: z.string().regex(/^(?:[a-f0-9]{48})?$/),
  holdTicket: z.string().max(32_768),
  slug: z.string().min(1).max(100),
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

export type BookState = { error?: string; holdExpired?: boolean; retryAfterSeconds?: number } | undefined;

export async function bookAction(_prev: BookState, form: FormData): Promise<BookState> {
  const parsed = schema.safeParse({
    phoneToken: form.get("phoneToken") ?? "",
    phoneCode: form.get("phoneCode") ?? "",
    waitlistToken: form.get("waitlistToken") ?? "",
    holdTicket: form.get("holdTicket") ?? "",
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
  const retryAfterSeconds = await checkPublicActionLimit(tenant.id, "book");
  if (retryAfterSeconds) return { error: publicLimitMessage(tenant.locale, retryAfterSeconds), retryAfterSeconds };
  const hold = readHold(d.holdTicket, process.env.SESSION_SECRET ?? "");
  if (!hold || !matchesHold(hold, tenant.id, { ...d, staffId: d.staffId ?? "" })) {
    return { error: bookingErrorMessage(tenant.locale, "hold_expired"), holdExpired: true };
  }
  const phone = bookingPhone(d.phone, tenant.country);
  if (!phone) return { error: t(tenant.locale, "phone_invalid") };
  const tokenHash = phoneHash(tenant.id, "token", d.phoneToken);
  const phoneKey = phoneHash(tenant.id, "phone", phone);
  const remembered = hasRememberedPhone(tenant.id, phoneKey, (await cookies()).get(`phone_${tenant.id}`)?.value);
  const verified = remembered || d.phoneToken && d.phoneCode && await withTenant(db(), tenant.id, tx => verifyPhoneChallenge(tx, {
    tokenHash, phoneHash: phoneKey, codeHash: phoneHash(tenant.id, "code", `${d.phoneToken}:${d.phoneCode}`),
  }));
  if (!verified) return { error: t(tenant.locale, "phone_incorrect") };
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let token: string;
  try {
    const created = await withTenant(db(), tenant.id, async (tx) => {
      if (!remembered && !await consumePhoneChallenge(tx, tokenHash, phoneKey)) throw new Error("phone_proof_expired");
      const appointment = await createAppointment(tx, tenant, {
        holdToken: hold.holdToken,
        assignments: hold.assignments,
        serviceIds: d.serviceIds,
        startMs: d.startMs,
        ...(d.staffId ? { pin: { staff: d.staffId } } : {}),
        client: {
          firstName: d.firstName,
          ...(d.lastName ? { lastName: d.lastName } : {}),
          phone,
          ...(d.email ? { email: d.email } : {}),
          ...(d.note ? { note: d.note } : {}),
          locale: d.locale || tenant.locale,
          marketingSmsConsent: d.consentSms,
          marketingEmailConsent: d.consentEmail,
          ...(ip ? { consentIp: ip } : {}),
        },
        source: "online",
      });
      await completeWaitlistEntry(tx, { token: d.waitlistToken, appointmentId: appointment.id, serviceIds: d.serviceIds, startMs: d.startMs, staffId: d.staffId ?? "" });
      return appointment;
    });
    token = created.publicToken;
  } catch (e) {
    if (e instanceof Error && e.message === "phone_proof_expired") return { error: t(tenant.locale, "phone_incorrect") };
    if (e instanceof BookingError) return { error: bookingErrorMessage(tenant.locale, e.code), holdExpired: e.code === "hold_expired" };
    throw e;
  }
  (await cookies()).set(`phone_${tenant.id}`, rememberedPhone(tenant.id, phoneKey), {
    httpOnly: true, secure: new URL(process.env.APP_URL ?? "http://localhost").protocol === "https:",
    sameSite: "lax", path: `/b/${d.slug}`, maxAge: 30 * 86400,
  });
  redirect(`/b/${d.slug}/done/${token}`);
}


export type HoldState = { ticket: string; expiresAt: number; serverNow: number } | { error: string; retryAfterSeconds?: number };

/** POST-only acquisition. Rendering/prefetching a page must never reserve capacity. */
export async function acquireHoldAction(selection: HoldSelection, previousTicket = ""): Promise<HoldState> {
  const parsed = selectionSchema.safeParse(selection);
  if (!parsed.success) return { error: bookingErrorMessage("sk", "slot_unavailable") };
  const d = parsed.data;
  const tenant = await publicTenantBySlug(db(), d.slug);
  if (!tenant) return { error: bookingErrorMessage("sk", "slot_unavailable") };
  const secret = process.env.SESSION_SECRET ?? "";
  const previous = readHold(previousTicket, secret);
  try {
    if (previous && matchesHold(previous, tenant.id, d)) {
      const live = await withTenant(db(), tenant.id, (tx) => tx.selectFrom("resource_block").select("expires_at")
        .where("hold_token", "=", previous.holdToken).where("expires_at", ">", new Date().toISOString()).executeTakeFirst());
      if (live) return { ticket: previousTicket, expiresAt: previous.expiresAt, serverNow: Date.now() };
    }
    const retryAfterSeconds = await checkPublicActionLimit(tenant.id, "hold");
    if (retryAfterSeconds) return { error: publicLimitMessage(tenant.locale, retryAfterSeconds), retryAfterSeconds };
    return await withTenant(db(), tenant.id, async (tx) => {
      const hold = await holdSlot(tx, tenant, {
        serviceIds: d.serviceIds, startMs: d.startMs, ttlMin: 5,
        ...(d.staffId ? { pin: { staff: d.staffId } } : {}),
      });
      const expiresAt = hold.expiresAt.getTime();
      return { ticket: signHold({ ...d, tenantId: tenant.id, holdToken: hold.token, assignments: hold.slot.assignments, expiresAt }, secret), expiresAt, serverNow: Date.now() };
    });
  } catch (e) {
    if (e instanceof BookingError) return { error: bookingErrorMessage(tenant.locale, e.code) };
    throw e;
  }
}

export async function releaseHoldAction(raw: string): Promise<void> {
  const hold = readHold(raw, process.env.SESSION_SECRET ?? "");
  if (!hold) return;
  await withTenant(db(), hold.tenantId, (tx) => releaseHold(tx, hold.holdToken));
}
