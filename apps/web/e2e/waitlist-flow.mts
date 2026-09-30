// Seeded, disposable LOCAL database + local app only. Providers below never send externally.
// E2E_BASE_URL=http://127.0.0.1:3006 DATABASE_URL_TEST=postgres://... node --import tsx e2e/waitlist-flow.mts
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DateTime } from "luxon";
import {
  addWaitlistEntry,
  availableSlots,
  appPool,
  cancelAppointment,
  createAppointment,
  createDb,
  publicTenantBySlug,
  withTenant,
  type Job,
} from "@itckar/db";
import { handleJob, type HandlerContext } from "../src/worker/handlers";
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3006";
const database = process.env.DATABASE_URL_TEST;
if (
  !database ||
  ![new URL(base).hostname, new URL(database).hostname].every((h) =>
    ["localhost", "127.0.0.1"].includes(h),
  )
)
  throw new Error("Use an explicit disposable local database and local app.");
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
  const fixtures = await run(async (tx) => ({
    service: await tx
      .selectFrom("service")
      .select("id")
      .where("name", "=", "Dámsky strih")
      .executeTakeFirstOrThrow(),
    staff: await tx
      .selectFrom("resource")
      .select("id")
      .where("name", "=", "Anna")
      .executeTakeFirstOrThrow(),
    owner: await tx
      .selectFrom("membership")
      .select("user_id")
      .where("tenant_id", "=", tenant.id)
      .where("role", "=", "owner")
      .executeTakeFirstOrThrow(),
    client: await tx
      .insertInto("client")
      .values({
        tenant_id: tenant.id,
        first_name: "Čakateľ E2E",
        email: `waitlist-${Date.now()}@example.test`,
        phone: `+421${String(Date.now()).slice(-9)}`,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  }));
  const day = DateTime.now().setZone(tenant.timezone).plus({ weeks: 6 }).startOf("week");
  const slots = await run((tx) =>
    availableSlots(tx, tenant, {
      serviceIds: [fixtures.service.id],
      fromMs: day.set({ hour: 10 }).toMillis(),
      toMs: day.set({ hour: 16 }).toMillis(),
      pin: { staff: fixtures.staff.id },
      onlineOnly: true,
    }),
  );
  assert.ok(slots.length, "test day needs a free slot");
  const start = slots[0]!.start;
  const original = await run((tx) =>
    createAppointment(tx, tenant, {
      serviceIds: [fixtures.service.id],
      startMs: start,
      pin: { staff: fixtures.staff.id },
      client: { firstName: "Original E2E" },
      source: "admin",
    }),
  );
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill("demo@itckar.local");
  await page.locator('input[name="password"]').fill("demo1234");
  await page.getByRole("button", { name: /Prihlásiť/ }).click();
  await page.waitForURL(/\/app/);
  await page.goto(`${base}/app/waitlist`);
  if (!(await page.locator('input[name="from"]').isVisible()))
    await page.locator("summary").click();
  await page.locator('select[name="clientId"]').selectOption(fixtures.client.id);
  await page.locator(`input[name="serviceIds"][value="${fixtures.service.id}"]`).check();
  await page.locator('select[name="staffId"]').selectOption(fixtures.staff.id);
  await page.locator('input[name="from"]').fill(day.toISODate()!);
  await page.locator('input[name="until"]').fill(day.toISODate()!);
  await page.locator('input[name="requested"]').check();
  await page.getByRole("button", { name: "Pridať čakateľa" }).click();
  await page.getByRole("status").filter({ hasText: "pridaný" }).waitFor();
  const entry = await run((tx) =>
    tx
      .selectFrom("waitlist_entry")
      .selectAll()
      .where("client_id", "=", fixtures.client.id)
      .executeTakeFirstOrThrow(),
  );
  // Second request tests the SMS channel and public withdrawal. This fixture uses a narrower period.
  const smsEntry = await run((tx) =>
    addWaitlistEntry(tx, tenant, {
      clientId: fixtures.client.id,
      serviceIds: [fixtures.service.id],
      staffId: fixtures.staff.id,
      fromMs: start,
      untilMs: start + 3600000,
      channel: "sms",
      actorId: fixtures.owner.user_id,
      requested: true,
    }),
  );
  await page.goto(`${base}/app/appointments/${original.id}`);
  await page.getByRole("button", { name: "Zrušiť rezerváciu", exact: true }).click();
  await page.waitForURL(/\/app\/calendar/);
  const sent: { channel: string; text: string }[] = [];
  let fail = true;
  const ctx: HandlerContext = {
    db,
    appUrl: base,
    email: {
      name: "test",
      async send(message) {
        if (fail) {
          fail = false;
          throw new Error("Simulated temporary provider failure");
        }
        sent.push({ channel: "email", text: message.text });
        return { providerMessageId: "test-email" };
      },
    },
    sms: {
      name: "test",
      async send(message) {
        sent.push({ channel: "sms", text: message.text });
        return { providerMessageId: "test-sms" };
      },
    },
  };
  const match = await run((tx) =>
    tx
      .selectFrom("job")
      .selectAll()
      .where("dedupe_key", "=", `waitlist-match:${original.id}`)
      .executeTakeFirstOrThrow(),
  );
  await handleJob(ctx, match);
  const notify = async (id: string) =>
    run((tx) =>
      tx
        .selectFrom("job")
        .selectAll()
        .where("dedupe_key", "=", `waitlist-notify:${id}:1`)
        .executeTakeFirstOrThrow(),
    );
  const emailJob = await notify(entry.id);
  await assert.rejects(handleJob(ctx, emailJob), /Simulated/);
  await handleJob(ctx, emailJob);
  await handleJob(ctx, emailJob);
  await handleJob(ctx, await notify(smsEntry.id));
  assert.equal(sent.length, 2, "one successful message per entry, including replay after success");
  assert.ok(sent.every((m) => m.text.includes("Ponuka nie je rezervácia")));
  const customer = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await customer.goto(`${base}/w/salon-demo/${entry.public_token}`);
  if (process.env.E2E_SCREENSHOT_DIR) {
    await mkdir(process.env.E2E_SCREENSHOT_DIR, { recursive: true });
    await customer.screenshot({
      path: `${process.env.E2E_SCREENSHOT_DIR}/waitlist-offer-mobile.png`,
      fullPage: true,
    });
  }
  await customer.getByRole("link", { name: "Overiť a rezervovať termín" }).click();
  await customer.getByRole("button", { name: "Potvrdiť rezerváciu" }).waitFor();
  await customer.waitForFunction(() =>
    Boolean((document.querySelector('input[name="holdTicket"]') as HTMLInputElement)?.value),
  );
  await customer.locator("#firstName").fill(fixtures.client.first_name);
  await customer.locator("#phone").fill(fixtures.client.phone!);
  await customer.locator("#email").fill(fixtures.client.email!);
  // Local server must explicitly use PHONE_VERIFICATION_MODE=demo.
  await customer.getByRole("button", { name: "Poslať SMS kód" }).click();
  await customer.getByTestId("demo-phone-code").waitFor();
  const smsCode = (await customer.getByTestId("demo-phone-code").textContent())!.match(/\d{6}/)![0]!;
  await customer.locator("#phoneCode").fill(smsCode);
  await customer.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await customer.waitForURL(/\/done\//);
  const booked = await run((tx) =>
    tx
      .selectFrom("waitlist_entry")
      .selectAll()
      .where("id", "=", entry.id)
      .executeTakeFirstOrThrow(),
  );
  assert.equal(booked.status, "booked");
  assert.ok(booked.booked_appointment_id);
  await customer.goto(`${base}/w/salon-demo/${smsEntry.public_token}`);
  await customer.getByRole("button", { name: "Ukončiť čakanie" }).click();
  await customer.getByRole("status").filter({ hasText: "ukončené" }).waitFor();
  await page.goto(`${base}/app/waitlist?view=all`);
  if (process.env.E2E_SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOT_DIR}/waitlist-admin.png`,
      fullPage: true,
    });
  console.log(
    "OK: admin request, cancellation match, failed provider retry, replay dedupe, email and SMS templates, mobile offer, booking consumes entry, public withdrawal",
  );
} finally {
  await browser.close();
  await db.destroy();
}
