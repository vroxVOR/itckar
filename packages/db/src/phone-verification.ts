import { sql, type Tx } from "./db";

/** Commit separately: a failed booking must not refund a code guess. */
export async function verifyPhoneChallenge(
  tx: Tx,
  q: { tokenHash: string; phoneHash: string; codeHash: string },
): Promise<boolean> {
  const row = await tx
    .updateTable("phone_challenge")
    .set({ attempts: sql`attempts + 1`, verified: sql`code_hash = ${q.codeHash}` })
    .where("token_hash", "=", q.tokenHash)
    .where("phone_hash", "=", q.phoneHash)
    .where("delivered", "=", true)
    .where("attempts", "<", 5)
    .where("expires_at", ">", sql<string>`clock_timestamp()`)
    .returning("verified")
    .executeTakeFirst();
  return row?.verified === true;
}

/** Delete within the booking transaction: only one booking can consume this proof. */
export async function consumePhoneChallenge(
  tx: Tx,
  tokenHash: string,
  phoneHash: string,
): Promise<boolean> {
  const row = await tx
    .deleteFrom("phone_challenge")
    .where("token_hash", "=", tokenHash)
    .where("phone_hash", "=", phoneHash)
    .where("verified", "=", true)
    .where("delivered", "=", true)
    .where("expires_at", ">", sql<string>`clock_timestamp()`)
    .returning("token_hash")
    .executeTakeFirst();
  return Boolean(row);
}
