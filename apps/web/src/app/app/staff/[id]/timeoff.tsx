"use client";

import { useActionState } from "react";
import { addTimeOffAction, setDayOverrideAction } from "../actions";

export function TimeOffForms({ resourceId }: { resourceId: string }) {
  const [offState, offAction, offPending] = useActionState(addTimeOffAction, undefined);
  const [ovState, ovAction, ovPending] = useActionState(setDayOverrideAction, undefined);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form action={offAction} className="card space-y-3 text-sm">
        <input type="hidden" name="resourceId" value={resourceId} />
        <h2 className="font-medium">Blokovať čas (dovolenka, obed, školenie)</h2>
        <p className="text-xs text-neutral-500">Blokácia sa nedá vytvoriť cez existujúcu rezerváciu.</p>
        <div><label className="label">Od</label><input className="input" type="datetime-local" name="from" required /></div>
        <div><label className="label">Do</label><input className="input" type="datetime-local" name="to" required /></div>
        <div><label className="label">Poznámka</label><input className="input" name="note" placeholder="Dovolenka" /></div>
        {offState?.error && <p className="text-red-600">{offState.error}</p>}
        <button className="btn-secondary" disabled={offPending}>Blokovať</button>
      </form>
      <form action={ovAction} className="card space-y-3 text-sm">
        <input type="hidden" name="resourceId" value={resourceId} />
        <h2 className="font-medium">Výnimka pre konkrétny deň</h2>
        <p className="text-xs text-neutral-500">Iný pracovný čas alebo voľný deň (nechajte časy prázdne).</p>
        <div><label className="label">Dátum</label><input className="input" type="date" name="date" required /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Od</label><input className="input" type="time" name="start" /></div>
          <div><label className="label">Do</label><input className="input" type="time" name="end" /></div>
        </div>
        <div><label className="label">Poznámka</label><input className="input" name="note" /></div>
        {ovState?.error && <p className="text-red-600">{ovState.error}</p>}
        <button className="btn-secondary" disabled={ovPending}>Uložiť výnimku</button>
      </form>
    </div>
  );
}
