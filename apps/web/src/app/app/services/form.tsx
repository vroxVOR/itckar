"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveServiceAction } from "./actions";

export interface ServiceFormData {
  id?: string;
  name: string;
  description: string;
  categoryName: string;
  price: number;
  priceFrom: boolean;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  bookableOnline: boolean;
  color: string;
  staffIds: string[];
  extraKind: "" | "chair" | "room" | "device";
  extraIds: string[];
  segments: { name: string; durationMin: number; kind: "active" | "processing" }[];
}

interface Props {
  initial: ServiceFormData;
  staff: { id: string; name: string }[];
  extras: { id: string; name: string; kind: string }[];
  categories: string[];
  currency: string;
}

export function ServiceForm({ initial, staff, extras, categories, currency }: Props) {
  const [state, action, pending] = useActionState(saveServiceAction, undefined);
  const [segments, setSegments] = useState(initial.segments);
  const [extraKind, setExtraKind] = useState(initial.extraKind);
  const total = segments.reduce((a, s) => a + (Number(s.durationMin) || 0), 0);
  const extraOptions = extras.filter((e) => e.kind === extraKind);

  const update = (i: number, patch: Partial<ServiceFormData["segments"][number]>) =>
    setSegments((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <form action={action} className="space-y-6">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="segmentsJson" value={JSON.stringify(segments)} />
      <section className="card grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Názov</label>
          <input className="input" name="name" defaultValue={initial.name} required />
        </div>
        <div>
          <label className="label">Kategória</label>
          <input className="input" name="categoryName" defaultValue={initial.categoryName} list="categories" placeholder="Vlasy, Kozmetika…" />
          <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label className="label">Cena ({currency})</label>
          <div className="flex items-center gap-3">
            <input className="input" name="price" type="number" step="0.01" min="0" defaultValue={initial.price} />
            <label className="flex items-center gap-1 whitespace-nowrap text-sm"><input type="checkbox" name="priceFrom" defaultChecked={initial.priceFrom} /> od</label>
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Popis (zobrazí sa klientom)</label>
          <textarea className="input" name="description" rows={2} defaultValue={initial.description} />
        </div>
        <div>
          <label className="label">Farba v kalendári</label>
          <input className="h-9 w-16 cursor-pointer rounded border border-neutral-300" name="color" type="color" defaultValue={initial.color || "#2f6fed"} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bookableOnline" defaultChecked={initial.bookableOnline} /> Rezervovateľné online</label>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Priebeh služby</h2>
          <span className="text-sm text-neutral-500">Spolu {total} min</span>
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          „Pôsobenie“ = klient čaká (farba, maska), kaderník je voľný pre iného klienta, kreslo/miestnosť ostáva obsadené.
        </p>
        <ul className="mt-3 space-y-2">
          {segments.map((seg, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-xs text-neutral-400">{i + 1}.</span>
              <input className="input w-44" placeholder="Názov kroku (voliteľné)" value={seg.name} onChange={(e) => update(i, { name: e.target.value })} />
              <input className="input w-24" type="number" min={1} value={seg.durationMin} onChange={(e) => update(i, { durationMin: Number(e.target.value) })} />
              <span className="text-sm text-neutral-500">min</span>
              <select className="input w-40" value={seg.kind} onChange={(e) => update(i, { kind: e.target.value as "active" | "processing" })}>
                <option value="active">aktívne (personál)</option>
                <option value="processing">pôsobenie (bez personálu)</option>
              </select>
              {segments.length > 1 && (
                <button type="button" className="btn-ghost text-xs" onClick={() => setSegments((cur) => cur.filter((_, j) => j !== i))}>Odstrániť</button>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary mt-3" onClick={() => setSegments((cur) => [...cur, { name: "", durationMin: 15, kind: cur.length === 1 ? "processing" : "active" }])}>
          + Pridať krok
        </button>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Prestávka pred (min)</label>
            <input className="input" name="bufferBeforeMin" type="number" min={0} defaultValue={initial.bufferBeforeMin} />
          </div>
          <div>
            <label className="label">Prestávka po (min) – upratanie</label>
            <input className="input" name="bufferAfterMin" type="number" min={0} defaultValue={initial.bufferAfterMin} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="font-medium">Kto službu robí</h2>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {staff.map((r) => (
            <li key={r.id}>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="staffIds" value={r.id} defaultChecked={initial.staffIds.includes(r.id)} /> {r.name}</label>
            </li>
          ))}
        </ul>
        {staff.length === 0 && <p className="text-sm text-neutral-500">Najprv pridajte člena tímu.</p>}
        <div className="mt-4">
          <label className="label">Vyžaduje aj zdroj</label>
          <select className="input w-56" name="extraKind" value={extraKind} onChange={(e) => setExtraKind(e.target.value as ServiceFormData["extraKind"])}>
            <option value="">Žiadny</option>
            <option value="chair">Kreslo</option>
            <option value="room">Miestnosť</option>
            <option value="device">Prístroj</option>
          </select>
          {extraKind && (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {extraOptions.map((r) => (
                <li key={r.id}>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="extraIds" value={r.id} defaultChecked={initial.extraIds.includes(r.id)} /> {r.name}</label>
                </li>
              ))}
              {extraOptions.length === 0 && <li className="text-sm text-neutral-500">Žiadny zdroj tohto typu – pridajte ho v „Tím a zdroje“.</li>}
            </ul>
          )}
        </div>
      </section>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>Uložiť službu</button>
        <Link href="/app/services" className="btn-secondary">Späť</Link>
      </div>
    </form>
  );
}
