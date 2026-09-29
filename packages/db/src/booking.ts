import { sql } from "kysely";
import {
  checkSlot,
  findSlots,
  normalize,
  MINUTE,
  type Assignment,
  type BusyInterval,
  type CartItem,
  type Interval,
  type Resource as SResource,
  type Service as SService,
  type Slot,
} from "@itckar/scheduling";
import type { Tx } from "./db";
import { parseTstzrange, tstzrange } from "./db";
import type { AppointmentSource, Tenant } from "./schema";
import { enqueueJob, cancelJobsByPrefix } from "./jobs";

/* ------------------------------------------------------------------ errors */

export type BookingErrorCode =
  | "service_not_found"
  | "slot_unavailable"
  | "slot_busy"
  | "too_soon"
  | "too_far"
  | "conflict"
  | "invalid_assignment"
  | "not_found"
  | "cancel_window_passed"
  | "hold_expired";

export class BookingError extends Error {
  constructor(
    public readonly code: BookingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BookingError";
  }
}

/* ------------------------------------------------------------------ loaders */

const hhmm = (t: string) => t.slice(0, 5);

export async function loadSchedulingResources(tx: Tx, opts: { onlineOnly?: boolean } = {}): Promise<SResource[]> {
  let q = tx.selectFrom("resource").selectAll().where("active", "=", true);
  if (opts.onlineOnly) q = q.where("bookable_online", "=", true);
  const resources = await q.orderBy("sort_order").orderBy("name").execute();
  if (resources.length === 0) return [];
  const ids = resources.map((r) => r.id);
  const rules = await tx.selectFrom("availability_rule").selectAll().where("resource_id", "in", ids).execute();
  const overrides = await tx
    .selectFrom("availability_override")
    .selectAll()
    .where("resource_id", "in", ids)
    .execute();
  return resources.map((r) => {
    const myRules = rules.filter((x) => x.resource_id === r.id);
    const myOverrides = overrides.filter((x) => x.resource_id === r.id);
    const out: SResource = { id: r.id, kind: r.kind, name: r.name };
    // Staff without any rule are never available; non-staff resources default to always available.
    if (r.kind === "staff" || myRules.length > 0 || myOverrides.length > 0) {
      out.rules = myRules.map((x) => ({
        weekday: x.weekday as 1,
        start: hhmm(x.start_time),
        end: hhmm(x.end_time),
      }));
      out.overrides = myOverrides.map((x) => ({
        date: x.date,
        intervals: x.intervals as unknown as { start: string; end: string }[],
      }));
    }
    return out;
  });
}

export interface LoadedService extends SService {
  name: string;
  description: string | null;
  categoryId: string | null;
  priceCents: number;
  priceFrom: boolean;
  durationMin: number;
  bookableOnline: boolean;
}

export async function loadServices(tx: Tx, serviceIds?: string[]): Promise<LoadedService[]> {
  let q = tx.selectFrom("service").selectAll().where("active", "=", true);
  if (serviceIds) {
    if (serviceIds.length === 0) return [];
    q = q.where("id", "in", serviceIds);
  }
  const services = await q.orderBy("sort_order").orderBy("name").execute();
  if (services.length === 0) return [];
  const ids = services.map((s) => s.id);
  const reqs = await tx
    .selectFrom("service_requirement")
    .selectAll()
    .where("service_id", "in", ids)
    .orderBy("sort_order")
    .execute();
  const cands = reqs.length
    ? await tx
        .selectFrom("service_requirement_candidate")
        .selectAll()
        .where(
          "requirement_id",
          "in",
          reqs.map((r) => r.id),
        )
        .execute()
    : [];
  const segs = await tx
    .selectFrom("service_segment")
    .selectAll()
    .where("service_id", "in", ids)
    .orderBy("position")
    .execute();
  return services.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    categoryId: s.category_id,
    priceCents: s.price_cents,
    priceFrom: s.price_from,
    bookableOnline: s.bookable_online,
    bufferBeforeMin: s.buffer_before_min,
    bufferAfterMin: s.buffer_after_min,
    durationMin: segs.filter((x) => x.service_id === s.id).reduce((a, x) => a + x.duration_min, 0),
    requirements: reqs
      .filter((r) => r.service_id === s.id)
      .map((r) => ({
        key: r.key,
        kind: r.kind,
        candidates: cands.filter((c) => c.requirement_id === r.id).map((c) => c.resource_id),
      })),
    segments: segs
      .filter((x) => x.service_id === s.id)
      .map((x) => ({
        id: x.id,
        ...(x.name ? { name: x.name } : {}),
        durationMin: x.duration_min,
        kind: x.kind,
        occupies: x.occupies,
      })),
  }));
}

