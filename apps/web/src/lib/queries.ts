import "server-only";
import { withTenant, type AppointmentStatus, type Db } from "@itckar/db";

export interface CalendarAppointment {
  id: string;
  status: AppointmentStatus;
  start_at: string;
  end_at: string;
  source: string;
  client_name: string | null;
  client_phone: string | null;
  services: string;
  segments: { start_at: string; end_at: string; kind: "active" | "processing"; resource_ids: string[] }[];
}

export async function appointmentsInRange(db: Db, tenantId: string, fromIso: string, toIso: string): Promise<CalendarAppointment[]> {
  return withTenant(db, tenantId, async (tx) => {
    const appts = await tx
      .selectFrom("appointment as a")
      .leftJoin("client as c", "c.id", "a.client_id")
      .select([
        "a.id",
        "a.status",
        "a.start_at",
        "a.end_at",
        "a.source",
        "c.first_name",
        "c.last_name",
        "c.phone",
      ])
      .where("a.start_at", "<", toIso)
      .where("a.end_at", ">", fromIso)
      .where("a.status", "!=", "cancelled")
      .orderBy("a.start_at")
      .execute();
    if (appts.length === 0) return [];
    const ids = appts.map((a) => a.id);
    const [items, segments] = await Promise.all([
      tx.selectFrom("appointment_item").select(["appointment_id", "service_name", "position"]).where("appointment_id", "in", ids).orderBy("position").execute(),
      tx
        .selectFrom("appointment_segment")
        .select(["appointment_id", "start_at", "end_at", "kind", "resource_ids", "position"])
        .where("appointment_id", "in", ids)
        .orderBy("position")
        .execute(),
    ]);
    return appts.map((a) => ({
      id: a.id,
      status: a.status,
      start_at: a.start_at,
      end_at: a.end_at,
      source: a.source,
      client_name: a.first_name ? [a.first_name, a.last_name].filter(Boolean).join(" ") : null,
      client_phone: a.phone,
      services: items.filter((i) => i.appointment_id === a.id).map((i) => i.service_name).join(" + "),
      segments: segments.filter((s) => s.appointment_id === a.id).map((s) => ({ start_at: s.start_at, end_at: s.end_at, kind: s.kind, resource_ids: s.resource_ids })),
    }));
  });
}

export interface TimeOffBlock {
  id: string;
  resource_id: string;
  start: string;
  end: string;
  note: string | null;
}

export async function timeOffInRange(db: Db, tenantId: string, fromIso: string, toIso: string): Promise<TimeOffBlock[]> {
  return withTenant(db, tenantId, async (tx) => {
    const rows = await tx
      .selectFrom("resource_block")
      .select(["id", "resource_id", "during", "note"])
      .where("kind", "=", "timeoff")
      .where("blocking", "=", true)
      .execute();
    return rows
      .map((r) => {
        const m = /^[\[(]"?([^,"]+)"?,"?([^)\]"]+)"?[)\]]$/.exec(r.during)!;
        return { id: r.id, resource_id: r.resource_id, start: new Date(m[1]!).toISOString(), end: new Date(m[2]!).toISOString(), note: r.note };
      })
      .filter((b) => Date.parse(b.start) < Date.parse(toIso) && Date.parse(b.end) > Date.parse(fromIso));
  });
}

export async function staffResources(db: Db, tenantId: string) {
  return withTenant(db, tenantId, (tx) =>
    tx.selectFrom("resource").selectAll().where("active", "=", true).orderBy("kind").orderBy("sort_order").orderBy("name").execute(),
  );
}

export async function servicesWithMeta(db: Db, tenantId: string, includeInactive = false) {
  return withTenant(db, tenantId, async (tx) => {
    let q = tx.selectFrom("service").selectAll();
    if (!includeInactive) q = q.where("active", "=", true);
    const services = await q.orderBy("sort_order").orderBy("name").execute();
    const segs = services.length
      ? await tx
          .selectFrom("service_segment")
          .select(["service_id", "duration_min", "kind"])
          .where(
            "service_id",
            "in",
            services.map((s) => s.id),
          )
          .execute()
      : [];
    const cats = await tx.selectFrom("service_category").selectAll().orderBy("sort_order").execute();
    return services.map((s) => ({
      ...s,
      duration_min: segs.filter((x) => x.service_id === s.id).reduce((a, x) => a + x.duration_min, 0),
      has_processing: segs.some((x) => x.service_id === s.id && x.kind === "processing"),
      category_name: cats.find((c) => c.id === s.category_id)?.name ?? null,
    }));
  });
}

export async function appointmentDetail(db: Db, tenantId: string, id: string) {
  return withTenant(db, tenantId, async (tx) => {
    const a = await tx
      .selectFrom("appointment as a")
      .leftJoin("client as c", "c.id", "a.client_id")
      .selectAll("a")
      .select(["c.first_name", "c.last_name", "c.phone", "c.email", "c.no_show_count", "c.notes as client_notes"])
      .where("a.id", "=", id)
      .executeTakeFirst();
    if (!a) return null;
    const items = await tx.selectFrom("appointment_item").selectAll().where("appointment_id", "=", id).orderBy("position").execute();
    const segments = await tx.selectFrom("appointment_segment").selectAll().where("appointment_id", "=", id).orderBy("position").execute();
    const resourceIds = [...new Set(segments.flatMap((s) => s.resource_ids))];
    const resources = resourceIds.length
      ? await tx.selectFrom("resource").select(["id", "name", "kind", "color"]).where("id", "in", resourceIds).execute()
      : [];
    const notifications = await tx.selectFrom("notification").selectAll().where("appointment_id", "=", id).orderBy("created_at", "desc").execute();
    return { ...a, items, segments, resources, notifications };
  });
}
