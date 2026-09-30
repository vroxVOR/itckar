// Requires PHONE_VERIFICATION_MODE=demo, a loopback APP_URL, and an isolated test DB.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { DateTime } from "luxon";
import { appPool, availableSlots, createDb, publicTenantBySlug, sql, withTenant } from "@itckar/db";
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3007";
const database = process.env.DATABASE_URL_TEST;
if (
  !database ||
  ![new URL(base).hostname, new URL(database).hostname].every((h) =>
    ["127.0.0.1", "localhost"].includes(h),
  )
)
  throw new Error("Explicit local app and test database required");
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
  await run(async (tx) => {
    await tx.deleteFrom("public_action_limit").execute();
    await tx.deleteFrom("phone_challenge").execute();
  });
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
  const bookingUrl = (start: number) => `${base}/b/salon-demo?s=${service.id}&staff=&t=${start}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const open = async (start: number) => {
    await page.goto(bookingUrl(start));
    await page.waitForFunction(() =>
      Boolean((document.querySelector('input[name="holdTicket"]') as HTMLInputElement)?.value),
    );
    await page.locator("#firstName").fill("Phone Test");
    await page.locator("#phone").fill("+421900123887");
  };
  await open(slots[0]!.start);
  const count = async () =>
    (
      await run((tx) =>
        tx
          .selectFrom("appointment")
          .select(sql<number>`count(*)::int`.as("n"))
          .executeTakeFirstOrThrow(),
      )
    ).n;
  const before = await count();
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.getByText(/Skontrolujte kód a telefón/).waitFor();
  assert.equal(await count(), before);
  await page.getByRole("button", { name: "Poslať SMS kód" }).click();
  const demo = page.getByTestId("demo-phone-code");
  await demo.waitFor();
  const code = (await demo.textContent())!.match(/\d{6}/)![0];
  const token = await page.locator('input[name="phoneToken"]').inputValue();
  assert.match(token, /^[a-f0-9]{48}$/);
  await page.getByRole("button", { name: "Poslať SMS kód" }).click();
  await page.getByText(/Príliš veľa pokusov/).waitFor();
  assert.equal(
    await page.locator('input[name="phoneToken"]').inputValue(),
    token,
    "failed resend retains usable code",
  );
  await page.locator("#phoneCode").fill(code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.getByText(/Skontrolujte kód a telefón/).waitFor();
  assert.equal(await count(), before);
  assert.equal(await page.locator("#firstName").inputValue(), "Phone Test");
  await page.locator("#phoneCode").fill(code);
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.waitForURL(/\/done\//);
  assert.equal(await count(), before + 1);
  assert.equal(
    (await run((tx) => tx.selectFrom("phone_challenge").selectAll().execute())).length,
    0,
  );
  const cookie = (await context.cookies()).find((c) => c.name.startsWith("phone_"));
  assert.ok(cookie?.httpOnly);
  assert.equal(cookie.sameSite, "Lax");
  const later = slots.find((s) => s.start >= slots[0]!.start + 3 * 3600000)!;
  assert.ok(later);
  await open(later.start);
  await page.getByRole("button", { name: "Poslať SMS kód" }).click();
  await page.getByText(/Telefón je v tomto prehliadači overený/).waitFor();
  assert.equal(await page.locator("#phoneCode").count(), 0);
  // A changed phone never inherits the remembered proof.
  await page.locator("#phone").fill("+421900123886");
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.getByText(/Skontrolujte kód a telefón/).waitFor();
  assert.equal(await count(), before + 1);
  await page.locator("#phone").fill("+421900123887");
  await page.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await page.waitForURL(/\/done\//);
  assert.equal(await count(), before + 2);
  console.log(
    "PASS: missing/wrong code blocked; resend limited without losing code; successful booking consumes proof; HttpOnly remembered phone; changed phone rejected; returning booking succeeds without SMS",
  );
} finally {
  await browser.close();
  await db.destroy();
}