export async function loadBusy(tx: Tx, fromMs: number, toMs: number): Promise<BusyInterval[]> {
  const rows = await tx
    .selectFrom("resource_block")
    .select(["resource_id", "during", "appointment_id", "hold_token"])
    .where("blocking", "=", true)
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date().toISOString())]))
    .where(sql<boolean>`during && ${tstzrange(fromMs, toMs)}::tstzrange`)
    .execute();
  return rows.map((r) => {
    const { start, end } = parseTstzrange(r.during);
    const ref = r.appointment_id ?? r.hold_token;
    return { resourceId: r.resource_id, start, end, ...(ref ? { ref } : {}) };
  });
}

/* ------------------------------------------------------------------ availability */

export interface AvailabilityQuery {
  serviceIds: string[];
  fromMs: number;
  toMs: number;
  /** requirement key -> resource id (e.g. { staff: "<uuid>" }) applied to every cart item that has the key */
  pin?: Record<string, string>;
  nowMs?: number;
  /** admin calendars may book outside online rules */
  ignoreNoticeRules?: boolean;
  onlineOnly?: boolean;
  ignoreAppointmentId?: string;
}

function toCart(services: LoadedService[], serviceIds: string[], pin?: Record<string, string>): CartItem[] {
  return serviceIds.map((id) => {
    const service = services.find((s) => s.id === id);
    if (!service) throw new BookingError("service_not_found", `service ${id} not found`);
    const item: CartItem = { service };
    if (pin) {
      const applicable = Object.fromEntries(
        Object.entries(pin).filter(([key, rid]) =>
          service.requirements.some((r) => r.key === key && r.candidates.includes(rid)),
        ),
      );
      if (Object.keys(applicable).length) item.pin = applicable;
    }
    return item;
  });
}

export async function availableSlots(tx: Tx, tenant: Tenant, q: AvailabilityQuery): Promise<Slot[]> {
  const now = q.nowMs ?? Date.now();
  const maxTo = now + tenant.max_advance_days * 86_400_000;
  const to = q.ignoreNoticeRules ? q.toMs : Math.min(q.toMs, maxTo);
  if (to <= q.fromMs) return [];
  const [services, resources, busy] = await Promise.all([
    loadServices(tx, q.serviceIds),
    loadSchedulingResources(tx, { onlineOnly: q.onlineOnly ?? false }),
    loadBusy(tx, q.fromMs - 86_400_000, to + 86_400_000),
  ]);
  const cart = toCart(services, q.serviceIds, q.pin);
  const input: Parameters<typeof findSlots>[0] = {
    zone: tenant.timezone,
    from: q.fromMs,
    to,
    cart,
    resources,
    busy,
    stepMin: tenant.slot_step_min,
    now,
    minNoticeMin: q.ignoreNoticeRules ? 0 : tenant.min_notice_min,
  };
  if (q.ignoreAppointmentId) input.ignoreRef = q.ignoreAppointmentId;
  return findSlots(input);
}

/* ------------------------------------------------------------------ holds */

export interface HoldResult {
  token: string;
  expiresAt: Date;
  slot: Slot;
}

