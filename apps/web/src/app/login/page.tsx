"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { useActionState } from "react";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <main className="auth-page mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Link href="/" className="mb-8 self-start" aria-label="itckar – domov"><Brand /></Link>
      <h1 className="text-2xl font-semibold">Prihlásenie</h1>
      <form action={action} className="mt-6 space-y-4">
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Heslo</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button className="btn-primary w-full" disabled={pending}>Prihlásiť sa</button>
      </form>
      <p className="mt-6 text-sm text-neutral-600">
        Nemáte účet? <Link className="underline" href="/register">Vytvorte si ho</Link>
      </p>
    </main>
  );
}
