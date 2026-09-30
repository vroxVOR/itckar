"use server";

import { cookies } from "next/headers";
import { randomBytes, randomInt } from "node:crypto";
import { consumePublicActionLimit, publicTenantBySlug, sql, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import {
  bookingPhone,
  hasRememberedPhone,
  phoneDemoMode,
  phoneHash,
} from "@/lib/phone-verification";
import { readHold } from "@/lib/booking-hold";
import { checkPublicActionLimit, publicLimitMessage } from "@/lib/public-action-limit";
import { smsProvider } from "@/worker/providers/sms";
import { t } from "@/lib/i18n";

export type PhoneState = {
  token?: string;
  message?: string;
  error?: string;
  demoCode?: string;
  remembered?: boolean;
};
export async function sendPhoneCodeAction(
  slug: string,
  rawPhone: string,
  holdTicket: string,
): Promise<PhoneState> {
  if (
    typeof slug !== "string" ||
    slug.length > 100 ||
    typeof rawPhone !== "string" ||
    rawPhone.length > 30
  )
    return { error: t("sk", "phone_invalid") };
  const tenant = await publicTenantBySlug(db(), slug);
  if (!tenant) return { error: t("sk", "error_generic") };
  const phone = bookingPhone(rawPhone, tenant.country);
  if (!phone) return { error: t(tenant.locale, "phone_invalid") };
  const hold = readHold(holdTicket, process.env.SESSION_SECRET ?? "");
  if (!hold || hold.tenantId !== tenant.id) return { error: t(tenant.locale, "err_hold_expired") };
  const live = await withTenant(db(), tenant.id, (tx) =>
    tx
      .selectFrom("resource_block")
      .select("hold_token")
      .where("hold_token", "=", hold.holdToken)
      .where("expires_at", ">", sql<string>`clock_timestamp()`)
      .executeTakeFirst(),
  );
  if (!live) return { error: t(tenant.locale, "err_hold_expired") };
  const phoneKey = phoneHash(tenant.id, "phone", phone);
  if (hasRememberedPhone(tenant.id, phoneKey, (await cookies()).get(`phone_${tenant.id}`)?.value))
    return { remembered: true, message: t(tenant.locale, "phone_remembered") };
  const wait = await checkPublicActionLimit(tenant.id, "sms");
  if (wait) return { error: publicLimitMessage(tenant.locale, wait) };
  const budget = await withTenant(db(), tenant.id, async (tx) => {
    const burst = await consumePublicActionLimit(tx, {
      tenantId: tenant.id,
      action: "sms",
      keyHash: phoneHash(tenant.id, "phone", `cooldown:${phone}`),
      limit: 1,
      windowSeconds: 60,
    });
    if (!burst.allowed) return burst;
    return consumePublicActionLimit(tx, {
      tenantId: tenant.id,
      action: "sms",
      keyHash: phoneKey,
      limit: 3,
      windowSeconds: 900,
    });
  });
  if (!budget.allowed)
    return { error: publicLimitMessage(tenant.locale, budget.retryAfterSeconds) };
  const token = randomBytes(24).toString("hex");
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const tokenHash = phoneHash(tenant.id, "token", token);
  const demo = phoneDemoMode();
  // Never silently use the console transport as proof of real phone ownership.
  if (!demo && !["twilio", "bulkgate"].includes(process.env.SMS_PROVIDER ?? ""))
    return { error: t(tenant.locale, "phone_unavailable") };
  await withTenant(db(), tenant.id, async (tx) => {
    await tx
      .deleteFrom("phone_challenge")
      .where(
        "token_hash",
        "in",
        tx
          .selectFrom("phone_challenge")
          .select("token_hash")
          .where("expires_at", "<", sql<string>`clock_timestamp()`)
          .limit(100),
      )
      .execute();
    await tx
      .insertInto("phone_challenge")
      .values({
        tenant_id: tenant.id,
        token_hash: tokenHash,
        phone_hash: phoneKey,
        code_hash: phoneHash(tenant.id, "code", `${token}:${code}`),
      })
      .execute();
  });
  try {
    if (!demo)
      await smsProvider().send({
        to: phone,
        text: t(tenant.locale, "phone_sms").replace("{code}", code),
      });
    await withTenant(db(), tenant.id, (tx) =>
      tx
        .updateTable("phone_challenge")
        .set({ delivered: true })
        .where("token_hash", "=", tokenHash)
        .execute(),
    );
  } catch {
    await withTenant(db(), tenant.id, (tx) =>
      tx.deleteFrom("phone_challenge").where("token_hash", "=", tokenHash).execute(),
    );
    return { error: t(tenant.locale, "phone_unavailable") };
  }
  return { token, message: t(tenant.locale, "phone_sent"), ...(demo ? { demoCode: code } : {}) };
}
