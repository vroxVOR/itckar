import { SchedulingError } from "@itckar/scheduling";
import { type Tx } from "./db";
import type { Tenant, WaitlistEntry } from "./schema";
import { availableSlots, BookingError, loadServices } from "./booking";
import { cancelJobsByPrefix, enqueueJob } from "./jobs";

export class WaitlistError extends Error {
  constructor(public readonly code: "invalid" | "contact" | "duplicate" | "not_found") {
    super(code);
  }
}

export async function addWaitlistEntry(
  tx: Tx,
  tenant: Tenant,
  q: {
    clientId: string;
    serviceIds: string[];
    staffId?: string;
    fromMs: number;
    untilMs: number;
    channel: "email" | "sms";
    actorId: string;
    requested: boolean;
    nowMs?: number;
  },
): Promise<WaitlistEntry> {
  const now = q.nowMs ?? Date.now();
  if (
    !q.requested ||
    !q.serviceIds.length ||
    q.serviceIds.length > 6 ||
    new Set(q.serviceIds).size !== q.serviceIds.length ||
    !Number.isFinite(q.fromMs) ||
    !Number.isFinite(q.untilMs) ||
    q.untilMs <= Math.max(q.fromMs, now) ||
    q.untilMs - q.fromMs > 366 * 86400000 ||
    q.untilMs > now + (tenant.max_advance_days + 1) * 86400000
  )
    throw new WaitlistError("invalid");
  const client = await tx
    .selectFrom("client")
    .selectAll()
    .where("id", "=", q.clientId)
    .executeTakeFirst();
  if (!client) throw new WaitlistError("not_found");
  if (q.channel === "email" ? !client.email : !client.phone) throw new WaitlistError("contact");
  const services = await loadServices(tx, q.serviceIds);
  if (services.length !== q.serviceIds.length || services.some((s) => !s.bookableOnline))
    throw new WaitlistError("invalid");
  if (q.staffId) {
    const staff = await tx
      .selectFrom("resource")
      .select("id")
      .where("id", "=", q.staffId)
      .where("kind", "=", "staff")
      .where("active", "=", true)
      .where("bookable_online", "=", true)
      .executeTakeFirst();
    if (
      !staff ||
      services.some(
        (s) => !s.requirements.some((r) => r.key === "staff" && r.candidates.includes(q.staffId!)),
      )
    )
      throw new WaitlistError("invalid");
  }
  try {
    return await tx
      .insertInto("waitlist_entry")
      .values({
        tenant_id: tenant.id,
        client_id: q.clientId,
        service_ids: q.serviceIds,
        staff_id: q.staffId ?? null,
        from_at: new Date(q.fromMs),
        until_at: new Date(q.untilMs),
        channel: q.channel,
        created_by: q.actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new WaitlistError("duplicate");
    throw e;
  }
}

export async function closeWaitlistEntry(
  tx: Tx,
  selector: { id: string } | { token: string },
): Promise<void> {
  const entry = await tx
    .selectFrom("waitlist_entry")
    .selectAll()
    .where(
      "id" in selector ? "id" : "public_token",
      "=",
      "id" in selector ? selector.id : selector.token,
    )
    .forUpdate()
    .executeTakeFirst();
  if (!entry || entry.status === "booked" || entry.status === "closed") return;
  await tx
    .updateTable("waitlist_entry")
    .set({ status: "closed" })
    .where("id", "=", entry.id)
    .execute();
  await cancelJobsByPrefix(tx, `waitlist-notify:${entry.id}:`);
  if (entry.notification_id)
    await tx
      .updateTable("notification")
      .set({ status: "skipped" })
      .where("id", "=", entry.notification_id)
      .where("status", "in", ["queued", "failed"])
      .execute();
}

/** Batches are bounded; a continuation job scans the remaining entries exactly once. */
export async function matchWaitlist(
  tx: Tx,
  tenant: Tenant,
  q: { appointmentId: string; afterId?: string; nowMs?: number },
): Promise<number> {
  const a = await tx
    .selectFrom("appointment")
    .selectAll()
    .where("id", "=", q.appointmentId)
    .executeTakeFirst();
  const now = q.nowMs ?? Date.now();
  if (!a || a.status !== "cancelled" || Date.parse(a.end_at) <= now) return 0;
  const freed = await tx
    .selectFrom("resource_block")
    .select("resource_id")
    .where("appointment_id", "=", a.id)
    .execute();
  const resourceIds = new Set(freed.map((b) => b.resource_id));
  if (!resourceIds.size) return 0;
  let query = tx
    .selectFrom("waitlist_entry")
    .selectAll()
    .where("status", "=", "waiting")
    .where("from_at", "<", a.end_at)
    .where("until_at", ">", a.start_at);
  if (q.afterId) query = query.where("id", ">", q.afterId);
  const entries = await query.orderBy("id").limit(25).forUpdate().execute();
  let offered = 0;
  for (const entry of entries) {
    const from = Math.max(Date.parse(a.start_at), Date.parse(entry.from_at), now);
    const to = Math.min(Date.parse(a.end_at), Date.parse(entry.until_at));
    const services = await loadServices(tx, entry.service_ids);
    if (services.length !== entry.service_ids.length || services.some((s) => !s.bookableOnline))
      continue;
    let slots;
    try {
      slots = await availableSlots(tx, tenant, {
        serviceIds: entry.service_ids,
        fromMs: from,
        toMs: to,
        nowMs: now,
        onlineOnly: true,
        ...(entry.staff_id ? { pin: { staff: entry.staff_id } } : {}),
      });
    } catch (e) {
      if (e instanceof BookingError || e instanceof SchedulingError) continue;
      throw e;
    }
    // Retain the requested staff even if service capabilities were edited since registration.
    const slot = slots.find(
      (s) =>
        s.end <= to &&
        s.assignments.some((r) => resourceIds.has(r.resourceId)) &&
        (!entry.staff_id ||
          (s.assignments.filter((r) => r.key === "staff").length === entry.service_ids.length &&
            s.assignments
              .filter((r) => r.key === "staff")
              .every((r) => r.resourceId === entry.staff_id))),
    );
    if (!slot) continue;
    const client = await tx
      .selectFrom("client")
      .select(["email", "phone"])
      .where("id", "=", entry.client_id)
      .executeTakeFirst();
    const recipient = entry.channel === "email" ? client?.email : client?.phone;
    if (!recipient) continue;
    const n = await tx
      .insertInto("notification")
      .values({
        tenant_id: tenant.id,
        client_id: entry.client_id,
        channel: entry.channel,
        template: "waitlist",
        recipient,
        status: "queued",
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const version = entry.offer_version + 1;
    await tx
      .updateTable("waitlist_entry")
      .set({
        status: "offered",
        offered_start_at: new Date(slot.start),
        offered_end_at: new Date(slot.end),
        offer_version: version,
        notification_id: n.id,
      })
      .where("id", "=", entry.id)
      .execute();
    await enqueueJob(tx, {
      tenantId: tenant.id,
      kind: "waitlist.notify",
      payload: { entryId: entry.id, version },
      dedupeKey: `waitlist-notify:${entry.id}:${version}`,
    });
    offered++;
  }
  if (entries.length === 25) {
    const last = entries.at(-1)!.id;
    await enqueueJob(tx, {
      tenantId: tenant.id,
      kind: "waitlist.match",
      payload: { appointmentId: a.id, afterId: last },
      dedupeKey: `waitlist-match:${a.id}:${last}`,
    });
  }
  return offered;
}

/** The notification is an invitation only. Recheck availability immediately before sending. */
export async function prepareWaitlistNotification(
  tx: Tx,
  tenant: Tenant,
  id: string,
  version: number,
) {
  const entry = await tx
    .selectFrom("waitlist_entry")
    .selectAll()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (
    !entry ||
    entry.status !== "offered" ||
    entry.offer_version !== version ||
    !entry.offered_start_at ||
    !entry.notification_id
  )
    return null;
  const n = await tx
    .selectFrom("notification")
    .selectAll()
    .where("id", "=", entry.notification_id)
    .executeTakeFirst();
  if (!n || n.status === "sent" || n.status === "skipped") return null;
  const services = await loadServices(tx, entry.service_ids);
  let available = false;
  if (services.length === entry.service_ids.length && services.every((s) => s.bookableOnline)) {
    const start = Date.parse(entry.offered_start_at);
    const slots = await availableSlots(tx, tenant, {
      serviceIds: entry.service_ids,
      fromMs: start,
      toMs: start + 1,
      onlineOnly: true,
      ...(entry.staff_id ? { pin: { staff: entry.staff_id } } : {}),
    }).catch((e: unknown) => {
      if (e instanceof BookingError || e instanceof SchedulingError) return [];
      throw e;
    });
    available = slots.some(
      (s) =>
        s.end === Date.parse(entry.offered_end_at!) &&
        (!entry.staff_id ||
          (s.assignments.filter((r) => r.key === "staff").length === entry.service_ids.length &&
            s.assignments
              .filter((r) => r.key === "staff")
              .every((r) => r.resourceId === entry.staff_id))),
    );
  }
  if (!available) {
    await tx
      .updateTable("notification")
      .set({ status: "skipped" })
      .where("id", "=", n.id)
      .execute();
    await tx
      .updateTable("waitlist_entry")
      .set({
        status: "waiting",
        offered_start_at: null,
        offered_end_at: null,
        notification_id: null,
      })
      .where("id", "=", entry.id)
      .execute();
    return null;
  }
  const client = await tx
    .selectFrom("client")
    .select("locale")
    .where("id", "=", entry.client_id)
    .executeTakeFirst();
  return {
    entry,
    notification: n,
    locale: client?.locale ?? tenant.locale,
    services: entry.service_ids.map((id) => services.find((s) => s.id === id)!.name),
  };
}

/** Called inside the successful booking transaction; stale or altered links do not consume another request. */
export async function completeWaitlistEntry(
  tx: Tx,
  q: {
    token: string;
    serviceIds: string[];
    startMs: number;
    appointmentId: string;
    staffId: string;
  },
): Promise<void> {
  if (!q.token) return;
  const entry = await tx
    .selectFrom("waitlist_entry")
    .selectAll()
    .where("public_token", "=", q.token)
    .forUpdate()
    .executeTakeFirst();
  if (
    !entry ||
    !["offered", "notified"].includes(entry.status) ||
    Date.parse(entry.offered_start_at ?? "") !== q.startMs ||
    JSON.stringify(entry.service_ids) !== JSON.stringify(q.serviceIds) ||
    (entry.staff_id && entry.staff_id !== q.staffId)
  )
    return;
  await tx
    .updateTable("waitlist_entry")
    .set({ status: "booked", booked_appointment_id: q.appointmentId })
    .where("id", "=", entry.id)
    .execute();
  await cancelJobsByPrefix(tx, `waitlist-notify:${entry.id}:`);
}
