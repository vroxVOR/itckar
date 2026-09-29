import { beforeEach, expect, it, vi } from "vitest";
import type { Db, Job } from "@itckar/db";
import { handleJob } from "./handlers";

vi.mock("@itckar/db", () => ({ withTenant: async (_db: unknown, _id: string, fn: (tx: unknown) => unknown) => fn(_db) }));
const start = Date.now() + 72 * 3600000;
const send = vi.fn(async (_message: unknown) => ({ providerMessageId: "test" }));
const rows: Record<string, unknown> = {
  appointment: { id: "appointment", tenant_id: "tenant", status: "confirmed", client_id: "client", start_at: new Date(start).toISOString(), public_token: "public" },
  tenant: { id: "tenant", name: "Salon", timezone: "Europe/Prague", locale: "sk" },
  client: { id: "client", first_name: "Test", email: "test@example.test", phone: null, locale: "sk" },
  appointment_item: [{ service_name: "Strih" }], appointment_segment: [], location: {},
};
const db = {
  selectFrom(table: string) {
    const query = { selectAll: () => query, select: () => query, where: () => query, orderBy: () => query,
      executeTakeFirst: async () => rows[table], executeTakeFirstOrThrow: async () => rows[table], execute: async () => rows[table] };
    return query;
  },
  insertInto: () => ({ values: () => ({ execute: async () => [] }) }),
} as unknown as Db;
const ctx = { db, appUrl: "http://localhost:3000", email: { name: "test", send }, sms: { name: "test", send } };
const job = (kind: string, startMs: number) => ({ kind, tenant_id: "tenant", payload: { appointmentId: "appointment", startMs } }) as Job;
beforeEach(() => send.mockClear());
it("sends the changed time for the current reschedule job", async () => {
  await handleJob(ctx, job("appointment.rescheduled", start));
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]).toEqual([expect.objectContaining({ subject: "Zmena termínu – Salon", text: expect.stringContaining("nový termín rezervácie") })]);
});
it("skips reschedule messages and reminders for an obsolete start time", async () => {
  await handleJob(ctx, job("appointment.rescheduled", start - 3600000));
  await handleJob(ctx, job("appointment.reminder", start - 3600000));
  expect(send).not.toHaveBeenCalled();
});
