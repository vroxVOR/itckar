import { Brand } from "@/components/brand";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicAppointment } from "@/lib/public-appointment";
import { fmtDate, fmtTime, money } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await publicAppointment(token);
  if (!data) notFound();
  const { tenant, appointment: a, items } = data;
  const l = data.client?.locale ?? tenant.locale;
  const canCancel = a.status === "confirmed" && Date.parse(a.start_at) - Date.now() > tenant.cancel_until_min * 60_000;
  return (
    <main className="booking-receipt mx-auto max-w-md px-4 py-12">
      <p className="text-sm text-neutral-500">{tenant.name}</p>
      <h1 className="mt-1 text-2xl font-semibold">{t(l, "manage_link")}</h1>
      <div className="receipt-card card mt-6 text-sm">
        <span className={`badge ${a.status === "cancelled" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{t(l, `status_${a.status}` as MessageKey)}</span>
        <p className="mt-3 text-lg font-medium capitalize">{fmtDate(a.start_at, tenant.timezone, l)}</p>
        <p className="text-lg">{fmtTime(a.start_at, tenant.timezone, l)} – {fmtTime(a.end_at, tenant.timezone, l)}</p>
        {data.staff.length > 0 && <p className="mt-1 text-neutral-600">{data.staff.join(", ")}</p>}
        <ul className="mt-3 divide-y divide-neutral-100">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between py-1.5"><span>{i.service_name}</span><span>{money(i.price_cents, tenant.currency, l)}</span></li>
          ))}
        </ul>
        {data.location?.phone && <p className="mt-3 text-neutral-600">☎ {data.location.phone}</p>}
      </div>
      {a.status === "confirmed" && (
        canCancel ? (
          <CancelForm token={token} label={t(l, "cancel_booking")} />
        ) : (
          <p className="mt-4 text-sm text-neutral-600">{t(l, "err_cancel_window")}</p>
        )
      )}
      <p className="mt-6 text-sm">
        <Link href={`/b/${tenant.slug}`} className="underline">{t(l, "book_now")}</Link>
      </p>
      <p className="booking-powered mt-8 text-xs text-neutral-500">{t(l, "powered_by")} <Brand compact /></p>
    </main>
  );
}
