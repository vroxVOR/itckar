"use client";

import Link from "next/link";
import { useActionState } from "react";
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
  return (
    <form action={action} className="booking-details card space-y-4">
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
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? "…" : labels.submit}</button>
        <Link href={backHref} className="text-sm text-neutral-500 hover:underline">← {labels.back}</Link>
      </div>
    </form>
  );
}
