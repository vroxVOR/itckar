import { beforeAll, afterAll, expect, it } from "vitest";
import { DateTime } from "luxon";
import { setupTestDatabase } from "./test-utils";
import { withTenant, withoutTenant, type Db } from "./db";
import { seedDemoSalon, type SeedResult } from "./seed";
import { publicTenantBySlug } from "./auth";
import { cancelAppointment, createAppointment } from "./booking";
import {
  addWaitlistEntry,
  closeWaitlistEntry,
  completeWaitlistEntry,
  matchWaitlist,
  prepareWaitlistNotification,
} from "./waitlist";
import type { Tenant } from "./schema";

let db: Db, close: () => Promise<void>, seed: SeedResult, tenant: Tenant;
const day = DateTime.now().setZone("Europe/Prague").plus({ weeks: 2 }).startOf("week");
const at = (days: number) => day.plus({ days }).set({ hour: 10 }).toMillis();
beforeAll(async () => {
  const env = await setupTestDatabase();
  db = env.app;
  close = env.close;
  seed = await seedDemoSalon(db);
  tenant = (await publicTenantBySlug(db, "salon-demo"))!;
});
afterAll(async () => close());
const run = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, tenant.id, fn);
let clientNumber = 0;
async function client() {
  clientNumber++;
  return run((tx) =>
    tx
      .insertInto("client")
      .values({
        tenant_id: tenant.id,
        first_name: "Waiting",
        email: `waiting${clientNumber}@example.test`,
        phone: `+421900${String(clientNumber).padStart(6, "0")}`,
      })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
}
async function add(start: number, changes: Partial<Parameters<typeof addWaitlistEntry>[2]> = {}) {
  const c = await client();
  return run((tx) =>
    addWaitlistEntry(tx, tenant, {
      clientId: c.id,
      serviceIds: [seed.services.haircut],
      staffId: seed.resources.anna,
      fromMs: start,
      untilMs: start + 3600000,
      channel: "email",
      actorId: seed.ownerId,
      requested: true,
      ...changes,
    }),
  );
}
const book = (start: number) =>
  run((tx) =>
    createAppointment(tx, tenant, {
      serviceIds: [seed.services.haircut],
      startMs: start,
      pin: { staff: seed.resources.anna, chair: seed.resources.chair1 },
      client: { firstName: "Original" },
      source: "admin",
    }),
  );
const cancel = (id: string) =>
  run((tx) =>
    cancelAppointment(tx, tenant, { appointmentId: id, by: "user", actorId: seed.ownerId }),
  );
const read = (id: string) =>
  run((tx) =>
    tx.selectFrom("waitlist_entry").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
  );

it("validates requested contact, online services, staff and duplicates", async () => {
  const e = await add(at(0));
  await expect(
    run((tx) =>
      addWaitlistEntry(tx, tenant, {
        clientId: e.client_id,
        serviceIds: e.service_ids,
        staffId: e.staff_id!,
        fromMs: at(0),
        untilMs: at(0) + 3600000,
        channel: "email",
        actorId: seed.ownerId,
        requested: true,
      }),
    ),
  ).rejects.toMatchObject({ code: "duplicate" });
  await expect(add(at(0), { requested: false })).rejects.toMatchObject({ code: "invalid" });
  await expect(add(at(0), { staffId: seed.resources.room1 })).rejects.toMatchObject({
    code: "invalid",
  });
  await expect(add(at(0), { serviceIds: [crypto.randomUUID()] })).rejects.toMatchObject({
    code: "invalid",
  });
  const missing = await run((tx) =>
    tx
      .insertInto("client")
      .values({ tenant_id: tenant.id, first_name: "No contact" })
      .returning("id")
      .executeTakeFirstOrThrow(),
  );
  await expect(add(at(0), { clientId: missing.id })).rejects.toMatchObject({ code: "contact" });
  await run((tx) => closeWaitlistEntry(tx, { id: e.id }));
});

it("queues matching independently of cancellation delivery and offers only once under concurrent jobs", async () => {
  const a = await book(at(1));
  const e = await add(at(1));
  await cancel(a.id);
  const jobs = await run((tx) =>
    tx.selectFrom("job").select("kind").where("dedupe_key", "like", `%${a.id}%`).execute(),
  );
  expect(jobs.map((j) => j.kind)).toContain("waitlist.match");
  const matches = await Promise.all(
    [1, 2].map(() => run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }))),
  );
  expect(matches.reduce((a, b) => a + b, 0)).toBe(1);
  const offered = await read(e.id);
  expect(offered.status).toBe("offered");
  expect(Date.parse(offered.offered_start_at!)).toBe(at(1));
  const ready = await run((tx) =>
    prepareWaitlistNotification(tx, tenant, e.id, offered.offer_version),
  );
  expect(ready?.notification.recipient).toMatch(/^waiting\d+@example.test$/);
  expect(ready?.services).toEqual(["Dámsky strih"]);
});

it("skips requests outside the period, for unavailable staff, or too long for the freed window", async () => {
  const a = await book(at(2));
  const outside = await add(at(2) + 7200000);
  const staff = await add(at(2), { staffId: seed.resources.bob });
  const long = await add(at(2), { serviceIds: [seed.services.massage] });
  await cancel(a.id);
  expect(await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }))).toBe(0);
  for (const e of [outside, staff, long]) expect((await read(e.id)).status).toBe("waiting");
});

