"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useBookingHold } from "./use-booking-hold";
import { t } from "@/lib/i18n";
import { bookAction } from "./actions";

interface Props {
  slug: string;
  serviceIds: string[];
  staffId: string;
  startMs: number;
  locale: string;
  when: string;
  backHref: string;
  labels: Record<"title" | "name" | "lastName" | "phone" | "email" | "note" | "consentSms" | "consentEmail" | "terms" | "submit" | "back", string>;
}

export function BookingForm({ slug, serviceIds, staffId, startMs, locale, when, backHref, labels }: Props) {
  const [state, action, pending] = useActionState(bookAction, undefined);
  const router = useRouter();
  const { hold, seconds, retry, release } = useBookingHold({ slug, serviceIds, staffId, startMs }, t(locale, "error_generic"));
  const [submittedTicket, setSubmittedTicket] = useState("");
  const [leaving, setLeaving] = useState(false);
  const ticket = hold && "ticket" in hold ? hold.ticket : "";
  const expired = Boolean(ticket) && (seconds === 0 || (state?.holdExpired && submittedTicket === ticket));
  const ready = Boolean(ticket) && !expired;
  const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <form action={action} className="booking-details card space-y-4" onSubmit={(e) => {
      if (!ready || pending || leaving) e.preventDefault();
      else setSubmittedTicket(ticket);
    }}>
      <input type="hidden" name="holdTicket" value={ticket} />
      <div className={`hold-notice ${expired || (hold && "error" in hold) ? "hold-notice-warning" : ""}`}>
        <p role="status">{!hold ? t(locale, "hold_loading") : "error" in hold ? hold.error : expired ? t(locale, "err_hold_expired") : t(locale, "hold_active")}</p>
        {ready && <p className="mt-1 font-semibold tabular-nums" role="timer" aria-live="off">{remaining}</p>}
        {(expired || (hold && "error" in hold)) && <button type="button" className="btn-secondary mt-3" onClick={retry} disabled={pending || leaving}>{t(locale, "hold_retry")}</button>}
      </div>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="serviceIds" value={serviceIds.join(",")} />
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="startMs" value={startMs} />
      <input type="hidden" name="locale" value={locale} />
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <h2 className="font-medium">{labels.title}</h2>
      <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm capitalize">{when}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="firstName">{labels.name} *</label><input className="input" id="firstName" name="firstName" autoComplete="given-name" required /></div>
        <div><label className="label" htmlFor="lastName">{labels.lastName}</label><input className="input" id="lastName" name="lastName" autoComplete="family-name" placeholder={labels.lastName} /></div>
        <div><label className="label" htmlFor="phone">{labels.phone} *</label><input className="input" id="phone" name="phone" type="tel" autoComplete="tel" placeholder="+421 900 000 000" required /></div>
        <div><label className="label" htmlFor="email">{labels.email}</label><input className="input" id="email" name="email" type="email" autoComplete="email" /></div>
      </div>
      <div><label className="label" htmlFor="note">{labels.note}</label><textarea className="input" id="note" name="note" rows={2} /></div>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="consentSms" /> {labels.consentSms}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="consentEmail" /> {labels.consentEmail}</label>
        <p className="text-xs text-neutral-500">{labels.terms}</p>
      </div>
      {state?.error && !state.holdExpired && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending || !ready || leaving}>{pending ? "…" : labels.submit}</button>
        <Link href={backHref} aria-disabled={pending || leaving} onClick={async (e) => {
          e.preventDefault();
          if (pending || leaving) return;
          setLeaving(true);
          try { await release(); } catch { /* The hold still expires automatically. */ }
          router.push(backHref);
        }} className="text-sm text-neutral-500 hover:underline">← {labels.back}</Link>
      </div>
    </form>
  );
}