/** Soft-reserve a slot for a few minutes while the client fills in the form. */
export async function holdSlot(
  tx: Tx,
  tenant: Tenant,
  q: { serviceIds: string[]; startMs: number; assignments?: Assignment[]; pin?: Record<string, string>; ttlMin?: number; nowMs?: number },
): Promise<HoldResult> {
  const slot = await resolveSlot(tx, tenant, { ...q, source: "online" });
  const token = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = new Date((q.nowMs ?? Date.now()) + (q.ttlMin ?? 5) * MINUTE);
  await purgeExpiredHolds(tx);
  const blocks = mergedBlocks(slot, toCartFromSlot(slot, await loadServices(tx, q.serviceIds), q.serviceIds));
  try {
    await tx
      .insertInto("resource_block")
      .values(
        blocks.map((b) => ({
          tenant_id: tenant.id,
          resource_id: b.resourceId,
          during: tstzrange(b.start, b.end),
          kind: "hold" as const,
          hold_token: token,
          expires_at: expiresAt,
        })),
      )
      .execute();
  } catch (e) {
    throw translatePgError(e);
  }
  return { token, expiresAt, slot };
}

export async function releaseHold(tx: Tx, token: string): Promise<void> {
  await tx.deleteFrom("resource_block").where("hold_token", "=", token).execute();
}

export async function purgeExpiredHolds(tx: Tx): Promise<number> {
  const r = await tx
    .deleteFrom("resource_block")
    .where("kind", "=", "hold")
    .where("expires_at", "<", new Date().toISOString())
    .executeTakeFirst();
  return Number(r.numDeletedRows);
}

/* ------------------------------------------------------------------ create */

export interface ClientInput {
  id?: string;
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
  locale?: string;
  note?: string;
  marketingSmsConsent?: boolean;
  marketingEmailConsent?: boolean;
  consentIp?: string;
}

export interface CreateAppointmentInput {
  serviceIds: string[];
  startMs: number;
  /** Full assignments; if omitted the engine resolves them (respecting `pin`). */
  assignments?: Assignment[];
  pin?: Record<string, string>;
  client: ClientInput;
  source: AppointmentSource;
  holdToken?: string;
  notes?: string;
  createdBy?: string;
  nowMs?: number;
  /** Admins may override notice/advance windows. */
  ignoreNoticeRules?: boolean;
}

export interface CreatedAppointment {
  id: string;
  publicToken: string;
  clientId: string;
  startMs: number;
  endMs: number;
  slot: Slot;
}

async function resolveSlot(
  tx: Tx,
  tenant: Tenant,
  q: {
    serviceIds: string[];
    startMs: number;
    assignments?: Assignment[];
    pin?: Record<string, string>;
    nowMs?: number;
    source: AppointmentSource;
    ignoreNoticeRules?: boolean;
    ignoreRef?: string;
  },
): Promise<Slot> {
  const now = q.nowMs ?? Date.now();
  const online = q.source === "online" && !q.ignoreNoticeRules;
  if (online && q.startMs > now + tenant.max_advance_days * 86_400_000) throw new BookingError("too_far");
  const [services, resources, busy] = await Promise.all([
    loadServices(tx, q.serviceIds),
    loadSchedulingResources(tx, { onlineOnly: online }),
    loadBusy(tx, q.startMs - 86_400_000, q.startMs + 2 * 86_400_000),
  ]);
  const cart = toCart(services, q.serviceIds, q.pin);
  const filteredBusy = q.ignoreRef ? busy.filter((b) => b.ref !== q.ignoreRef) : busy;
  const common = {
    zone: tenant.timezone,
    cart,
    resources,
    busy: filteredBusy,
    now,
    minNoticeMin: online ? tenant.min_notice_min : 0,
  };
  if (q.assignments) {
    const r = checkSlot({ ...common, start: q.startMs, assignments: q.assignments });
    if (r.ok) return r.slot;
    const map: Record<string, BookingErrorCode> = {
      unavailable: "slot_unavailable",
      busy: "slot_busy",
      too_soon: "too_soon",
      invalid_assignment: "invalid_assignment",
    };
    throw new BookingError(map[r.reason] ?? "slot_unavailable", r.detail);
  }
  const slots = findSlots({ ...common, from: q.startMs, to: q.startMs + 1, stepMin: 1, limit: 1 });
  const slot = slots.find((s) => s.start === q.startMs);
  if (!slot) {
    // Give a reason: try without busy time to distinguish "closed" from "taken".
    const open = findSlots({ ...common, busy: [], from: q.startMs, to: q.startMs + 1, stepMin: 1, limit: 1 });
    if (open.length === 0) {
      if (q.startMs < now + (online ? tenant.min_notice_min : 0) * MINUTE) throw new BookingError("too_soon");
      throw new BookingError("slot_unavailable");
    }
    throw new BookingError("slot_busy");
  }
  return slot;
}

