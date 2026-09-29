"use client";

import { useActionState } from "react";
import { addAction } from "./actions";

export function WaitlistForm({
  clients,
  services,
  staff,
  today,
  maxDate,
}: {
  clients: { id: string; label: string }[];
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  today: string;
  maxDate: string;
}) {
  const [state, action, pending] = useActionState(addAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <label className="label">
          Klient
          <select name="clientId" className="input mt-1" required defaultValue="">
            <option value="" disabled>
              Vyberte klienta
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="label">Požadované služby</span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {services.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3 text-sm"
              >
                <input type="checkbox" name="serviceIds" value={s.id} />
                {s.name}
              </label>
            ))}
          </div>
        </div>
        <label className="label">
          Člen tímu
          <select name="staffId" className="input mt-1" defaultValue="">
            <option value="">Ktokoľvek dostupný</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">
            Od dátumu
            <input
              className="input mt-1"
              type="date"
              name="from"
              defaultValue={today}
              min={today}
              max={maxDate}
              required
            />
          </label>
          <label className="label">
            Do dátumu vrátane
            <input
              className="input mt-1"
              type="date"
              name="until"
              defaultValue={today}
              min={today}
              max={maxDate}
              required
            />
          </label>
        </div>
        <label className="label">
          Upozorniť cez
          <select className="input mt-1" name="channel">
            <option value="email">E-mail</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral-600">
          <input className="mt-1" type="checkbox" name="requested" required />
          Klient požiadal o upozornenie na uvoľnený termín v tomto období.
        </label>
      </fieldset>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.success && (
        <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
          Klient bol pridaný medzi čakateľov.
        </p>
      )}
      <button className="btn-primary" disabled={pending || !clients.length || !services.length}>
        {pending ? "Ukladám…" : "Pridať čakateľa"}
      </button>
    </form>
  );
}
