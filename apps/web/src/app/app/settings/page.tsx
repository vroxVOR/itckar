import { PageHeading } from "@/components/page-heading";
import { Settings } from "lucide-react";
import { withTenant } from "@itckar/db";
import { requireTenant } from "@/lib/session";
import { db } from "@/lib/db";
import { SettingsForm } from "./form";

export default async function SettingsPage() {
  const s = await requireTenant();
  const loc = await withTenant(db(), s.tenant.id, (tx) => tx.selectFrom("location").selectAll().where("is_default", "=", true).executeTakeFirst());
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeading title="Nastavenia" description="Vaša prevádzka, rezervovanie a pripomienky." icon={<Settings size={21} />} />
      <div className="card text-sm">
        <h2 className="font-medium">Rezervačná stránka</h2>
        <p className="mt-1">
          <code className="rounded bg-neutral-100 px-1.5 py-0.5">{appUrl}/b/{s.tenant.slug}</code>
        </p>
        <p className="mt-2 text-neutral-500">Vložte odkaz do Google profilu firmy, Instagram bio a na web. Vlastná doména a widget prídu v ďalšej fáze.</p>
      </div>
      <SettingsForm
        initial={{
          name: s.tenant.name,
          locale: s.tenant.locale,
          timezone: s.tenant.timezone,
          slotStepMin: s.tenant.slot_step_min,
          minNoticeMin: s.tenant.min_notice_min,
          maxAdvanceDays: s.tenant.max_advance_days,
          cancelUntilMin: s.tenant.cancel_until_min,
          reminderHours: s.tenant.reminder_hours.join(", "),
          phone: loc?.phone ?? "",
          address: loc?.address ?? "",
        }}
      />
    </div>
  );
}
