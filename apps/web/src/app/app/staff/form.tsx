"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveResourceAction } from "./actions";

export interface ResourceFormData {
  id?: string;
  name: string;
  kind: "staff" | "chair" | "room" | "device" | "other";
  color: string;
  bookableOnline: boolean;
  rules: { weekday: number; start: string; end: string }[];
}

const DAYS = ["Pondelok", "Utorok", "Streda", "Štvrtok", "Piatok", "Sobota", "Nedeľa"];

export function ResourceForm({ initial }: { initial: ResourceFormData }) {
  const [state, action, pending] = useActionState(saveResourceAction, undefined);
  const [kind, setKind] = useState(initial.kind);
  const [rules, setRules] = useState(initial.rules);

  const toggleDay = (weekday: number, on: boolean) =>
    setRules((cur) => (on ? [...cur, { weekday, start: "09:00", end: "17:00" }] : cur.filter((r) => r.weekday !== weekday)));
  const setRule = (idx: number, patch: Partial<{ start: string; end: string }>) => setRules((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <form action={action} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="rulesJson" value={JSON.stringify(rules)} />
      <section className="card grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Názov</label>
          <input className="input" name="name" defaultValue={initial.name} required />
        </div>
        <div>
          <label className="label">Typ</label>
          <select className="input" name="kind" value={kind} onChange={(e) => setKind(e.target.value as ResourceFormData["kind"])}>
            <option value="staff">Člen tímu</option>
            <option value="chair">Kreslo</option>
            <option value="room">Miestnosť</option>
            <option value="device">Prístroj</option>
            <option value="other">Iné</option>
          </select>
        </div>
        <div>
          <label className="label">Farba</label>
          <input className="h-9 w-16 cursor-pointer rounded border border-neutral-300" name="color" type="color" defaultValue={initial.color || "#2f6fed"} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={initial.bookableOnline} /> Klienti si môžu vybrať online</label>
        </div>
      </section>

      {kind === "staff" && (
        <section className="card">
          <h2 className="font-medium">Pracovný čas</h2>
          <p className="mt-1 text-xs text-neutral-500">Týždenný rozvrh. Dovolenky a výnimky nastavíte po uložení.</p>
          <ul className="mt-3 space-y-2">
            {DAYS.map((label, i) => {
              const weekday = i + 1;
              const idxs = rules.map((r, idx) => (r.weekday === weekday ? idx : -1)).filter((x) => x >= 0);
              return (
                <li key={weekday} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex w-32 items-center gap-2"><input type="checkbox" checked={idxs.length > 0} onChange={(e) => toggleDay(weekday, e.target.checked)} /> {label}</label>
                  {idxs.map((idx) => (
                    <span key={idx} className="flex items-center gap-1">
                      <input className="input w-28" type="time" value={rules[idx]!.start} onChange={(e) => setRule(idx, { start: e.target.value })} />
                      <span>–</span>
                      <input className="input w-28" type="time" value={rules[idx]!.end} onChange={(e) => setRule(idx, { end: e.target.value })} />
                      {idxs.length > 1 && <button type="button" className="btn-ghost text-xs" onClick={() => setRules((cur) => cur.filter((_, j) => j !== idx))}>×</button>}
                    </span>
                  ))}
                  {idxs.length > 0 && (
                    <button type="button" className="btn-ghost text-xs" onClick={() => setRules((cur) => [...cur, { weekday, start: "13:00", end: "17:00" }])}>+ prestávka / ďalší blok</button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>Uložiť</button>
        <Link href="/app/staff" className="btn-secondary">Späť</Link>
      </div>
    </form>
  );
}
