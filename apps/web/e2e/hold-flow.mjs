// Run against a seeded, disposable LOCAL database and running app.
// E2E_BASE_URL=http://127.0.0.1:3006 DATABASE_URL_TEST=postgres://... node e2e/hold-flow.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import pg from "pg";
const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3006";
const database = process.env.DATABASE_URL_TEST;
if (!database || ![new URL(base).hostname, new URL(database).hostname].every((h) => ["localhost", "127.0.0.1"].includes(h))) {
  throw new Error("Hold expiry test requires an explicitly configured local test database and local app.");
}
const pool = new pg.Pool({ connectionString: database });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ticketOf = (page) => page.locator('input[name="holdTicket"]').inputValue();
async function waitForHold(page, old = "") {
  await page.waitForFunction((previous) => {
    const input = document.querySelector('input[name="holdTicket"]');
    return input?.value && input.value !== previous;
  }, old);
  return ticketOf(page);
}
try {
  const first = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await first.goto(`${base}/b/salon-demo`);
  await first.locator('input[name="s"]').first().check();
  await first.getByRole("button", { name: "Pokračovať" }).click();
  await first.locator('a[href*="staff="]').nth(1).click(); // explicit staff, not anyone
  const days = first.locator("a.booking-day");
  for (let i = 2; i < await days.count(); i++) {
    if ((await days.nth(i).textContent()).includes("×")) { await days.nth(i).click(); break; }
  }
  await first.locator("a.booking-slot").first().click();
  const original = await waitForHold(first);
  const url = first.url();
  await first.reload();
  assert.equal(await waitForHold(first), original, "refresh must reuse the existing hold, not extend it");
  const second = await browser.newPage();
  await second.goto(url);
  await second.getByRole("status").filter({ hasText: /obsaden|dispozícii/ }).waitFor();
  assert.equal(await second.getByRole("button", { name: "Potvrdiť rezerváciu" }).isDisabled(), true);
  await first.getByRole("link", { name: /Späť/ }).click();
  await first.waitForURL((u) => !u.searchParams.has("t"));
  await second.getByRole("button", { name: "Znova overiť termín" }).click();
  const held = await waitForHold(second);
  await second.fill("#firstName", "Hold Test");
  await second.fill("#phone", "+421900123777");
  // Advance the browser countdown and expire the matching database hold.
  const payload = JSON.parse(Buffer.from(held.split(".")[0], "base64url").toString());
  await pool.query("UPDATE resource_block SET expires_at = now() - interval '1 second' WHERE hold_token = $1", [payload.holdToken]);
  await second.clock.install();
  await second.clock.fastForward(301000);
  await second.getByRole("status").filter({ hasText: "vypršalo" }).waitFor();
  assert.equal(await second.getByRole("button", { name: "Potvrdiť rezerváciu" }).isDisabled(), true);
  await second.getByRole("button", { name: "Znova overiť termín" }).click();
  const renewed = await waitForHold(second, held);
  assert.equal(await second.locator("#firstName").inputValue(), "Hold Test", "renewal preserves entered details");
  // Server-time offset allows this even though the browser clock is now five minutes ahead.
  // Local server must explicitly use PHONE_VERIFICATION_MODE=demo.
  await second.getByRole("button", { name: "Poslať SMS kód" }).click();
  await second.getByTestId("demo-phone-code").waitFor();
  const smsCode = (await second.getByTestId("demo-phone-code").textContent()).match(/\d{6}/)[0];
  await second.locator("#phoneCode").fill(smsCode);
  await second.getByRole("button", { name: "Potvrdiť rezerváciu" }).click();
  await second.waitForURL(/\/done\//);
  const renewedPayload = JSON.parse(Buffer.from(renewed.split(".")[0], "base64url").toString());
  const result = await pool.query("SELECT count(*)::int AS n FROM resource_block WHERE hold_token = $1", [renewedPayload.holdToken]);
  assert.equal(result.rows[0].n, 0, "booking consumes the hold");
  console.log("OK: refresh reuse, competing client blocked, back releases, expiry, renewal preserves details, server-clock alignment, confirmation consumes hold");
} finally { await browser.close(); await pool.end(); }
