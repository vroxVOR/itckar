import { handleWaitlistJob } from "./waitlist";
import { withTenant, type Db, type Job, type Tx } from "@itckar/db";
import type { EmailProvider, SmsProvider } from "./providers/types";
import { rescheduledEmail, rescheduledSms, cancelledEmail, cancelledSms, confirmationEmail, confirmationSms, reminderEmail, reminderSms, type TemplateInput } from "./templates";

export interface HandlerContext {
  db: Db;
  email: EmailProvider;
  sms: SmsProvider;
  appUrl: string;
}

interface Loaded {
  input: TemplateInput;
  appointment: { id: string; status: string; client_id: string | null; start_at: string };
  client: { id: string; first_name: string; email: string | null; phone: string | null; locale: string | null } | null;
  tenantId: string;
}

async function loadAppointment(tx: Tx, appointmentId: string, appUrl: string): Promise<Loaded | null> {
  const a = await tx.selectFrom("appointment").selectAll().where("id", "=", appointmentId).executeTakeFirst();
  if (!a) return null;
  const tenant = await tx.selectFrom("tenant").selectAll().where("id", "=", a.tenant_id).executeTakeFirstOrThrow();
  const client = a.client_id
    ? ((await tx.selectFrom("client").select(["id", "first_name", "email", "phone", "locale"]).where("id", "=", a.client_id).executeTakeFirst()) ?? null)
    : null;
  const items = await tx.selectFrom("appointment_item").select("service_name").where("appointment_id", "=", a.id).orderBy("position").execute();
  const segs = await tx.selectFrom("appointment_segment").select("resource_ids").where("appointment_id", "=", a.id).execute();
  const rids = [...new Set(segs.flatMap((s) => s.resource_ids))];
  const staff = rids.length ? await tx.selectFrom("resource").select("name").where("id", "in", rids).where("kind", "=", "staff").execute() : [];
  const location = await tx.selectFrom("location").select(["address", "phone"]).where("is_default", "=", true).executeTakeFirst();
  return {
    tenantId: tenant.id,
    appointment: { id: a.id, status: a.status, client_id: a.client_id, start_at: a.start_at },
    client,
    input: {
      locale: client?.locale ?? tenant.locale,
      tenantName: tenant.name,
      startIso: a.start_at,
      zone: tenant.timezone,
      services: items.map((i) => i.service_name),
      staff: staff.map((s) => s.name),
      manageUrl: `${appUrl}/r/${a.public_token}`,
      address: location?.address,
      phone: location?.phone,
    },
  };
}

async function deliver(
  ctx: HandlerContext,
  loaded: Loaded,
  template: string,
  sms: string,
  email: { subject: string; text: string },
): Promise<void> {
  const { client } = loaded;
  if (!client) return;
  const record = async (channel: "sms" | "email", recipient: string, fn: () => Promise<{ providerMessageId?: string | undefined }>) => {
    const providerName = channel === "sms" ? ctx.sms.name : ctx.email.name;
    try {
      const r = await fn();
      await withTenant(ctx.db, loaded.tenantId, (tx) =>
        tx
          .insertInto("notification")
          .values({ tenant_id: loaded.tenantId, appointment_id: loaded.appointment.id, client_id: client.id, channel, template, recipient, body_preview: (channel === "sms" ? sms : email.subject).slice(0, 200), status: "sent", provider: providerName, provider_message_id: r.providerMessageId ?? null, sent_at: new Date() })
          .execute(),
      );
    } catch (e) {
      await withTenant(ctx.db, loaded.tenantId, (tx) =>
        tx
          .insertInto("notification")
          .values({ tenant_id: loaded.tenantId, appointment_id: loaded.appointment.id, client_id: client.id, channel, template, recipient, status: "failed", provider: providerName, error: String((e as Error).message).slice(0, 500) })
          .execute(),
      );
      throw e;
    }
  };
  // Transactional messages (confirmation, reminder, cancellation) are needed to perform the
  // service and do not require marketing consent (§7 odst. 3 z. 480/2004 Sb. / §116 z. 452/2021 Z. z. analogy).
  if (client.phone) await record("sms", client.phone, () => ctx.sms.send({ to: client.phone!, text: sms, senderId: process.env.SMS_SENDER_ID }));
  if (client.email) await record("email", client.email, () => ctx.email.send({ to: client.email!, subject: email.subject, text: email.text, fromName: loaded.input.tenantName }));
}

export async function handleJob(ctx: HandlerContext, job: Job): Promise<void> {
  if (job.kind === "waitlist.match" || job.kind === "waitlist.notify") return handleWaitlistJob(ctx, job);
  const payload = job.payload as { appointmentId?: string; hoursBefore?: number; startMs?: number; by?: string };
  if (!job.tenant_id) throw new Error(`job ${job.id} has no tenant`);
  const load = () => withTenant(ctx.db, job.tenant_id!, (tx) => loadAppointment(tx, payload.appointmentId!, ctx.appUrl));

  switch (job.kind) {
    case "appointment.confirmation": {
      const l = await load();
      if (!l || l.appointment.status === "cancelled") return;
      await deliver(ctx, l, "confirmation", confirmationSms(l.input), confirmationEmail(l.input));
      return;
    }
    case "appointment.rescheduled": {
      const l = await load();
      if (!l || !["confirmed", "pending"].includes(l.appointment.status) || Date.parse(l.appointment.start_at) !== payload.startMs) return;
      await deliver(ctx, l, "rescheduled", rescheduledSms(l.input), rescheduledEmail(l.input));
      return;
    }
    case "appointment.reminder": {
      const l = await load();
      if (!l || l.appointment.status !== "confirmed") return;
      if (Date.parse(l.appointment.start_at) < Date.now()) return; // stale
      if (payload.startMs !== undefined && Date.parse(l.appointment.start_at) !== payload.startMs) return;
      const input = { ...l.input, hoursBefore: payload.hoursBefore ?? 24 };
      await deliver(ctx, l, `reminder_${input.hoursBefore}h`, reminderSms(input), reminderEmail(input));
      return;
    }
    case "appointment.cancelled": {
      const l = await load();
      if (!l) return;
      await deliver(ctx, l, "cancelled", cancelledSms(l.input), cancelledEmail(l.input));
      return;
    }
    default:
      throw new Error(`unknown job kind ${job.kind}`);
  }
}
