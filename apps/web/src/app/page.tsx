import Link from "next/link";
import { currentSession } from "@/lib/session";

export default async function Home() {
  const session = await currentSession();
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-lg font-semibold tracking-tight">itckar</span>
        <nav className="flex gap-2">
          {session ? (
            <Link href="/app" className="btn-primary">Otvoriť aplikáciu</Link>
          ) : (
            <>
              <Link href="/login" className="btn-secondary">Prihlásiť sa</Link>
              <Link href="/register" className="btn-primary">Vyskúšať zadarmo</Link>
            </>
          )}
        </nav>
      </header>
      <section className="flex flex-1 flex-col justify-center py-16">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Rezervačný systém pre salóny, ktorý nekradne klientov.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-neutral-600">
          Plochá cena bez poplatkov za každého zamestnanca a bez provízií. Farbenie s pôsobením,
          kreslá a miestnosti ako zdroje, zálohy a pripomienky v cene. Vaše dáta sú vaše.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            ["Skutočné plánovanie", "Processing time pri farbení, viac služieb v jednej rezervácii, kreslá a miestnosti."],
            ["Bez registrácie klienta", "Klient rezervuje menom a telefónom. Žiadna appka, žiadny účet."],
            ["Žiadne dvojité rezervácie", "Databázový invariant, nie len kontrola v aplikácii."],
          ].map(([h, p]) => (
            <li key={h} className="card">
              <h3 className="font-medium">{h}</h3>
              <p className="mt-1 text-sm text-neutral-600">{p}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-neutral-500">
          Demo salón: <Link className="underline" href="/b/salon-demo">/b/salon-demo</Link>
        </p>
      </section>
    </main>
  );
}
