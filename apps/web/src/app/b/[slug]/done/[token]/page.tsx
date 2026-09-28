import { Brand } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { publicAppointment } from "@/lib/public-appointment";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { t } from "@/lib/i18n";

export default async function DonePage({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const data = await publicAppointment(token);
  if (!data || data.tenant.slug !== slug) notFound();
  const { tenant, appointment: a, items } = data;
  const l = data.client?.locale ?? tenant.locale;
  return (
    <main className="booking-receipt mx-auto max-w-md px-4 py-12 text-center">
      <div className="confirmation-symbol"><CheckCircle2 size={36} aria-hidden="true" /></div>
      <h1 className="mt-4 text-2xl font-semibold">{t(l, "booking_confirmed")}</h1>
      <p className="mt-2 text-neutral-600">{tenant.name}</p>
      <div className="receipt-card card mt-6 text-left text-sm">
        <p className="text-lg font-medium capitalize">{fmtDate(a.start_at, tenant.timezone, l)}</p>
        <p className="text-lg">{fmtTime(a.start_at, tenant.timezone, l)} – {fmtTime(a.end_at, tenant.timezone, l)}</p>
        {data.staff.length > 0 && <p className="mt-1 text-neutral-600">{data.staff.join(", ")}</p>}
        <ul className="mt-3 divide-y divide-neutral-100">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between py-1.5"><span>{i.service_name}</span><span>{money(i.price_cents, tenant.currency, l)}</span></li>
          ))}
        </ul>
        {data.location?.address && <p className="mt-3 text-neutral-600">{data.location.address}</p>}
      </div>
      <p className="mt-6 text-sm text-neutral-600">{t(l, "terms_note")}</p>
      <Link href={`/r/${token}`} className="btn-secondary mt-4">{t(l, "manage_link")}</Link>
      <p className="booking-powered mt-8 text-xs text-neutral-500">{t(l, "powered_by")} <Brand compact /></p>
    </main>
  );
}
