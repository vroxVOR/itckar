import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@itckar/shared";

export function bookingPhone(raw: string, country: string): string | null {
  return normalizePhone(
    raw,
    ["CZ", "SK", "PL", "DE", "AT"].includes(country)
      ? (country as Parameters<typeof normalizePhone>[1])
      : "SK",
  );
}
export function phoneHash(
  tenantId: string,
  kind: "phone" | "token" | "code",
  value: string,
): string {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 16) throw new Error("SESSION_SECRET is required");
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "phone-verification:v1",
        tenantId,
        kind,
        kind === "code" && phoneDemoMode(),
        value,
      ]),
    )
    .digest("hex");
}
/** Explicit local-only simulation; cannot be enabled for a public APP_URL. */
export function phoneDemoMode(): boolean {
  if (process.env.PHONE_VERIFICATION_MODE !== "demo") return false;
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.APP_URL ?? "").hostname,
    );
  } catch {
    return false;
  }
}

/** A returning browser proves possession with a signed, expiring HttpOnly cookie. */
export function rememberedPhone(tenantId: string, phoneKey: string, now = Date.now()): string {
  const body = `${phoneKey}.${now + 30 * 86400000}`;
  return `${body}.${phoneHash(tenantId, "token", `remember:${phoneDemoMode()}:${body}`)}`;
}
export function hasRememberedPhone(
  tenantId: string,
  phoneKey: string,
  raw: string | undefined,
  now = Date.now(),
): boolean {
  if (!raw || raw.length > 200) return false;
  const [key, expires, signature, extra] = raw.split(".");
  if (
    extra !== undefined ||
    key !== phoneKey ||
    !expires ||
    !/^\d+$/.test(expires) ||
    Number(expires) <= now ||
    Number(expires) > now + 30 * 86400000
  )
    return false;
  const expected = phoneHash(tenantId, "token", `remember:${phoneDemoMode()}:${key}.${expires}`);
  return Boolean(
    signature &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
  );
}
