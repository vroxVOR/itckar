# itckar

Multi-vertikálny rezervačný SaaS pre malé prevádzky (kaderníctva, barbershopy, kozmetika, nechty,
masáže, wellness). Postavený podľa výskumu v `reports/Rezervačné systémy pre salóny.md`:
plochá cena bez per-seat poplatkov a provízií, skutočné plánovanie (pôsobenie pri farbení,
kreslá a miestnosti ako zdroje, viac služieb v jednej rezervácii), rezervácia bez registrácie
klienta a databázový invariant proti dvojitým rezerváciám.

## Stav (fáza M1 hotová)

| Časť | Stav |
|---|---|
| Plánovacie jadro (`packages/scheduling`) | ✅ segmenty služieb, zdroje, buffery, processing gaps, multi-služba, DST, property testy |
| Databáza (`packages/db`) | ✅ SQL migrácie, RLS per tenant, `EXCLUDE USING GIST` proti kolíziám, holdy, joby, audit log |
| Web (`apps/web`) | ✅ prihlásenie, onboarding, kalendár deň/týždeň, služby, tím a zdroje, klienti, nastavenia, verejná rezervačná stránka `/b/{slug}`, správa rezervácie `/r/{token}` |
| Worker | ✅ potvrdenia, pripomienky a zrušenia cez e-mail/SMS (console, Resend, BulkGate, Twilio) |
| Platby, zálohy, Google sync, widget, API, AI recepčná | ⏳ fázy M3–M9 (viď `docs/ROADMAP.md`) |

## Rýchly štart

Požiadavky: Node 22+, pnpm 10, PostgreSQL 16 (s `btree_gist`, je súčasťou štandardnej inštalácie).

```bash
pnpm install
cp .env.example .env            # upravte DATABASE_URL a SESSION_SECRET

# migrácie bežia ako vlastník DB, aplikácia ako rola itckar_app (RLS)
DATABASE_URL=postgres://postgres@localhost:5432/itckar_dev pnpm db:migrate
DATABASE_URL=postgres://postgres@localhost:5432/itckar_dev \
DATABASE_URL_APP=postgres://itckar_app:itckar_app@localhost:5432/itckar_dev pnpm db:seed

# aplikácia + worker
DATABASE_URL=postgres://itckar_app:itckar_app@localhost:5432/itckar_dev pnpm dev
DATABASE_URL=postgres://itckar_app:itckar_app@localhost:5432/itckar_dev pnpm worker
```

Demo: `http://localhost:3000/b/salon-demo`, admin `demo@itckar.local` / `demo1234`.

Heslo roly `itckar_app` sa nastaví pri prvej migrácii z `app.role_password` (predvolené `itckar_app`);
v produkcii ju zmeňte (`ALTER ROLE itckar_app PASSWORD '...'`).

## Testy

```bash
pnpm test           # všetky balíky (db testy potrebujú DATABASE_URL_TEST, predvolene itckar_test)
pnpm typecheck
pnpm --filter @itckar/web build

# E2E smoke test proti bežiacej aplikácii (Playwright + Chromium)
cd apps/web && E2E_BASE_URL=http://localhost:3000 node e2e/booking-flow.mjs
```

## Štruktúra

```
apps/web                 Next.js 16 (App Router, server actions, Tailwind 4) + worker
packages/scheduling      čistý TS engine dostupnosti (findSlots / checkSlot)
packages/db              SQL migrácie, Kysely typy, booking servisná vrstva, auth, joby, seed
packages/shared          zdieľané utility (normalizácia telefónu)
reports/, research_notes/  výskum trhu, na ktorom produkt stojí
docs/                    architektúra a roadmapa
```

Podrobnosti v `docs/ARCHITECTURE.md` a `docs/ROADMAP.md`.
