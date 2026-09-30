import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { PublicAction } from "@itckar/db";

export const PUBLIC_ACTION_LIMITS: Record<
  PublicAction,
  { client: number; tenant: number; seconds: number }
> = {
  sms: { client: 5, tenant: 60, seconds: 900 },
  hold: { client: 12, tenant: 300, seconds: 300 },
  book: { client: 8, tenant: 120, seconds: 600 },
  cancel: { client: 20, tenant: 120, seconds: 600 },
};

/** Only a single address supplied by a configured, trusted proxy. Never interpret forwarding chains. */
export function canonicalClientAddress(value: string | null): string | null {
  if (!value || value.length > 64 || value.includes("%")) return null;
  const ip = value.trim();
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return null;
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16),
      low = parseInt(mapped[2]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  const [left, right] = normalized.split("::");
  const first = left ? left.split(":") : [];
  const last = right ? right.split(":") : [];
  const parts = normalized.includes("::")
    ? [...first, ...Array(8 - first.length - last.length).fill("0"), ...last]
    : first;
  // IPv6 privacy addresses in the same /64 share a bucket.
  return (
    parts
      .slice(0, 4)
      .map((p: string) => p.padStart(4, "0"))
      .join(":") + "::/64"
  );
}

export function publicActionKey(secret: string, tenantId: string, subject: string): string {
  if (secret.length < 16)
    throw new Error("SESSION_SECRET must be configured for public action limits");
  return createHmac("sha256", secret)
    .update(JSON.stringify(["public-action:v1", tenantId, subject]))
    .digest("hex");
}
