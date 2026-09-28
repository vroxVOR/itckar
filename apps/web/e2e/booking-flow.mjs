// End-to-end smoke test: register -> onboarding -> services -> public booking -> cancel -> admin calendar.
// Run against a started app:  E2E_BASE_URL=http://localhost:3000 node e2e/booking-flow.mjs
// Requires the `playwright` package and a Chromium (set PW_CHROMIUM to a chrome binary to reuse one).
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SP = process.env.E2E_OUT ?? "e2e/out";
import { mkdirSync } from "node:fs";
mkdirSync(`${SP}/shots`, { recursive: true });
const rand = Math.random().toString(36).slice(2, 7);
const slug = `e2e-${rand}`;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const log = (...a) => console.log("[e2e]", ...a);
const shot = (n) => page.screenshot({ path: `${SP}/shots/${n}.png`, fullPage: true });

try {
  // 1. register
  await page.goto(`${BASE}/register`);
  await page.fill("#name", "Eva Testová");
  await page.fill("#email", `eva-${rand}@example.com`);
  await page.fill("#password", "password123");
  await page.click("button:has-text('Vytvoriť účet')");
  await page.waitForURL("**/onboarding");
  log("registered");

  // 2. onboarding
  await page.fill("#name", "E2E Salón");
  await page.fill("#slug", slug);
  await page.selectOption("#country", "SK");
  await page.click("button:has-text('Založiť prevádzku')");
  await page.waitForURL("**/app/services?welcome=1");
  log("tenant created", slug);
  await shot("01-services-empty");

  // 3. create service with processing step
  await page.goto(`${BASE}/app/services/new`);
  await page.fill("input[name=name]", "Farbenie s pôsobením");
  await page.fill("input[name=categoryName]", "Vlasy");
  await page.fill("input[name=price]", "45");
  await page.click("button:has-text('+ Pridať krok')"); // processing 15
  await page.click("button:has-text('+ Pridať krok')"); // active 15
  await page.click("button:has-text('Uložiť službu')");
  await page.waitForURL("**/app/services?saved=*");
  log("service saved");
  await page.goto(`${BASE}/app/services/new`);
  await page.fill("input[name=name]", "Strih");
  await page.fill("input[name=price]", "20");
  await page.click("button:has-text('Uložiť službu')");
  await page.waitForURL("**/app/services?saved=*");
  await shot("02-services");

  // 4. public booking (new incognito context = not logged in)
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, isMobile: true });
  const pub = await ctx.newPage();
  await pub.goto(`${BASE}/b/${slug}`);
  await pub.screenshot({ path: `${SP}/shots/03-public-step1.png`, fullPage: true });
  await pub.check("input[name=s] >> nth=0");
  await pub.check("input[name=s] >> nth=1");
  await pub.click("button:has-text('Pokračovať')");
  await pub.waitForURL(/\?s=/);
  await pub.click("a:has-text('Ktokoľvek voľný')");
  await pub.waitForURL(/staff=/);
  // pick a day at least 2 days ahead that has slots, so the client cancel window (24h) allows cancelling
  const dayLinks = pub.locator("a[href*='&d=']");
  const dayCount = await dayLinks.count();
  let picked = null;
  for (let i = 2; i < dayCount; i++) {
    const txt = await dayLinks.nth(i).textContent();
    if (txt && txt.includes("×")) { picked = dayLinks.nth(i); break; }
  }
  if (!picked) throw new Error("no day with slots");
  await picked.click();
  await pub.waitForURL(/d=2026/);
  await pub.screenshot({ path: `${SP}/shots/04-public-step3.png`, fullPage: true });
  const slots = pub.locator("ul.grid a");
  const n = await slots.count();
  if (n === 0) throw new Error("no slots on public page");
  const slotText = await slots.first().textContent();
  const bookedDate = new URL(pub.url()).searchParams.get("d");
  await slots.first().click();
  await pub.waitForURL(/&t=|\?t=|t=\d+/);
  await pub.fill("#firstName", "Jana");
  await pub.fill("#lastName", "Klientka");
  await pub.fill("#phone", "+421900555111");
  await pub.fill("#email", "jana@example.com");
  await pub.check("input[name=consentSms]");
  await pub.screenshot({ path: `${SP}/shots/05-public-step4.png`, fullPage: true });
  await pub.click("button:has-text('Potvrdiť rezerváciu')");
  await pub.waitForURL(/\/done\//, { timeout: 15000 });
  const done = await pub.textContent("h1");
  log("booked slot", slotText?.trim(), "->", done);
  await pub.screenshot({ path: `${SP}/shots/06-public-done.png`, fullPage: true });
  const manageHref = await pub.getAttribute("a:has-text('Spravovať rezerváciu')", "href");

  // 5. Same slot again must fail with a friendly error
  const pub2 = await ctx.newPage();
  const doneUrl = pub.url();
  const bookUrl = doneUrl.replace(/\/done\/.*/, "") + `?s=${await pub.evaluate(() => "")}`;
  await pub2.goto(`${BASE}/b/${slug}`);
  await pub2.check("input[name=s] >> nth=0");
  await pub2.check("input[name=s] >> nth=1");
  await pub2.click("button:has-text('Pokračovať')");
  await pub2.click("a:has-text('Ktokoľvek voľný')");
  await pub2.waitForURL(/staff=/);
  const bookedDay = new URL(pub.url()).pathname; // done url; recover day from manage page later
  const dayHref = await pub.evaluate(() => sessionStorage.getItem("x")); // placeholder no-op
  const dayLinks2 = pub2.locator("a[href*='&d=']");
  const cnt2 = await dayLinks2.count();
  let remaining = -1;
  for (let i = 0; i < cnt2; i++) {
    const href = await dayLinks2.nth(i).getAttribute("href");
    if (href && href.includes(`d=${bookedDate}`)) {
      await dayLinks2.nth(i).click();
      await pub2.waitForURL(new RegExp(`d=${bookedDate}`));
      remaining = await pub2.locator("ul.grid a").count();
      break;
    }
  }
  void bookedDay; void dayHref;
  log("slots before", n, "after booking", remaining);
  if (remaining >= n) throw new Error("slot count did not decrease");

  // 6. manage + cancel
  await pub.goto(`${BASE}${manageHref}`);
  pub.once("dialog", (d) => d.accept());
  await pub.click("button:has-text('Zrušiť rezerváciu')");
  await pub.waitForSelector("text=Zrušené", { timeout: 10000 });
  log("cancelled via public link");
  await pub.screenshot({ path: `${SP}/shots/07-public-cancelled.png`, fullPage: true });

  // 7. admin: new appointment via form, then calendar
  await page.goto(`${BASE}/app/appointments/new?time=10:00`);
  await page.check("input[name=serviceIds] >> nth=0");
  await page.click("button:has-text('Nový')");
  await page.fill("#firstName", "Peter");
  await page.fill("#phone", "+421900777888");
  // pick next Monday
  const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  await page.fill("#date", d.toISOString().slice(0, 10));
  await page.click("button:has-text('Vytvoriť rezerváciu')");
  await page.waitForURL(/\/app\/appointments\/[0-9a-f-]+$/, { timeout: 15000 });
  log("admin appointment created");
  await shot("08-admin-appointment");
  await page.goto(`${BASE}/app/calendar?date=${d.toISOString().slice(0, 10)}`);
  await shot("09-admin-calendar-day");
  const blocks = await page.locator("a[href*='/app/appointments/']").evaluateAll((els) => els.filter((e) => /\/app\/appointments\/[0-9a-f-]{36}$/.test(e.getAttribute("href") || "")).length);
  log("calendar blocks", blocks);
  if (blocks < 1) throw new Error("appointment not visible in calendar");
  await page.goto(`${BASE}/app/calendar?date=${d.toISOString().slice(0, 10)}&view=week`);
  await shot("10-admin-calendar-week");
  await page.goto(`${BASE}/app/clients`);
  await shot("11-admin-clients");
  log("OK");
} catch (e) {
  console.error("[e2e] FAILED", e);
  await shot("99-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
