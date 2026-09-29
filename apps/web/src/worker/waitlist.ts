import { matchWaitlist, prepareWaitlistNotification, withTenant, type Job } from "@itckar/db";
import type { HandlerContext } from "./handlers";
import { waitlistMessage } from "./templates";

export async function handleWaitlistJob(ctx: HandlerContext, job: Job): Promise<void> {
  if (!job.tenant_id) throw new Error("Waitlist job has no tenant");
  const tenantId = job.tenant_id;
  const payload = job.payload as {
    appointmentId?: string;
    afterId?: string;
    entryId?: string;
    version?: number;
  };
  const loaded = await withTenant(ctx.db, tenantId, async (tx) => {
    const tenant = await tx
      .selectFrom("tenant")
      .selectAll()
      .where("id", "=", tenantId)
      .executeTakeFirstOrThrow();
    if (job.kind === "waitlist.match") {
      if (!payload.appointmentId) throw new Error("Waitlist match has no appointment");
      await matchWaitlist(tx, tenant, {
        appointmentId: payload.appointmentId,
        ...(payload.afterId ? { afterId: payload.afterId } : {}),
      });
      return null;
    }
    if (!payload.entryId || !Number.isInteger(payload.version))
      throw new Error("Invalid waitlist notification payload");
    const prepared = await prepareWaitlistNotification(
      tx,
      tenant,
      payload.entryId,
      payload.version!,
    );
    return prepared ? { ...prepared, tenant } : null;
  });
  if (!loaded) return;
  const { entry, notification: n, tenant } = loaded;
  const manageUrl = `${ctx.appUrl}/w/${tenant.slug}/${entry.public_token}`;
  const text = waitlistMessage({
    locale: loaded.locale,
    tenantName: tenant.name,
    zone: tenant.timezone,
    startIso: entry.offered_start_at!,
    services: loaded.services,
    manageUrl,
  });
  const provider = entry.channel === "email" ? ctx.email : ctx.sms;
  try {
    const result =
      entry.channel === "email"
        ? await ctx.email.send({
            to: n.recipient,
            subject: text.subject,
            text: text.text,
            fromName: tenant.name,
          })
        : await ctx.sms.send({
            to: n.recipient,
            text: text.text,
            senderId: process.env.SMS_SENDER_ID,
          });
    await withTenant(ctx.db, tenantId, async (tx) => {
      await tx
        .updateTable("notification")
        .set({
          status: "sent",
          provider: provider.name,
          provider_message_id: result.providerMessageId ?? null,
          body_preview: text.text.slice(0, 200),
          error: null,
          sent_at: new Date(),
        })
        .where("id", "=", n.id)
        .execute();
      await tx
        .updateTable("waitlist_entry")
        .set({ status: "notified" })
        .where("id", "=", entry.id)
        .where("status", "=", "offered")
        .where("offer_version", "=", entry.offer_version)
        .execute();
    });
  } catch (error) {
    await withTenant(ctx.db, tenantId, (tx) =>
      tx
        .updateTable("notification")
        .set({
          status: "failed",
          provider: provider.name,
          error: String((error as Error).message).slice(0, 500),
        })
        .where("id", "=", n.id)
        .where("status", "in", ["queued", "failed"])
        .execute(),
    );
    throw error;
  }
}
