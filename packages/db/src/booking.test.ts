import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { sql } from "kysely";
import { setupTestDatabase } from "./test-utils";
import type { Db } from "./db";
import { withTenant, withoutTenant } from "./db";
import { seedDemoSalon, type SeedResult } from "./seed";
import {
  availableSlots,
  BookingError,
  cancelAppointment,
  createAppointment,
  holdSlot,
  rescheduleAppointment,
  setAppointmentStatus,
} from "./booking";
import { createTenantWithOwner, registerUser, publicTenantBySlug } from "./auth";
import type { Tenant } from "./schema";

const ZONE = "Europe/Prague";
const t = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const NOW = t("2026-03-23T08:00"); // Monday

let app: Db;
let close: () => Promise<void>;
let seed: SeedResult;
let tenant: Tenant;

beforeAll(async () => {
  const env = await setupTestDatabase();
  app = env.app;
  close = env.close;
  seed = await seedDemoSalon(app);
  tenant = (await publicTenantBySlug(app, "salon-demo"))!;
});
afterAll(async () => close());

const clientAnna = { firstName: "Jana", lastName: "Nováková", phone: "+421900111222", email: "jana@example.com" };

describe("availability", () => {
  it("lists haircut slots for Monday using the tenant grid and notice", async () => {
    const slots = await withTenant(app, tenant.id, (tx) =>
      availableSlots(tx, tenant, { serviceIds: [seed.services.haircut], fromMs: t("2026-03-23T00:00"), toMs: t("2026-03-24T00:00"), nowMs: NOW }),
    );
    const starts = slots.map((s) => DateTime.fromMillis(s.start, { zone: ZONE }).toFormat("HH:mm"));
    expect(starts[0]!).toBe("09:00");
    expect(starts.at(-1)!).toBe("19:15"); // Boris until 20:00, 45 min cut
    expect(starts).toContain("16:30"); // Anna cannot (ends 17:15) but Boris can
  });

  it("colour exposes the processing gap for another client", async () => {
    const start = t("2026-03-23T09:00");
    await withTenant(app, tenant.id, (tx) =>
      createAppointment(tx, tenant, {
        serviceIds: [seed.services.colour],
        startMs: start,
        pin: { staff: seed.resources.anna, chair: seed.resources.chair1 },
        client: clientAnna,
        source: "online",
        nowMs: NOW,
      }),
    );
    const slots = await withTenant(app, tenant.id, (tx) =>
      availableSlots(tx, tenant, {
        serviceIds: [seed.services.mensCut],
        fromMs: t("2026-03-23T09:00"),
        toMs: t("2026-03-23T11:00"),
        pin: { staff: seed.resources.anna },
        nowMs: NOW,
      }),
    );
    const starts = slots.map((s) => DateTime.fromMillis(s.start, { zone: ZONE }).toFormat("HH:mm"));
    expect(starts).toEqual(["09:30", "09:45", "10:45"]); // gap 09:30-10:15 fits a 30 min cut twice; then after 10:45
    expect(slots[0]!.assignments.find((a) => a.key === "chair")!.resourceId).toBe(seed.resources.chair2);
  });
});

