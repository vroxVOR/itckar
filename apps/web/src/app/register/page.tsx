"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "./actions";

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerAction, undefined);
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-lg font-semibold">itckar</Link>
      <h1 className="text-2xl font-semibold">Vytvoriť účet</h1>
      <p className="mt-1 text-sm text-neutral-600">Zadarmo pre jeden kalendár. Bez karty.</p>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="name">Vaše meno</label>
          <input className="input" id="name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Heslo (min. 8 znakov)</label>
          <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>Vytvoriť účet</button>
      </form>
      <p className="mt-6 text-sm text-neutral-600">
        Už máte účet? <Link className="underline" href="/login">Prihláste sa</Link>
      </p>
    </main>
  );
}