it("rechecks availability before sending and can make a fresh offer after a later cancellation", async () => {
  const a = await book(at(3));
  const e = await add(at(3));
  await cancel(a.id);
  await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }));
  const before = await read(e.id);
  const other = await book(at(3));
  expect(
    await run((tx) => prepareWaitlistNotification(tx, tenant, e.id, before.offer_version)),
  ).toBeNull();
  expect((await read(e.id)).status).toBe("waiting");
  const n = await run((tx) =>
    tx
      .selectFrom("notification")
      .select("status")
      .where("id", "=", before.notification_id!)
      .executeTakeFirstOrThrow(),
  );
  expect(n.status).toBe("skipped");
  await cancel(other.id);
  await run((tx) => matchWaitlist(tx, tenant, { appointmentId: other.id }));
  expect((await read(e.id)).offer_version).toBe(before.offer_version + 1);
  expect(
    await run((tx) => prepareWaitlistNotification(tx, tenant, e.id, before.offer_version)),
  ).toBeNull();
});

it("supports withdrawal and consumes only the exact offered selection after successful booking", async () => {
  const a = await book(at(4));
  const first = await add(at(4));
  const second = await add(at(4));
  await cancel(a.id);
  await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }));
  await run((tx) => closeWaitlistEntry(tx, { token: first.public_token }));
  expect(await run((tx) => prepareWaitlistNotification(tx, tenant, first.id, 1))).toBeNull();
  const b = await book(at(4));
  const params = {
    token: second.public_token,
    serviceIds: second.service_ids,
    startMs: at(4),
    appointmentId: b.id,
    staffId: seed.resources.anna,
  };
  await run((tx) => completeWaitlistEntry(tx, { ...params, startMs: at(4) + 60000 }));
  expect((await read(second.id)).status).toBe("offered");
  await run((tx) => completeWaitlistEntry(tx, params));
  expect((await read(second.id)).status).toBe("booked");
  expect((await read(second.id)).booked_appointment_id).toBe(b.id);
});

it("continues beyond the first matching batch", async () => {
  const a = await book(at(7));
  for (let i = 0; i < 27; i++) await add(at(7));
  await cancel(a.id);
  expect(await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }))).toBe(25);
  const continuation = await run((tx) =>
    tx
      .selectFrom("job")
      .select("payload")
      .where("dedupe_key", "like", `waitlist-match:${a.id}:%`)
      .executeTakeFirstOrThrow(),
  );
  const payload = continuation.payload as { appointmentId: string; afterId: string };
  expect(await run((tx) => matchWaitlist(tx, tenant, payload))).toBe(2);
});

it("isolates tenant requests and rejects foreign client references", async () => {
  const other = await seedDemoSalon(db, {
    slug: "other-waitlist",
    ownerEmail: "other-waitlist@example.test",
  });
  const otherTenant = (await publicTenantBySlug(db, "other-waitlist"))!;
  const e = await add(at(8));
  expect(
    await withTenant(db, other.tenantId, (tx) =>
      tx.selectFrom("waitlist_entry").selectAll().execute(),
    ),
  ).toEqual([]);
  expect(
    await withoutTenant(db, (tx) => tx.selectFrom("waitlist_entry").selectAll().execute()),
  ).toEqual([]);
  await withTenant(db, other.tenantId, (tx) => closeWaitlistEntry(tx, { token: e.public_token }));
  expect((await read(e.id)).status).toBe("waiting");
  await expect(
    withTenant(db, other.tenantId, (tx) =>
      addWaitlistEntry(tx, otherTenant, {
        clientId: e.client_id,
        serviceIds: [other.services.haircut],
        fromMs: at(8),
        untilMs: at(8) + 3600000,
        channel: "email",
        actorId: other.ownerId,
        requested: true,
      }),
    ),
  ).rejects.toMatchObject({ code: "not_found" });
});

it("skips a withdrawn required resource without poisoning matching or notification retries", async () => {
  const a = await run((tx) =>
    createAppointment(tx, tenant, {
      serviceIds: [seed.services.colour],
      startMs: at(9),
      pin: { staff: seed.resources.anna },
      client: { firstName: "Original" },
      source: "admin",
    }),
  );
  const e = await add(at(9), { serviceIds: [seed.services.massage], untilMs: at(9) + 2 * 3600000 });
  await cancel(a.id);
  expect(await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }))).toBe(1);
  await run((tx) =>
    tx
      .updateTable("resource")
      .set({ active: false })
      .where("id", "=", seed.resources.room1)
      .execute(),
  );
  try {
    expect(await run((tx) => prepareWaitlistNotification(tx, tenant, e.id, 1))).toBeNull();
    expect((await read(e.id)).status).toBe("waiting");
    expect(await run((tx) => matchWaitlist(tx, tenant, { appointmentId: a.id }))).toBe(0);
  } finally {
    await run((tx) =>
      tx
        .updateTable("resource")
        .set({ active: true })
        .where("id", "=", seed.resources.room1)
        .execute(),
    );
  }
});
