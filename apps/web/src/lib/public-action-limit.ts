import "server-only";
import { headers } from "next/headers";
import { consumePublicActionLimit, sql, withTenant, type PublicAction } from "@itckar/db";
import { db } from "./db";
import {
  canonicalClientAddress,
  publicActionKey,
  PUBLIC_ACTION_LIMITS,
} from "./public-action-policy";
import { t } from "./i18n";

export async function checkPublicActionLimit(
  tenantId: string,
  action: PublicAction,
): Promise<number> {
  const policy = PUBLIC_ACTION_LIMITS[action];
  const secret = process.env.SESSION_SECRET ?? "";
  const header = process.env.RATE_LIMIT_IP_HEADER?.trim().toLowerCase();
  if (header && !/^[a-z0-9-]+$/.test(header)) throw new Error("Invalid RATE_LIMIT_IP_HEADER");
  // Without a trusted proxy configuration, use only the tenant-wide ceiling.
  const address = header ? canonicalClientAddress((await headers()).get(header)) : null;
  const tenantKey = publicActionKey(secret, tenantId, "tenant");
  return withTenant(db(), tenantId, async (tx) => {
    // Once the shared ceiling is reached, do not allocate new per-address rows.
    const blocked = await sql<{
      retry_after: number;
    }>`select greatest(1, ceil(extract(epoch from expires_at - clock_timestamp())))::int as retry_after
      from public_action_limit where tenant_id = ${tenantId}::uuid and action = ${action} and key_hash = ${tenantKey}
      and hits > ${policy.tenant} and expires_at > clock_timestamp()`.execute(tx);
    if (blocked.rows[0]) return blocked.rows[0].retry_after;
    if (address) {
      const client = await consumePublicActionLimit(tx, {
        tenantId,
        action,
        keyHash: publicActionKey(secret, tenantId, `client:${address}`),
        limit: policy.client,
        windowSeconds: policy.seconds,
      });
      // A blocked client does not spend the shared allowance of everyone else.
      if (!client.allowed) return client.retryAfterSeconds;
    }
    const tenant = await consumePublicActionLimit(tx, {
      tenantId,
      action,
      keyHash: tenantKey,
      limit: policy.tenant,
      windowSeconds: policy.seconds,
    });
    // Bounded, tenant-scoped housekeeping; expired counters are also reusable without cleanup.
    await tx
      .deleteFrom("public_action_limit")
      .where("tenant_id", "=", tenantId)
      .where("expires_at", "<", sql<string>`clock_timestamp() - interval '1 day'`)
      .where(
        "key_hash",
        "in",
        tx
          .selectFrom("public_action_limit")
          .select("key_hash")
          .where("expires_at", "<", sql<string>`clock_timestamp() - interval '1 day'`)
          .limit(100),
      )
      .execute();
    return tenant.allowed ? 0 : tenant.retryAfterSeconds;
  });
}

export function publicLimitMessage(locale: string, retryAfterSeconds: number): string {
  return t(locale, "err_rate_limit").replace("{seconds}", String(retryAfterSeconds));
}
