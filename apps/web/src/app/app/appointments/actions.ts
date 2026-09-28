"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { z } from "zod";
import { BookingError, cancelAppointment, createAppointment, setAppointmentStatus, withTenant } from "@itckar/db";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/session";
import { bookingErrorMessage } from "@/lib/i18n";

export type ActionState = { error?: string } | undefined;

const createSchema = z.object({
  serviceIds: z.array(z.string().uuid()).min(1),
  staffId: z.string().uuid().optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  clientId: z.string().uuid().optional().or(z.literal("")),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

export async function createAppointmentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireTenant();
  const parsed = createSchema.safeParse({
    serviceIds: form.getAll("serviceIds"),
    staffId: form.get("staffId") ?? "",
    date: form.get("date"),
    time: form.get("time"),
    clientId: form.get("clientId") ?? "",
    firstName: form.get("firstName") ?? undefined,
    lastName: form.get("lastName") ?? undefined,
    phone: form.get("phone") ?? undefined,
    email: form.get("email") ?? "",
    notes: form.get("notes") ?? undefined,
  });
  if (!parsed.success) return { error: "Vyberte aspoň jednu službu, dátum a čas." };
  const d = parsed.data;
  if (!d.clientId && !d.firstName) return { error: "Zadajte meno klienta alebo vyberte existujúceho." };
  const start = DateTime.fromISO(`${d.date}T${d.time}`, { zone: s.tenant.timezone });
  if (!start.isValid) return { error: "Neplatný dátum alebo čas." };

  let id: string;
  try {
    const created = await withTenant(db(), s.tenant.id, (tx) =>
      createAppointment(tx, s.tenant, {
        serviceIds: d.serviceIds,
        startMs: start.toMillis(),
        ...(d.staffId ? { pin: { staff: d.staffId } } : {}),
        client: d.clientId
          ? { id: d.clientId, firstName: "" }
          : { firstName: d.firstName!, ...(d.lastName ? { lastName: d.lastName } : {}), ...(d.phone ? { phone: d.phone } : {}), ...(d.email ? { email: d.email } : {}) },
        source: "admin",
        ...(d.notes ? { notes: d.notes } : {}),
        createdBy: s.user.id,
        ignoreNoticeRules: true,
      }),
    );
    id = created.id;
  } catch (e) {
    if (e instanceof BookingError) return { error: bookingErrorMessage(s.tenant.locale, e.code) };
    throw e;
  }
  revalidatePath("/app/calendar");
  redirect(`/app/appointments/${id}`);
}

export async function setStatusAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const status = String(form.get("status"));
  if (!["completed", "no_show", "confirmed"].includes(status)) return;
  await withTenant(db(), s.tenant.id, (tx) =>
    setAppointmentStatus(tx, { appointmentId: id, status: status as "completed" | "no_show" | "confirmed", actorId: s.user.id }),
  );
  revalidatePath(`/app/appointments/${id}`);
  revalidatePath("/app/calendar");
}

export async function cancelAction(form: FormData): Promise<void> {
  const s = await requireTenant();
  const id = String(form.get("id"));
  const reason = String(form.get("reason") ?? "").trim() || undefined;
  await withTenant(db(), s.tenant.id, (tx) =>
    cancelAppointment(tx, s.tenant, { appointmentId: id, by: "user", actorId: s.user.id, ...(reason ? { reason } : {}) }),
  );
  revalidatePath("/app/calendar");
  redirect("/app/calendar");
}
