// Local app must use RATE_LIMIT_IP_HEADER=x-test-client-ip and the same test SESSION_SECRET.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DateTime } from "luxon";
import {
  appPool,
  availableSlots,
  consumePublicActionLimit,
  createDb,
  publicTenantBySlug,
  sql,
  withTenant,
  type PublicAction,
} from "@itckar/db";
import { publicActionKey, PUBLIC_ACTION_LIMITS } from "../src/lib/public-action-policy";
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3006";
const database = process.env.DATABASE_URL_TEST;
const secret = process.env.SESSION_SECRET;
if (
  !database ||
  !secret ||
  ![new URL(base).hostname, new URL(database).hostname].every((h) =>
    ["127.0.0.1", "localhost"].includes(h),
  )
)
  throw new Error("Explicit local test database, app and test secret are required");
const url = new URL(database);
url.username = "itckar_app";
url.password = "itckar_app";
const db = createDb(appPool(url.toString()));
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
try {
  const tenant = (await publicTenantBySlug(db, "salon-demo"))!;
  const run = <T,>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenant.id, fn);
  const keyHash = publicActionKey(secret, tenant.id, "client:192.0.2.123");
  const sharedKey = publicActionKey(secret, tenant.id, "tenant");
  await run((tx) =>
    tx.deleteFrom("public_action_limit").where("key_hash", "in", [keyHash, sharedKey]).execute(),
  );
  const exhaust = async (action: PublicAction, key = keyHash, shared = false) => {
    const p = PUBLIC_ACTION_LIMITS[action];
    await run((tx) =>
      tx
        .insertInto("public_action_limit")
        .values({
          tenant_id: tenant.id,
          action,
          key_hash: key,
          hits: (shared ? p.tenant : p.client) + 1,
          expires_at: sql`clock_timestamp() + interval '10 minutes'`,
        })
        .onConflict((oc) =>
          oc
            .columns(["tenant_id", "action", "key_hash"])
            .doUpdateSet({
              hits: (shared ? p.tenant : p.client) + 1,
              expires_at: sql`clock_timestamp() + interval '10 minutes'`,
            }),
        )
        .execute(),
    );
  };
  const expire = (action: PublicAction) =>
    run((tx) =>
      tx
        .updateTable("public_action_limit")
        .set({ expires_at: sql`clock_timestamp() - interval '1 second'` })
        .where("action", "=", action)
        .where("key_hash", "=", keyHash)
        .execute(),
    );
  const counter = (action: PublicAction) =>
    run((tx) =>
      tx
        .selectFrom("public_action_limit")
        .selectAll()
        .where("action", "=", action)
        .where("key_hash", "=", keyHash)
        .executeTakeFirstOrThrow(),
    );
  const service = await run((tx) =>
    tx
      .selectFrom("service")
      .select("id")
      .where("name", "=", "Dámsky strih")
      .executeTakeFirstOrThrow(),
  );
  const day = DateTime.now().setZone(tenant.timezone).plus({ weeks: 4 }).startOf("week");
  const slots = await run((tx) =>
    availableSlots(tx, tenant, {
      serviceIds: [service.id],
      fromMs: day.set({ hour: 10 }).toMillis(),
      toMs: day.set({ hour: 16 }).toMillis(),
      onlineOnly: true,
    }),
  );
  assert.ok(slots.length);
  const bookingUrl = `${base}/b/salon-demo?s=${service.id}&staff=&t=${slots[0]!.start}`;
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-test-client-ip": "192.0.2.123", "x-forwarded-for": "198.51.100.1" },
  });
  const page = await context.newPage();
  await exhaust("hold");
  const before = await counter("hold");
  await page.goto(bookingUrl);
  await page.getByRole("status").filter({ hasText: "Príliš veľa pokusov" }).waitFor();
  assert.equal(await page.locator('input[name="holdTicket"]').inputValue(), "");
  await context.setExtraHTTPHeaders({
    "x-test-client-ip": "192.0.2.123",
    "x-forwarded-for": "198.51.100.200",
  });
  await page.reload();
  await page.getByRole("status").filter({ hasText: "Príliš veľa pokusov" }).waitFor();
  assert.equal(
    (await counter("hold")).expires_at,
    before.expires_at,
    "denial does not extend the window; spoofed forwarding header does not bypass it",
  );
  await expire("hold");
  await page.getByRole("button", { name: "Znova overiť termín" }).click();
  await page.waitForFunction(() =>
    Boolean((document.querySelector('input[name="holdTicket"]') as HTMLInputElement)?.value),
  );
  const ticket = await page.locator('input[name="holdTicket"]').inputValue();
  const held = await counter("hold");
  await exhaust("hold", sharedKey, true);
  await page.reload();
  await page.waitForFunction(
    (value) =>
      (document.querySelector('input[name="holdTicket"]') as HTMLInputElement)?.value === value,
    ticket,
  );
  assert.equal(
    (await counter("hold")).hits,
    held.hits,
    "refresh reuses a valid hold without charging a new attempt",
  );
  await exhaust("book");
  await page.locator("#firstName").fill("Limit Test");
  await page.locator("#phone").fill("+421900123888");
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.getByText(/Príliš veľa pokusov/).waitFor();
  assert.equal(
    await page.locator("#firstName").inputValue(),
    "Limit Test",
    "rate-limit denial preserves entered details",
  );
  assert.equal(await page.locator('input[name="holdTicket"]').inputValue(), ticket);
  await expire("book");
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.waitForURL(/\/done\//);
  const token = page.url().split("/").at(-1)!;
  await exhaust("cancel");
  await page.goto(`${base}/r/${token}`);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Zrušiť rezerváciu" }).click();
  await page.getByText(/Príliš veľa pokusov/).waitFor();
  const readStatus = () =>
    run((tx) =>
      tx
        .selectFrom("appointment")
        .select("status")
        .where("public_token", "=", token)
        .executeTakeFirstOrThrow(),
    );
  assert.equal((await readStatus()).status, "confirmed");
  await expire("cancel");
  await page.getByRole("button", { name: "Zrušiť rezerváciu" }).click();
  await page.getByText("Zrušené", { exact: true }).waitFor();
  assert.equal((await readStatus()).status, "cancelled");
  await exhaust("hold", sharedKey, true);
  const beforeCount = await run((tx) =>
    tx
      .selectFrom("public_action_limit")
      .select(sql<number>`count(*)::int`.as("n"))
      .executeTakeFirstOrThrow(),
  );
  const freshClient = await browser.newPage({
    extraHTTPHeaders: { "x-test-client-ip": "192.0.2.200" },
  });
  await freshClient.goto(bookingUrl);
  await freshClient.getByRole("status").filter({ hasText: "Príliš veľa pokusov" }).waitFor();
  const noHeader = await browser.newPage({
    extraHTTPHeaders: { "x-forwarded-for": "203.0.113.50" },
  });
  await noHeader.goto(bookingUrl);
  await noHeader.getByRole("status").filter({ hasText: "Príliš veľa pokusov" }).waitFor();
  const count = await run((tx) =>
    tx
      .selectFrom("public_action_limit")
      .select(sql<number>`count(*)::int`.as("n"))
      .executeTakeFirstOrThrow(),
  );
  assert.equal(
    count.n,
    beforeCount.n,
    "exhausted shared ceiling prevents new client counter allocation",
  );
  console.log(
    "OK: hold denial, proxy-header spoof resistance, expiry recovery, refresh reuse, booking denial preserves details, cancellation protection, tenant fallback",
  );
} finally {
  await browser.close();
  await db.destroy();
}
