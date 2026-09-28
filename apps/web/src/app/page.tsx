import Link from "next/link";
import { Brand } from "@/components/brand";
import { CalendarDays, UserRoundCheck, ShieldCheck, ArrowUpRight } from "lucide-react";
import { currentSession } from "@/lib/session";

export default async function Home() {
  const session = await currentSession();
  return (
    <main className="landing mx-auto flex min-h-screen max-w-4xl flex-col px-6">
      <header className="landing-header flex items-center justify-between py-6">
        <Brand />
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
        <p className="hero-eyebrow mb-6">Viac času na to, čo vás baví</p>
        <h1 className="hero-title max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Váš salón. Váš čas.
          <br /><em>Všetko na svojom mieste.</em>
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-neutral-600">
          Rezervácie, tím aj spokojní klienti. Doprajte svojmu salónu pokojnejší deň
          s prehľadným plánovaním a automatickými pripomienkami.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-3">
          {([
            ["Plánovanie bez chaosu", "Čas na farbenie, viac služieb aj voľné kreslá. Každý detail má svoje miesto.", CalendarDays],
            ["Jednoduché pre klientov", "Vyberú si službu a termín. Rezervujú bez registrácie či sťahovania aplikácie.", UserRoundCheck],
            ["Na termín sa dá spoľahnúť", "Jeden termín, jedna rezervácia. Ochrana pred prekrývaním je súčasťou systému.", ShieldCheck],
          ] as const).map(([h, p, Icon]) => (
            <li key={h} className="card feature-card">
              <span className="feature-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
              <h3 className="font-medium">{h}</h3>
              <p className="mt-1 text-sm text-neutral-600">{p}</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-neutral-500">
          <Link className="inline-flex items-center gap-2 font-medium text-brand-700 hover:underline" href="/b/salon-demo">Pozrieť ukážkový salón <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </p>
      </section>
    </main>
  );
}