describe("createAppointment", () => {
  it("persists items, segments and merged resource blocks and schedules notifications", async () => {
    const start = t("2026-03-24T10:00");
    const created = await withTenant(app, tenant.id, (tx) =>
      createAppointment(tx, tenant, {
        serviceIds: [seed.services.massage],
        startMs: start,
        client: { firstName: "Peter", phone: "+421900333444", marketingSmsConsent: true },
        source: "online",
        nowMs: NOW,
      }),
    );
    expect(created.endMs - created.startMs).toBe(60 * 60_000);
    const rows = await withTenant(app, tenant.id, async (tx) => ({
      items: await tx.selectFrom("appointment_item").selectAll().where("appointment_id", "=", created.id).execute(),
      segments: await tx.selectFrom("appointment_segment").selectAll().where("appointment_id", "=", created.id).execute(),
      blocks: await tx.selectFrom("resource_block").selectAll().where("appointment_id", "=", created.id).execute(),
      consents: await tx.selectFrom("consent").selectAll().where("client_id", "=", created.clientId).execute(),
      jobs: await tx.selectFrom("job").selectAll().where("dedupe_key", "like", `%${created.id}%`).execute(),
    }));
    expect(rows.items).toHaveLength(1);
    expect(rows.items[0]!.service_name).toBe("Klasická masáž 60 min");
    expect(rows.segments).toHaveLength(1);
    expect(rows.blocks).toHaveLength(2); // anna + room1
    // buffer after 15 min is part of the block, not of the appointment
    const annaBlock = rows.blocks.find((b) => b.resource_id === seed.resources.anna)!;
    expect(annaBlock.during).toContain("10:15:00"); // 09:00Z..10:15Z (UTC)
    expect(rows.consents.map((c) => c.kind)).toEqual(["marketing_sms"]);
    expect(rows.jobs.map((j) => j.kind).sort()).toEqual(["appointment.confirmation", "appointment.reminder"]);
  });

  it("rejects the same slot twice with a friendly reason, and the DB constraint blocks races", async () => {
    const start = t("2026-03-25T10:00");
    const book = () =>
      withTenant(app, tenant.id, (tx) =>
        createAppointment(tx, tenant, {
          serviceIds: [seed.services.haircut],
          startMs: start,
          assignments: [
            { cartIndex: 0, key: "staff", resourceId: seed.resources.anna },
            { cartIndex: 0, key: "chair", resourceId: seed.resources.chair1 },
          ],
          client: { firstName: `Race`, phone: `+42190055${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}` },
          source: "online",
          nowMs: NOW,
        }),
      );
    const results = await Promise.allSettled(Array.from({ length: 8 }, book));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(7);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(BookingError);
      expect(["conflict", "slot_busy"]).toContain((f.reason as BookingError).code);
    }
    await expect(book()).rejects.toMatchObject({ code: "slot_busy" });
    const count = await withTenant(app, tenant.id, (tx) =>
      tx
        .selectFrom("resource_block")
        .select(sql<number>`count(*)::int`.as("n"))
        .where("resource_id", "=", seed.resources.anna)
        .where(sql<boolean>`during && tstzrange(${new Date(start).toISOString()}, ${new Date(start + 45 * 60_000).toISOString()})`)
        .where("blocking", "=", true)
        .executeTakeFirstOrThrow(),
    );
    expect(count.n).toBe(1);
  });

  it("enforces notice, advance window and opening hours for online bookings but not for admins", async () => {
    const base = { serviceIds: [seed.services.haircut], client: clientAnna };
    const now = t("2026-03-26T08:45");
    await expect(
      withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-03-26T09:15"), source: "online" })),
    ).rejects.toMatchObject({ code: "too_soon" });
    await expect(
      withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-07-01T10:00"), source: "online" })),
    ).rejects.toMatchObject({ code: "too_far" });
    await expect(
      withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-03-29T10:00"), source: "online" })),
    ).rejects.toMatchObject({ code: "slot_unavailable" }); // Sunday
    const created = await withTenant(app, tenant.id, (tx) =>
      createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-03-26T09:15"), source: "admin", createdBy: seed.ownerId }),
    );
    expect(created.slot.assignments[0]!.resourceId).toBe(seed.resources.anna);
    await expect(
      withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-03-27T07:00"), source: "admin" })),
    ).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(
      withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...base, nowMs: now, startMs: t("2026-03-26T07:00"), source: "admin" })),
    ).rejects.toMatchObject({ code: "too_soon" }); // in the past
  });
});

