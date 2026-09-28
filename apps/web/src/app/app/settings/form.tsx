"use client";

import { useActionState } from "react";
import { saveSettingsAction } from "./actions";

interface Initial {
  name: string; locale: string; timezone: string; slotStepMin: number; minNoticeMin: number; maxAdvanceDays: number; cancelUntilMin: number; reminderHours: string; phone: string; address: string;
}

export function SettingsForm({ initial }: { initial: Initial }) {
  const [state, action, pending] = useActionState(saveSettingsAction, undefined);
  return (
    <form action={action} className="space-y-6">
      <section className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Názov prevádzky</label><input className="input" name="name" defaultValue={initial.name} required /></div>
        <div><label className="label">Telefón</label><input className="input" name="phone" defaultValue={initial.phone} /></div>
        <div><label className="label">Adresa</label><input className="input" name="address" defaultValue={initial.address} /></div>
        <div>
          <label className="label">Jazyk rezervačnej stránky</label>
          <select className="input" name="locale" defaultValue={initial.locale}><option value="sk">Slovenčina</option><option value="cs">Čeština</option><option value="en">English</option></select>
        </div>
        <div><label className="label">Časová zóna</label><input className="input" name="timezone" defaultValue={initial.timezone} /></div>
      </section>
      <section className="card grid gap-4 sm:grid-cols-2">
        <h2 className="font-medium sm:col-span-2">Pravidlá online rezervácií</h2>
        <div><label className="label">Krok kalendára (min)</label><input className="input" name="slotStepMin" type="number" min={5} max={120} defaultValue={initial.slotStepMin} /></div>
        <div><label className="label">Minimálny predstih (min)</label><input className="input" name="minNoticeMin" type="number" min={0} defaultValue={initial.minNoticeMin} /></div>
        <div><label className="label">Maximálne dopredu (dní)</label><input className="input" name="maxAdvanceDays" type="number" min={1} max={365} defaultValue={initial.maxAdvanceDays} /></div>
        <div><label className="label">Klient môže zrušiť najneskôr (min pred)</label><input className="input" name="cancelUntilMin" type="number" min={0} defaultValue={initial.cancelUntilMin} /></div>
        <div className="sm:col-span-2">
          <label className="label">Pripomienky (hodiny pred termínom, oddelené čiarkou)</label>
          <input className="input" name="reminderHours" defaultValue={initial.reminderHours} placeholder="24, 2" />
        </div>
      </section>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">Uložené.</p>}
      <button className="btn-primary" disabled={pending}>Uložiť</button>
    </form>
  );
}