function toCartFromSlot(_slot: Slot, services: LoadedService[], serviceIds: string[]): CartItem[] {
  return toCart(services, serviceIds);
}

/** Merge per-resource occupancy (segments + outer buffers) so one appointment never self-conflicts. */
export function mergedBlocks(slot: Slot, cart: CartItem[]): { resourceId: string; start: number; end: number }[] {
  const per = new Map<string, Interval[]>();
  for (const seg of slot.segments) {
    const svc = cart[seg.cartIndex]!.service;
    const isFirst = seg.segmentIndex === 0;
    const isLast = seg.segmentIndex === svc.segments.length - 1;
    const start = seg.start - (isFirst ? (svc.bufferBeforeMin ?? 0) * MINUTE : 0);
    const end = seg.end + (isLast ? (svc.bufferAfterMin ?? 0) * MINUTE : 0);
    for (const rid of seg.resourceIds) {
      const list = per.get(rid) ?? [];
      list.push({ start, end });
      per.set(rid, list);
    }
  }
  const out: { resourceId: string; start: number; end: number }[] = [];
  for (const [resourceId, list] of per) for (const iv of normalize(list)) out.push({ resourceId, ...iv });
  return out;
}

function translatePgError(e: unknown): Error {
  const code = (e as { code?: string }).code;
  if (code === "23P01") return new BookingError("conflict", "resource already booked at that time");
  return e as Error;
}

