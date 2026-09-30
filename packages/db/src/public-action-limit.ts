import { sql, type Tx } from "./db";

export type PublicAction = "hold" | "book" | "cancel";
export type LimitResult = { allowed: boolean; retryAfterSeconds: number };

/** Atomic across app replicas. Call in a separate committed transaction before business writes. */
export async function consumePublicActionLimit(
  tx: Tx,
  q: {
    tenantId: string;
    action: PublicAction;
    keyHash: string;
    limit: number;
    windowSeconds: number;
  },
): Promise<LimitResult> {
  if (
    !/^[a-f0-9]{64}$/.test(q.keyHash) ||
    !Number.isInteger(q.limit) ||
    q.limit < 1 ||
    q.limit > 100000 ||
    !Number.isInteger(q.windowSeconds) ||
    q.windowSeconds < 1 ||
    q.windowSeconds > 86400
  )
    throw new Error("Invalid public action limit");
  const result = await sql<{ hits: number; retry_after: number }>`
    insert into public_action_limit (tenant_id, action, key_hash, hits, expires_at)
    values (${q.tenantId}::uuid, ${q.action}, ${q.keyHash}, 1, clock_timestamp() + ${q.windowSeconds} * interval '1 second')
    on conflict (tenant_id, action, key_hash) do update set
      hits = case when public_action_limit.expires_at <= excluded.expires_at - ${q.windowSeconds} * interval '1 second' then 1
                  else least(public_action_limit.hits + 1, ${q.limit + 1}) end,
      expires_at = case when public_action_limit.expires_at <= excluded.expires_at - ${q.windowSeconds} * interval '1 second'
                        then excluded.expires_at
                        else public_action_limit.expires_at end
    returning hits, greatest(1, ceil(extract(epoch from expires_at - clock_timestamp())))::int as retry_after
  `.execute(tx);
  const row = result.rows[0]!;
  return {
    allowed: row.hits <= q.limit,
    retryAfterSeconds: row.hits <= q.limit ? 0 : row.retry_after,
  };
}
