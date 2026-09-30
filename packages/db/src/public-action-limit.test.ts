import { beforeAll, afterAll, expect, it } from "vitest";
import { setupTestDatabase } from "./test-utils";
import { withTenant, withoutTenant, sql, type Db } from "./db";
import { seedDemoSalon } from "./seed";
import { consumePublicActionLimit } from "./public-action-limit";
let db: Db, close: () => Promise<void>, tenantId: string, otherId: string;
const keyHash = "a".repeat(64);
beforeAll(async () => {
  const env = await setupTestDatabase();
  db = env.app;
  close = env.close;
  tenantId = (await seedDemoSalon(db)).tenantId;
  otherId = (
    await seedDemoSalon(db, { slug: "other-limits", ownerEmail: "other-limits@example.test" })
  ).tenantId;
});
afterAll(async () => close());
const consume = (
  action: "hold" | "book" | "cancel",
  limit: number,
  hash = keyHash,
  tenant = tenantId,
) =>
  withTenant(db, tenant, (tx) =>
    consumePublicActionLimit(tx, {
      tenantId: tenant,
      action,
      keyHash: hash,
      limit,
      windowSeconds: 300,
    }),
  );
const read = (action: "hold" | "book" | "cancel") =>
  withTenant(db, tenantId, (tx) =>
    tx
      .selectFrom("public_action_limit")
      .selectAll()
      .where("action", "=", action)
      .where("key_hash", "=", keyHash)
      .executeTakeFirstOrThrow(),
  );

it("blocks excess requests without extending the window or increasing counters indefinitely", async () => {
  expect((await consume("hold", 2)).allowed).toBe(true);
  expect((await consume("hold", 2)).allowed).toBe(true);
  const before = await read("hold");
  for (let i = 0; i < 3; i++) {
    const denied = await consume("hold", 2);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(300);
  }
  const after = await read("hold");
  expect(after.expires_at).toBe(before.expires_at);
  expect(after.hits).toBe(3);
});
it("allows exactly the quota under concurrent requests from multiple transactions", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => consume("book", 5)));
  expect(results.filter((r) => r.allowed)).toHaveLength(5);
  expect((await read("book")).hits).toBe(6);
});
it("resets an expired window using the database clock", async () => {
  await withTenant(db, tenantId, (tx) =>
    tx
      .updateTable("public_action_limit")
      .set({ expires_at: sql`clock_timestamp() - interval '1 second'` })
      .where("action", "=", "hold")
      .execute(),
  );
  expect(await consume("hold", 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  expect((await read("hold")).hits).toBe(1);
});
it("separates action, client and tenant budgets, and hides counters without tenant context", async () => {
  expect((await consume("cancel", 1)).allowed).toBe(true);
  expect((await consume("cancel", 1)).allowed).toBe(false);
  expect((await consume("cancel", 1, "b".repeat(64))).allowed).toBe(true);
  expect((await consume("cancel", 1, keyHash, otherId)).allowed).toBe(true);
  expect(
    await withoutTenant(db, (tx) => tx.selectFrom("public_action_limit").selectAll().execute()),
  ).toEqual([]);
  await expect(
    withTenant(db, otherId, (tx) =>
      consumePublicActionLimit(tx, {
        tenantId,
        action: "hold",
        keyHash,
        limit: 2,
        windowSeconds: 300,
      }),
    ),
  ).rejects.toThrow(/row-level security/);
});
it("retains the attempt if the later booking transaction fails", async () => {
  const hash = "c".repeat(64);
  expect((await consume("book", 1, hash)).allowed).toBe(true);
  await expect(
    withTenant(db, tenantId, async () => {
      throw new Error("booking failed");
    }),
  ).rejects.toThrow("booking failed");
  expect((await consume("book", 1, hash)).allowed).toBe(false);
});