async function upsertClient(tx: Tx, tenantId: string, c: ClientInput): Promise<string> {
  if (c.id) {
    const existing = await tx.selectFrom("client").select("id").where("id", "=", c.id).executeTakeFirst();
    if (!existing) throw new BookingError("not_found", "client not found");
    return c.id;
  }
  const phone = c.phone?.trim() || null;
  const email = c.email?.trim().toLowerCase() || null;
  let found: { id: string } | undefined;
  if (phone) found = await tx.selectFrom("client").select("id").where("phone", "=", phone).executeTakeFirst();
  if (!found && email)
    found = await tx
      .selectFrom("client")
      .select("id")
      .where(sql<boolean>`lower(email) = ${email}`)
      .executeTakeFirst();
  let clientId: string;
  if (found) {
    clientId = found.id;
    await tx
      .updateTable("client")
      .set({
        first_name: c.firstName,
        ...(c.lastName !== undefined ? { last_name: c.lastName || null } : {}),
        ...(email && !phone ? {} : email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(c.locale ? { locale: c.locale } : {}),
      })
      .where("id", "=", clientId)
      .execute();
  } else {
    const row = await tx
      .insertInto("client")
      .values({
        tenant_id: tenantId,
        first_name: c.firstName,
        last_name: c.lastName || null,
        email,
        phone,
        locale: c.locale ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    clientId = row.id;
  }
  const consents: ("marketing_sms" | "marketing_email")[] = [];
  if (c.marketingSmsConsent) consents.push("marketing_sms");
  if (c.marketingEmailConsent) consents.push("marketing_email");
  if (consents.length)
    await tx
      .insertInto("consent")
      .values(
        consents.map((kind) => ({
          tenant_id: tenantId,
          client_id: clientId,
          kind,
          source: "online_booking",
          text_version: "v1",
          ip: c.consentIp ?? null,
        })),
      )
      .execute();
  return clientId;
}

export async function createAppointment(tx: Tx, tenant: Tenant, input: CreateAppointmentInput): Promise<CreatedAppointment> {
  const now = input.nowMs ?? Date.now();
  if (input.holdToken) {
    // Our own hold must not block us; it is replaced by the appointment blocks below.
    const hold = await tx
      .selectFrom("resource_block")
      .select(["expires_at"])
      .where("hold_token", "=", input.holdToken)
      .forUpdate()
      .executeTakeFirst();
    if (!hold?.expires_at || Date.parse(hold.expires_at) <= Math.max(now, Date.now())) throw new BookingError("hold_expired");
    await releaseHold(tx, input.holdToken);
  }
  await purgeExpiredHolds(tx);

  const slotQuery: Parameters<typeof resolveSlot>[2] = {
    serviceIds: input.serviceIds,
    startMs: input.startMs,
    nowMs: now,
    source: input.source,
  };
  if (input.assignments) slotQuery.assignments = input.assignments;
  if (input.pin) slotQuery.pin = input.pin;
  if (input.ignoreNoticeRules) slotQuery.ignoreNoticeRules = true;
  const slot = await resolveSlot(tx, tenant, slotQuery);
  const services = await loadServices(tx, input.serviceIds);
  const cart = toCart(services, input.serviceIds);

  const clientId = await upsertClient(tx, tenant.id, input.client);
  const location = await tx.selectFrom("location").select("id").where("is_default", "=", true).executeTakeFirst();

  const appt = await tx
    .insertInto("appointment")
    .values({
      tenant_id: tenant.id,
      location_id: location?.id ?? null,
      client_id: clientId,
      status: "confirmed",
      start_at: new Date(slot.start),
      end_at: new Date(slot.end),
      source: input.source,
      notes: input.notes ?? null,
      client_note: input.client.note ?? null,
      created_by: input.createdBy ?? null,
    })
    .returning(["id", "public_token"])
    .executeTakeFirstOrThrow();

  const items = await tx
    .insertInto("appointment_item")
    .values(
      cart.map((item, i) => ({
        tenant_id: tenant.id,
        appointment_id: appt.id,
        service_id: item.service.id,
        position: i,
        service_name: (item.service as LoadedService).name,
        price_cents: (item.service as LoadedService).priceCents,
      })),
    )
    .returning(["id", "position"])
    .execute();
  const itemIdByPos = new Map(items.map((i) => [i.position, i.id]));

  await tx
    .insertInto("appointment_segment")
    .values(
      slot.segments.map((s, i) => ({
        tenant_id: tenant.id,
        appointment_id: appt.id,
        item_id: itemIdByPos.get(s.cartIndex)!,
        position: i,
        kind: s.kind,
        start_at: new Date(s.start),
        end_at: new Date(s.end),
        resource_ids: s.resourceIds,
      })),
    )
    .execute();

  try {
    await tx
      .insertInto("resource_block")
      .values(
        mergedBlocks(slot, cart).map((b) => ({
          tenant_id: tenant.id,
          resource_id: b.resourceId,
          during: tstzrange(b.start, b.end),
          kind: "appointment" as const,
          appointment_id: appt.id,
        })),
      )
      .execute();
  } catch (e) {
    throw translatePgError(e);
  }

  await tx
    .insertInto("audit_log")
    .values({
      tenant_id: tenant.id,
      actor_id: input.createdBy ?? null,
      actor_type: input.source === "online" ? "client" : input.source === "ai" ? "ai" : "user",
      action: "appointment.create",
      entity: "appointment",
      entity_id: appt.id,
      data: JSON.stringify({ start: new Date(slot.start).toISOString(), serviceIds: input.serviceIds }),
    })
    .execute();

  await scheduleNotifications(tx, tenant, { appointmentId: appt.id, startMs: slot.start, nowMs: now });

  return { id: appt.id, publicToken: appt.public_token, clientId, startMs: slot.start, endMs: slot.end, slot };
}

async function scheduleNotifications(tx: Tx, tenant: Tenant, a: { appointmentId: string; startMs: number; nowMs: number }) {
  await enqueueJob(tx, {
    tenantId: tenant.id,
    kind: "appointment.confirmation",
    payload: { appointmentId: a.appointmentId },
    dedupeKey: `confirm:${a.appointmentId}`,
  });
  for (const h of tenant.reminder_hours) {
    const runAt = a.startMs - h * 3_600_000;
    if (runAt <= a.nowMs + 5 * MINUTE) continue; // too late for this reminder
    await enqueueJob(tx, {
      tenantId: tenant.id,
      kind: "appointment.reminder",
      payload: { appointmentId: a.appointmentId, hoursBefore: h },
      runAt: new Date(runAt),
      dedupeKey: `remind:${a.appointmentId}:${h}`,
    });
  }
}

/* ------------------------------------------------------------------ cancel / status */

export async function cancelAppointment(
  tx: Tx,
  tenant: Tenant,
  q: { appointmentId: string; reason?: string; by: "client" | "user" | "system"; actorId?: string; nowMs?: number },
): Promise<void> {
  const appt = await tx
    .selectFrom("appointment")
    .select(["id", "status", "start_at"])
    .where("id", "=", q.appointmentId)
    .executeTakeFirst();
  if (!appt) throw new BookingError("not_found");
  if (appt.status === "cancelled") return;
  const now = q.nowMs ?? Date.now();
  if (q.by === "client" && Date.parse(appt.start_at) - now < tenant.cancel_until_min * MINUTE)
    throw new BookingError("cancel_window_passed");
  await tx
    .updateTable("appointment")
    .set({ status: "cancelled", cancelled_at: new Date(now), cancel_reason: q.reason ?? null })
    .where("id", "=", appt.id)
    .execute();
  await tx.updateTable("resource_block").set({ blocking: false }).where("appointment_id", "=", appt.id).execute();
  await cancelJobsByPrefix(tx, `remind:${appt.id}:`);
  await tx
    .insertInto("audit_log")
    .values({
      tenant_id: tenant.id,
      actor_id: q.actorId ?? null,
      actor_type: q.by,
      action: "appointment.cancel",
      entity: "appointment",
      entity_id: appt.id,
      data: JSON.stringify({ reason: q.reason ?? null }),
    })
    .execute();
  await enqueueJob(tx, {
    tenantId: tenant.id,
    kind: "appointment.cancelled",
    payload: { appointmentId: appt.id, by: q.by },
    dedupeKey: `cancelled:${appt.id}`,
  });
}

export async function setAppointmentStatus(
  tx: Tx,
  q: { appointmentId: string; status: "completed" | "no_show" | "confirmed"; actorId?: string },
): Promise<void> {
  const appt = await tx
    .selectFrom("appointment")
    .select(["id", "status", "client_id"])
    .where("id", "=", q.appointmentId)
    .executeTakeFirst();
  if (!appt) throw new BookingError("not_found");
  await tx.updateTable("appointment").set({ status: q.status }).where("id", "=", appt.id).execute();
  if (q.status === "no_show" && appt.status !== "no_show" && appt.client_id)
    await tx
      .updateTable("client")
      .set({ no_show_count: sql`no_show_count + 1` })
      .where("id", "=", appt.client_id)
      .execute();
  if (q.status !== "no_show" && appt.status === "no_show" && appt.client_id)
    await tx
      .updateTable("client")
      .set({ no_show_count: sql`greatest(no_show_count - 1, 0)` })
      .where("id", "=", appt.client_id)
      .execute();
}

/* ------------------------------------------------------------------ time off */

export async function addTimeOff(
  tx: Tx,
  tenantId: string,
  q: { resourceId: string; startMs: number; endMs: number; note?: string },
): Promise<string> {
  try {
    const r = await tx
      .insertInto("resource_block")
      .values({
        tenant_id: tenantId,
        resource_id: q.resourceId,
        during: tstzrange(q.startMs, q.endMs),
        kind: "timeoff",
        note: q.note ?? null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return r.id;
  } catch (e) {
    throw translatePgError(e);
  }
}