describe("cancel, status, holds", () => {
  it("cancelling frees the slot, cancels reminders and respects the client cancel window", async () => {
    const start = t("2026-03-27T10:00");
    const created = await withTenant(app, tenant.id, (tx) =>
      createAppointment(tx, tenant, { serviceIds: [seed.services.haircut], startMs: start, pin: { staff: seed.resources.anna }, client: clientAnna, source: "online", nowMs: NOW }),
    );
    // client too late (default cancel_until_min = 1440)
    await expect(
      withTenant(app, tenant.id, (tx) => cancelAppointment(tx, tenant, { appointmentId: created.id, by: "client", nowMs: start - 60 * 60_000 })),
    ).rejects.toMatchObject({ code: "cancel_window_passed" });
    await withTenant(app, tenant.id, (tx) => cancelAppointment(tx, tenant, { appointmentId: created.id, by: "client", nowMs: NOW, reason: "chorá" }));
    const after = await withTenant(app, tenant.id, async (tx) => ({
      appt: await tx.selectFrom("appointment").select(["status", "cancel_reason"]).where("id", "=", created.id).executeTakeFirstOrThrow(),
      blocking: await tx.selectFrom("resource_block").select("blocking").where("appointment_id", "=", created.id).execute(),
      jobs: await tx.selectFrom("job").select(["kind", "status"]).where("dedupe_key", "like", `%${created.id}%`).execute(),
    }));
    expect(after.appt).toEqual({ status: "cancelled", cancel_reason: "chorá" });
    expect(after.blocking.every((b) => !b.blocking)).toBe(true);
    expect(after.jobs.find((j) => j.kind === "appointment.reminder")!.status).toBe("cancelled");
    expect(after.jobs.find((j) => j.kind === "appointment.cancelled")).toBeTruthy();
    // slot is bookable again
    const again = await withTenant(app, tenant.id, (tx) =>
      createAppointment(tx, tenant, { serviceIds: [seed.services.haircut], startMs: start, pin: { staff: seed.resources.anna }, client: clientAnna, source: "online", nowMs: NOW }),
    );
    expect(again.id).not.toBe(created.id);
    await withTenant(app, tenant.id, (tx) => setAppointmentStatus(tx, { appointmentId: again.id, status: "no_show" }));
    const client = await withTenant(app, tenant.id, (tx) => tx.selectFrom("client").select("no_show_count").where("id", "=", again.clientId).executeTakeFirstOrThrow());
    expect(client.no_show_count).toBe(1);
  });

  it("a hold blocks others until it expires or is consumed by the booking", async () => {
    // Holds expire against the database clock, so this test uses real time: next Monday 10:00.
    const start = DateTime.now().setZone(ZONE).plus({ weeks: 1 }).startOf("week").set({ hour: 10 }).toMillis();
    const hold = await withTenant(app, tenant.id, (tx) =>
      holdSlot(tx, tenant, { serviceIds: [seed.services.haircut], startMs: start, pin: { staff: seed.resources.anna, chair: seed.resources.chair1 } }),
    );
    const other = { serviceIds: [seed.services.haircut], startMs: start, assignments: hold.slot.assignments, client: { firstName: "X", phone: "+421900999999" }, source: "online" as const };
    await expect(withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, other))).rejects.toMatchObject({ code: "slot_busy" });
    const mine = await withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...other, client: clientAnna, holdToken: hold.token }));
    expect(mine.startMs).toBe(start);
    await expect(withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...other, holdToken: hold.token }))).rejects.toMatchObject({ code: "hold_expired" });

    // expired hold is ignored and purged
    const start2 = start + 86_400_000; // Tuesday
    const hold2 = await withTenant(app, tenant.id, (tx) =>
      holdSlot(tx, tenant, { serviceIds: [seed.services.haircut], startMs: start2, nowMs: Date.now() - 60 * 60_000, ttlMin: 5 }),
    );
    expect(hold2.expiresAt.getTime()).toBeLessThan(Date.now());
    await expect(withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, {
      ...other, startMs: start2, assignments: hold2.slot.assignments, holdToken: hold2.token,
    }))).rejects.toMatchObject({ code: "hold_expired" });
    const ok = await withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, { ...other, startMs: start2, assignments: hold2.slot.assignments }));
    expect(ok.startMs).toBe(start2);
  });
  it("only consumes a hold once under concurrent submissions", async () => {
    const start = DateTime.now().setZone(ZONE).plus({ weeks: 2 }).startOf("week").set({ hour: 10 }).toMillis();
    const hold = await withTenant(app, tenant.id, (tx) => holdSlot(tx, tenant, {
      serviceIds: [seed.services.haircut], startMs: start,
    }));
    const input = { serviceIds: [seed.services.haircut], startMs: start, assignments: hold.slot.assignments,
      holdToken: hold.token, client: clientAnna, source: "online" as const };
    const results = await Promise.allSettled([1, 2].map(() => withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, input))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "hold_expired" });
  });

});

describe("row level security", () => {
  it("isolates tenants and hides everything without a tenant context", async () => {
    const other = await registerUser(app, { email: "other@itckar.local", password: "password1", name: "Other" });
    const otherTenant = await createTenantWithOwner(app, { slug: "other-salon", name: "Other" }, other.id);
    const seenFromOther = await withTenant(app, otherTenant, (tx) => tx.selectFrom("appointment").selectAll().execute());
    expect(seenFromOther).toEqual([]);
    const seenWithout = await withoutTenant(app, (tx) => tx.selectFrom("appointment").selectAll().execute());
    expect(seenWithout).toEqual([]);
    const mine = await withTenant(app, tenant.id, (tx) => tx.selectFrom("appointment").selectAll().execute());
    expect(mine.length).toBeGreaterThan(0);
    // writing a foreign tenant_id is rejected by the policy
    await expect(
      withTenant(app, otherTenant, (tx) => tx.insertInto("service_category").values({ tenant_id: tenant.id, name: "x" }).execute()),
    ).rejects.toThrow(/row-level security/);
  });
});


