"use client";

import { useActionState, useEffect } from "react";
import { rescheduleAction } from "@/app/app/appointments/actions";

export function RescheduleForm({ id, expectedStart, date, time, zone, onDone, onCancel }: {
  id: string; expectedStart: number; date: string; time: string; zone: string; onDone?: () => void; onCancel?: () => void;
}) {
  const [state, action, pending] = useActionState(rescheduleAction, undefined);
  useEffect(() => { if (state?.success) onDone?.(); }, [state, onDone]);
  return (
    <form action={action} data-saving={pending} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expectedStart" value={expectedStart} />
      <p className="text-sm text-neutral-600">Personál, služby aj cena zostanú zachované. Klientovi odošleme zmenu termínu a upravíme pripomienky.</p>
      <fieldset disabled={pending} className="grid grid-cols-2 gap-3">
        <label className="label">Nový dátum<input className="input mt-1" name="date" type="date" defaultValue={date} required /></label>
        <label className="label">Nový čas<input className="input mt-1" name="time" type="time" defaultValue={time} required /></label>
      </fieldset>
      <p className="text-xs text-neutral-500">Časové pásmo: {zone}</p>
      {state?.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
      {state?.success && <p role="status" className="text-sm text-emerald-700">Termín bol presunutý.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={pending}>{pending ? "Presúvam…" : "Potvrdiť presun"}</button>
        {onCancel && <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Ponechať pôvodný termín</button>}
      </div>
    </form>
  );
}
