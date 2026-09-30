import { beforeAll, afterAll, expect, it } from "vitest";
import { setupTestDatabase } from "./test-utils";
import { withTenant, withoutTenant, sql, type Db } from "./db";
import { seedDemoSalon } from "./seed";
import { verifyPhoneChallenge, consumePhoneChallenge } from "./phone-verification";
let db: Db, close: () => Promise<void>, tenantId: string, otherId: string;
const phoneHash = "a".repeat(64),
  codeHash = "b".repeat(64);
beforeAll(async () => {
  const env = await setupTestDatabase();
  db = env.app;
  close = env.close;
  tenantId = (await seedDemoSalon(db)).tenantId;
  otherId = (
    await seedDemoSalon(db, { slug: "other-phone", ownerEmail: "other-phone@example.test" })
  ).tenantId;
});
afterAll(async () => close());
const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenantId, fn);
async function create(tokenHash: string, delivered = true) {
  await run((tx) =>
    tx
      .insertInto("phone_challenge")
      .values({
        tenant_id: tenantId,
        token_hash: tokenHash,
        phone_hash: phoneHash,
        code_hash: codeHash,
        delivered,
      })
      .execute(),
  );
}
const verify = (tokenHash: string, code = codeHash, phone = phoneHash) =>
  run((tx) => verifyPhoneChallenge(tx, { tokenHash, codeHash: code, phoneHash: phone }));
it("rejects unverified, undelivered and wrong-phone proofs", async () => {
  const token = "1".repeat(64);
  await create(token, false);
  expect(await verify(token)).toBe(false);
  expect(await run((tx) => consumePhoneChallenge(tx, token, phoneHash))).toBe(false);
  await run((tx) => tx.updateTable("phone_challenge").set({ delivered: true }).execute());
  expect(await verify(token, codeHash, "c".repeat(64))).toBe(false);
  expect(await verify(token, "c".repeat(64))).toBe(false);
  expect(await run((tx) => consumePhoneChallenge(tx, token, phoneHash))).toBe(false);
  expect(await verify(token)).toBe(true);
});
it("caps concurrent guesses at five and does not refund failed guesses", async () => {
  const token = "2".repeat(64);
  await create(token);
  const results = await Promise.all(
    Array.from({ length: 12 }, () => verify(token, "c".repeat(64))),
  );
  expect(results.every((x) => !x)).toBe(true);
  expect(await verify(token)).toBe(false);
  const row = await run((tx) =>
    tx
      .selectFrom("phone_challenge")
      .select("attempts")
      .where("token_hash", "=", token)
      .executeTakeFirstOrThrow(),
  );
  expect(row.attempts).toBe(5);
});
it("consumes a verified proof only once under concurrency", async () => {
  const token = "3".repeat(64);
  await create(token);
  expect(await verify(token)).toBe(true);
  const results = await Promise.all(
    Array.from({ length: 8 }, () => run((tx) => consumePhoneChallenge(tx, token, phoneHash))),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await verify(token)).toBe(false);
});
it("rolls back consumption with failed booking, but expires using database time", async () => {
  const token = "4".repeat(64);
  await create(token);
  await verify(token);
  await expect(
    run(async (tx) => {
      expect(await consumePhoneChallenge(tx, token, phoneHash)).toBe(true);
      throw new Error("conflict");
    }),
  ).rejects.toThrow("conflict");
  expect(await verify(token)).toBe(true);
  await run((tx) =>
    tx
      .updateTable("phone_challenge")
      .set({ expires_at: sql`clock_timestamp() - interval '1 second'` })
      .where("token_hash", "=", token)
      .execute(),
  );
  expect(await verify(token)).toBe(false);
  expect(await run((tx) => consumePhoneChallenge(tx, token, phoneHash))).toBe(false);
});
it("isolates tenants and hides proofs without tenant context", async () => {
  const token = "5".repeat(64);
  await create(token);
  expect(
    await withTenant(db, otherId, (tx) =>
      verifyPhoneChallenge(tx, { tokenHash: token, phoneHash, codeHash }),
    ),
  ).toBe(false);
  expect(
    await withoutTenant(db, (tx) => tx.selectFrom("phone_challenge").selectAll().execute()),
  ).toEqual([]);
  await expect(
    withTenant(db, otherId, (tx) =>
      tx
        .insertInto("phone_challenge")
        .values({
          tenant_id: tenantId,
          token_hash: "6".repeat(64),
          phone_hash: phoneHash,
          code_hash: codeHash,
        })
        .execute(),
    ),
  ).rejects.toThrow(/row-level security/);
});