describe("rescheduling", () => {
  const book = (date: string) => withTenant(app, tenant.id, (tx) => createAppointment(tx, tenant, {
    serviceIds: [seed.services.colour], startMs: t(date), nowMs: NOW, source: "admin",
    pin: { staff: seed.resources.anna, chair: seed.resources.chair1 }, client: clientAnna,
    notes: "Keep this note", createdBy: seed.ownerId,
  }));
  const snapshot = (id: string) => withTenant(app, tenant.id, async (tx) => ({
    appointment: await tx.selectFrom("appointment").selectAll().where("id", "=", id).executeTakeFirstOrThrow(),
    items: await tx.selectFrom("appointment_item").selectAll().where("appointment_id", "=", id).orderBy("position").execute(),
    segments: await tx.selectFrom("appointment_segment").selectAll().where("appointment_id", "=", id).orderBy("position").execute(),
    blocks: await tx.selectFrom("resource_block").selectAll().where("appointment_id", "=", id).orderBy("id").execute(),
    jobs: await tx.selectFrom("job").selectAll().where("dedupe_key", "like", `%${id}%`).orderBy("id").execute(),
  }));
  const move = (id: string, old: number, next: number) => withTenant(app, tenant.id, (tx) => rescheduleAppointment(tx, tenant, {
    appointmentId: id, expectedStartMs: old, startMs: next, actorId: seed.ownerId, nowMs: NOW,
  }));

  it("preserves the saved services, prices, resources and gaps; replaces reminders and frees the original slot", async () => {
    const a = await book("2026-04-06T10:00");
    const before = await snapshot(a.id);
    const next = t("2026-04-07T11:00");
    await move(a.id, a.startMs, next);
    const after = await snapshot(a.id);
    expect(after.items).toEqual(before.items);
    expect(after.appointment.public_token).toBe(before.appointment.public_token);
    expect(after.appointment.notes).toBe("Keep this note");
    expect(Date.parse(after.appointment.start_at)).toBe(next);
    expect(Date.parse(after.appointment.end_at) - next).toBe(a.endMs - a.startMs);
    after.segments.forEach((seg, i) => {
      expect(seg.resource_ids).toEqual(before.segments[i]!.resource_ids);
      expect(seg.kind).toBe(before.segments[i]!.kind);
      expect(Date.parse(seg.start_at) - Date.parse(before.segments[i]!.start_at)).toBe(next - a.startMs);
    });
    expect(after.jobs.filter((j) => j.kind === "appointment.reminder" && j.status === "pending").map((j) => Date.parse(j.run_at))).toEqual([next - 24 * 3600000]);
    expect(after.jobs.find((j) => j.kind === "appointment.rescheduled")?.status).toBe("pending");
    expect(after.jobs.find((j) => j.kind === "appointment.confirmation")?.status).toBe("cancelled");
    await book("2026-04-06T10:00");
    // Moving back and then forward generates fresh jobs even when an old job used that same time.
    await move(a.id, next, next + 15 * 60000);
    await move(a.id, next + 15 * 60000, next);
    const again = await snapshot(a.id);
    expect(again.jobs.filter((j) => j.kind === "appointment.reminder" && j.status === "pending")).toHaveLength(1);
  });

  it("rejects busy, closed and stale targets without changing the appointment, blocks or jobs", async () => {
    const a = await book("2026-04-08T10:00");
    await book("2026-04-09T10:00");
    const before = await snapshot(a.id);
    await expect(move(a.id, a.startMs, t("2026-04-09T10:00"))).rejects.toMatchObject({ code: "slot_busy" });
    await expect(move(a.id, a.startMs, t("2026-04-12T10:00"))).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(move(a.id, a.startMs - 60000, t("2026-04-10T10:00"))).rejects.toMatchObject({ code: "stale_appointment" });
    expect(await snapshot(a.id)).toEqual(before);
    await withTenant(app, tenant.id, (tx) => cancelAppointment(tx, tenant, { appointmentId: a.id, by: "user", nowMs: NOW }));
    await expect(move(a.id, a.startMs, t("2026-04-10T10:00"))).rejects.toMatchObject({ code: "not_reschedulable" });
  });

  it("serializes two edits to the same appointment and permits only one competing move", async () => {
    const a = await book("2026-04-13T10:00");
    const results = await Promise.allSettled([
      move(a.id, a.startMs, t("2026-04-14T10:00")),
      move(a.id, a.startMs, t("2026-04-15T10:00")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "stale_appointment" });
    const b = await book("2026-04-16T10:00");
    const c = await book("2026-04-17T10:00");
    const raced = await Promise.allSettled([move(b.id, b.startMs, t("2026-04-20T10:00")), move(c.id, c.startMs, t("2026-04-20T10:00"))]);
    expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(["slot_busy", "conflict"]).toContain(((raced.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as BookingError).code);
  });

  it("does not allow a different tenant to move the appointment", async () => {
    const a = await book("2026-04-21T10:00");
    const other = (await publicTenantBySlug(app, "other-salon"))!;
    await expect(withTenant(app, other.id, (tx) => rescheduleAppointment(tx, other, {
      appointmentId: a.id, startMs: t("2026-04-22T10:00"), expectedStartMs: a.startMs, actorId: seed.ownerId, nowMs: NOW,
    }))).rejects.toMatchObject({ code: "not_found" });
  });
});
