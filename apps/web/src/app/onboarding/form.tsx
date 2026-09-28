"use client";

import { useActionState, useState } from "react";
import { createTenantAction } from "./actions";

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createTenantAction, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label className="label" htmlFor="name">Názov prevádzky</label>
        <input
          className="input"
          id="name"
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
          placeholder="Salón Krásna"
        />
      </div>
      <div>
        <label className="label" htmlFor="slug">Adresa rezervačnej stránky</label>
        <div className="flex items-center gap-1 text-sm text-neutral-500">
          <span>/b/</span>
          <input
            className="input"
            id="slug"
            name="slug"
            required
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            pattern="[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="country">Krajina</label>
          <select className="input" id="country" name="country" defaultValue="SK">
            <option value="SK">Slovensko (EUR)</option>
            <option value="CZ">Česko (CZK)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="vertical">Typ prevádzky</label>
          <select className="input" id="vertical" name="vertical" defaultValue="hair">
            <option value="hair">Kaderníctvo</option>
            <option value="barber">Barbershop</option>
            <option value="beauty">Kozmetika</option>
            <option value="nails">Nechty</option>
            <option value="massage">Masáže</option>
            <option value="wellness">Wellness</option>
            <option value="other">Iné</option>
          </select>
        </div>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>Založiť prevádzku</button>
    </form>
  );
}
