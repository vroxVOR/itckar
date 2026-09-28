import Link from "next/link";
import { Brand } from "@/components/brand";
import { CalendarDays, UserRoundCheck, ShieldCheck, ArrowUpRight, ArrowRight, Check, Sparkles } from "lucide-react";
import { currentSession } from "@/lib/session";

export default async function Home() {
  const session = await currentSession();
  return (
    <main className="landing mx-auto flex min-h-screen max-w-4xl flex-col px-6">
      <header className="landing-header flex items-center justify-between py-6">
        <Brand />
        <nav aria-label="Hlavná navigácia" className="flex gap-2">
          {session ? (
            <Link href="/app" className="btn-primary">Otvoriť aplikáciu</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Prihlásiť sa</Link>
              <Link href="/register" className="btn-primary">Vyskúšať zadarmo <ArrowUpRight size={15} aria-hidden="true" /></Link>
            </>
          )}
        </nav>
      </header>
      <section className="landing-hero flex flex-1 flex-col justify-center py-16">
        <p className="hero-eyebrow mb-6"><Sparkles size={14} aria-hidden="true" /> Malý salón. Veľký prehľad.</p>
        <h1 className="hero-title max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Váš salón. Váš čas.
          <br /><em>Všetko na svojom mieste.</em>
        </h1>
        <p className="hero-description mt-6 max-w-2xl text-lg text-neutral-600">
          Menej plánovania, viac času pre klientov. Rezervácie, tím aj pripomienky
          v jednom prehľadnom systéme pre salóny, barberov a wellness.
        </p>
        <div className="hero-actions mt-7 flex flex-wrap items-center gap-3">
          <Link href={session ? "/app" : "/register"} className="btn-primary">
            {session ? "Otvoriť môj kalendár" : "Vytvoriť účet zadarmo"} <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <Link href="/b/salon-demo" className="btn-secondary">Pozrieť ukážku <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
        <ul className="hero-reassurance mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-600">
          {["Rezervovanie bez účtu klienta", "Automatické pripomienky", "Ochrana pred prekrytím termínov"].map((text) => (
            <li key={text} className="flex items-center gap-1.5"><Check size={13} aria-hidden="true" />{text}</li>
          ))}
        </ul>
        <ul className="feature-grid mt-10 grid gap-4 sm:grid-cols-3">
          {([
            ["Plánovanie bez chaosu", "Čas na farbenie, viac služieb aj voľné kreslá. Každý detail má svoje miesto.", CalendarDays],
            ["Jednoduché pre klientov", "Vyberú si službu a termín. Rezervujú bez registrácie či sťahovania aplikácie.", UserRoundCheck],
            ["Na termín sa dá spoľahnúť", "Prehľad o dostupnosti a ochrana pred prekrývaním rezervácií priamo v systéme.", ShieldCheck],
          ] as const).map(([h, p, Icon], index) => (
            <li key={h} className="card feature-card">
              <div className="feature-card-top"><span className="feature-icon"><Icon size={21} strokeWidth={1.6} aria-hidden="true" /></span><span className="feature-number" aria-hidden="true">0{index + 1}</span></div>
              <h2 className="font-semibold">{h}</h2>
              <p className="mt-2 text-sm text-neutral-600">{p}</p>
            </li>
          ))}
        </ul>
        <div className="demo-banner mt-6">
          <span className="demo-symbol" aria-hidden="true"><CalendarDays size={24} strokeWidth={1.5} /></span>
          <div className="demo-copy">
            <p className="demo-label">NAJPRV SI TO VYSKÚŠAJTE</p>
            <h2>Takto jednoducho si klient rezervuje termín.</h2>
            <p>Otvorte ukážkový salón a prezrite si výber služby aj termínu.</p>
          </div>
          <Link href="/b/salon-demo" className="demo-link">Otvoriť demo <ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>
      <footer className="landing-footer"><Brand compact /><span>Viac priestoru pre to, čo vás baví.</span></footer>
    </main>
  );
}
