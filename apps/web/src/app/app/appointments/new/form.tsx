"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { createAppointmentAction } from "../actions";
import { money, minutes } from "@/lib/format";

interface Props {
  services: { id: string; name: string; duration: number; price: number }[];
  staff: { id: string; name: string }[];
  clients: { id: string; label: string }[];
  defaults: { date: string; time: string; staffId: string; clientId: string };
  currency: string;
  locale: string;
  step: number;
}

export function NewAppointmentForm({ services, staff, clients, defaults, currency, locale, step }: Props) {
  const [state, action, pending] = useActionState(createAppointmentAction, undefined);
  const [selected, setSelected] = useState<string[]>([]);
  const [mode, setMode] = useState<"existing" | "new">(clients.length && !defaults.clientId ? "existing" : defaults.clientId ? "existing" : "new");
  const [clientQuery, setClientQuery] = useState("");
  const total = useMemo(() => services.filter((s) => selected.includes(s.id)), [services, selected]);
  const filteredClients = clients.filter((c) => c.label.toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 8);

  return (
    <form action={action} className="mt-6 space-y-6">
      <section className="card">
        <h2 className="mb-3 font-medium">Služby</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <li key={s.id}>
              <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${selected.includes(s.id) ? "border-brand-500 bg-brand-50" : "border-neutral-200"}`}>
                <input
                  type="checkbox"
                  name="serviceIds"
                  value={s.id}
                  className="mt-0.5"
                  checked={selected.includes(s.id)}
                  onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
                />
                <span className="flex-1">
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-neutral-500">{minutes(s.duration, locale)} · {money(s.price, currency, locale)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {total.length > 0 && (
          <p className="mt-3 text-sm text-neutral-600">
            Spolu {minutes(total.reduce((a, s) => a + s.duration, 0), locale)} · {money(total.reduce((a, s) => a + s.price, 0), currency, locale)}
          </p>
        )}
      </section>

      <section className="card grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="date">Dátum</label>
          <input className="input" type="date" id="date" name="date" defaultValue={defaults.date} required />
        </div>
        <div>
          <label className="label" htmlFor="time">Čas</label>
          <input className="input" type="time" id="time" name="time" defaultValue={defaults.time} step={step * 60} required />
        </div>
        <div>
          <label className="label" htmlFor="staffId">Kto</label>
          <select className="input" id="staffId" name="staffId" defaultValue={defaults.staffId}>
            <option value="">Ktokoľvek voľný</option>
            {staff.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Klient</h2>
          <div className="inline-flex rounded-lg border border-neutral-300 p-0.5 text-xs">
            <button type="button" onClick={() => setMode("existing")} className={`rounded-md px-2 py-1 ${mode === "existing" ? "bg-neutral-900 text-white" : ""}`}>Existujúci</button>
            <button type="button" onClick={() => setMode("new")} className={`rounded-md px-2 py-1 ${mode === "new" ? "bg-neutral-900 text-white" : ""}`}>Nový</button>
          </div>
        </div>
        {mode === "existing" ? (
          <div>
            <input className="input mb-2" placeholder="Hľadať meno alebo telefón…" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} />
            <select className="input" name="clientId" defaultValue={defaults.clientId} size={Math.min(8, Math.max(2, filteredClients.length))} required>
              {filteredClients.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="firstName">Meno</label>
              <input className="input" id="firstName" name="firstName" required />
            </div>
            <div>
              <label className="label" htmlFor="lastName">Priezvisko</label>
              <input className="input" id="lastName" name="lastName" />
            </div>
            <div>
              <label className="label" htmlFor="phone">Telefón</label>
              <input className="input" id="phone" name="phone" type="tel" placeholder="+421…" />
            </div>
            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <input className="input" id="email" name="email" type="email" />
            </div>
          </div>
        )}
        <div>
          <label className="label" htmlFor="notes">Interná poznámka</label>
          <textarea className="input" id="notes" name="notes" rows={2} />
        </div>
      </section>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || selected.length === 0}>Vytvoriť rezerváciu</button>
        <Link href="/app/calendar" className="btn-secondary">Zrušiť</Link>
      </div>
    </form>
  );
}
